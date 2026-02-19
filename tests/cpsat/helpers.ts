import { inject } from "vitest";
import { HttpSolverClient } from "../../src/client.js";
import type { CompilationRule, ModelBuilderConfig } from "../../src/cpsat/model-builder.js";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import type { CoverageRequirement, ShiftPattern, SchedulingMember } from "../../src/cpsat/types.js";
import type { TimeOfDay, SchedulingPeriod } from "../../src/types.js";
import { resolveDaysFromPeriod } from "../../src/datetime.utils.js";

export const decodeAssignments = (values: Record<string, number> = {}) =>
  Object.entries(values)
    .filter(([name, value]) => value === 1 && name.startsWith("assign:"))
    .map(([name]) => {
      const [, memberId, shiftPatternId, day] = name.split(":");
      return { memberId, shiftPatternId, day };
    });

export const solveWithRules = async (
  client: HttpSolverClient,
  baseConfig: Omit<ModelBuilderConfig, "rules" | "ruleConfigs" | "ruleFactories">,
  ruleConfigs: CpsatRuleConfigEntry[],
  customRules: CompilationRule[] = [],
) => {
  const builder = new ModelBuilder({
    ...baseConfig,
    ruleConfigs,
    rules: customRules,
  });
  const { request } = builder.compile();
  return client.solve(request);
};

/**
 * Get an HttpSolverClient connected to the shared solver container
 * started by the global setup. Use this instead of startSolverContainer()
 * in individual test files.
 */
export function getSolverClient(): HttpSolverClient {
  const port = inject("solverPort");
  return new HttpSolverClient(fetch, `http://localhost:${port}`);
}

/**
 * Base type for scheduling scenario configuration.
 * This is what ModelBuilder accepts (minus rule-related fields).
 */
export type BaseScenarioConfig = Omit<
  ModelBuilderConfig,
  "rules" | "ruleConfigs" | "ruleFactories"
>;

// ============================================================================
// Simple Configuration Helpers
// ============================================================================

/** Default single-day scheduling period for tests. */
const DEFAULT_PERIOD: SchedulingPeriod = {
  dateRange: { start: "2024-02-01", end: "2024-02-01" },
};

/**
 * Creates a minimal single-role config for simple test scenarios.
 *
 * Use this when all members share the same role and you just need
 * basic coverage. For multi-role or complex scenarios, build the config
 * explicitly or use createBaseConfig.
 */
export function createSimpleConfig(opts: {
  roleId: string;
  memberIds: string[];
  shiftId?: string;
  shiftStart?: TimeOfDay;
  shiftEnd?: TimeOfDay;
  schedulingPeriod?: SchedulingPeriod;
  targetCount?: number;
}): BaseScenarioConfig {
  const schedulingPeriod = opts.schedulingPeriod ?? DEFAULT_PERIOD;
  const days = resolveDaysFromPeriod(schedulingPeriod);
  const shiftStart = opts.shiftStart ?? { hours: 9, minutes: 0 };
  const shiftEnd = opts.shiftEnd ?? { hours: 17, minutes: 0 };
  const shiftId = opts.shiftId ?? "day";
  const roleIds: [string, ...string[]] = [opts.roleId];

  return {
    members: opts.memberIds.map((id) => ({ id, roles: [opts.roleId] })),
    shiftPatterns: [
      {
        id: shiftId,
        roleIds,
        startTime: shiftStart,
        endTime: shiftEnd,
      },
    ],
    schedulingPeriod,
    coverage: days.map((day) => ({
      day,
      roleIds,
      startTime: shiftStart,
      endTime: shiftEnd,
      targetCount: opts.targetCount ?? 1,
      priority: "MANDATORY" as const,
    })),
  };
}

// ============================================================================
// Flexible Configuration Builder (original createBaseConfig)
// ============================================================================

type BaseConfigOverrides = {
  /** Single role ID (convenience) - use roleIds for multiple roles */
  roleId?: string;
  /** Multiple role IDs for coverage. Takes precedence over roleId. */
  roleIds?: [string, ...string[]];
  memberIds?: string[];
  /** Provide full member objects for more control over roles/skills */
  members?: SchedulingMember[];
  shift?: {
    id?: string;
    startTime?: TimeOfDay;
    endTime?: TimeOfDay;
    locationId?: string;
    roleIds?: [string, ...string[]];
  };
  /** Multiple shift patterns (takes precedence over `shift`) */
  shifts?: Array<{
    id: string;
    startTime: TimeOfDay;
    endTime: TimeOfDay;
    locationId?: string;
    roleIds?: [string, ...string[]];
  }>;
  shiftPatterns?: ShiftPattern[];
  schedulingPeriod?: SchedulingPeriod;
  targetCount?: number;
  coverage?: CoverageRequirement[];
};

/**
 * Creates a base configuration with sensible defaults and flexible overrides.
 *
 * Role derivation priority:
 * 1. Explicit `roleIds` parameter (array)
 * 2. Explicit `roleId` parameter (single)
 * 3. First role from first member (if `members` provided)
 * 4. Default "role"
 */
export const createBaseConfig = (overrides: BaseConfigOverrides = {}): BaseScenarioConfig => {
  // Derive roleIds: explicit roleIds > roleId > from members > default
  const roleIds: [string, ...string[]] = overrides.roleIds ??
    (overrides.roleId ? [overrides.roleId] : null) ??
    (overrides.members?.[0]?.roles as [string, ...string[]] | undefined) ?? ["role"];

  // Use provided members or create from memberIds
  const members: SchedulingMember[] =
    overrides.members ??
    (overrides.memberIds ?? ["alice", "bob"]).map((id) => ({
      id,
      roles: [...roleIds],
    }));

  let shiftPatterns: ShiftPattern[];

  if (overrides.shiftPatterns) {
    shiftPatterns = overrides.shiftPatterns;
  } else if (overrides.shifts) {
    shiftPatterns = overrides.shifts.map((s) => ({
      id: s.id,
      roleIds: s.roleIds ?? roleIds,
      startTime: s.startTime,
      endTime: s.endTime,
      ...(s.locationId ? { locationId: s.locationId } : {}),
    }));
  } else {
    shiftPatterns = [
      {
        id: overrides.shift?.id ?? "day",
        roleIds: overrides.shift?.roleIds ?? roleIds,
        startTime: overrides.shift?.startTime ?? { hours: 9, minutes: 0 },
        endTime: overrides.shift?.endTime ?? { hours: 17, minutes: 0 },
        ...(overrides.shift?.locationId ? { locationId: overrides.shift.locationId } : {}),
      },
    ];
  }

  const schedulingPeriod = overrides.schedulingPeriod ?? DEFAULT_PERIOD;
  const days = resolveDaysFromPeriod(schedulingPeriod);

  const coverage: CoverageRequirement[] =
    overrides.coverage ??
    days.flatMap((day) =>
      shiftPatterns.map((pattern) => ({
        day,
        roleIds: pattern.roleIds ?? roleIds,
        startTime: pattern.startTime,
        endTime: pattern.endTime,
        targetCount: overrides.targetCount ?? 1,
        priority: "MANDATORY" as const,
      })),
    );

  return {
    members,
    shiftPatterns,
    schedulingPeriod,
    coverage,
  };
};

// ============================================================================
// Common Test Fixtures
// ============================================================================

/**
 * Pre-built fixtures for common test scenarios.
 * Use these for consistent, readable tests.
 */
export const fixtures = {
  /** Single day, single shift, two members (alice, bob) */
  twoMembersOneShift: (): BaseScenarioConfig =>
    createSimpleConfig({
      roleId: "staff",
      memberIds: ["alice", "bob"],
    }),

  /** Week of weekdays (Mon-Fri), single role */
  weekdaySchedule: (opts: { roleId?: string; memberIds?: string[] } = {}): BaseScenarioConfig =>
    createSimpleConfig({
      roleId: opts.roleId ?? "staff",
      memberIds: opts.memberIds ?? ["alice", "bob", "charlie"],
      schedulingPeriod: {
        dateRange: { start: "2024-02-05", end: "2024-02-09" },
        dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      },
    }),

  /** Restaurant with morning and evening shifts */
  restaurantSplitShifts: (): BaseScenarioConfig => ({
    members: [
      { id: "chef1", roles: ["chef"] },
      { id: "chef2", roles: ["chef"] },
      { id: "waiter1", roles: ["waiter"] },
      { id: "waiter2", roles: ["waiter"] },
    ],
    shiftPatterns: [
      {
        id: "morning",
        roleIds: ["chef", "waiter"],
        startTime: { hours: 8, minutes: 0 },
        endTime: { hours: 14, minutes: 0 },
      },
      {
        id: "evening",
        roleIds: ["chef", "waiter"],
        startTime: { hours: 16, minutes: 0 },
        endTime: { hours: 22, minutes: 0 },
      },
    ],
    schedulingPeriod: DEFAULT_PERIOD,
    coverage: [
      {
        day: "2024-02-01",
        roleIds: ["chef"],
        startTime: { hours: 8, minutes: 0 },
        endTime: { hours: 14, minutes: 0 },
        targetCount: 1,
        priority: "MANDATORY",
      },
      {
        day: "2024-02-01",
        roleIds: ["waiter"],
        startTime: { hours: 8, minutes: 0 },
        endTime: { hours: 14, minutes: 0 },
        targetCount: 1,
        priority: "MANDATORY",
      },
      {
        day: "2024-02-01",
        roleIds: ["chef"],
        startTime: { hours: 16, minutes: 0 },
        endTime: { hours: 22, minutes: 0 },
        targetCount: 1,
        priority: "MANDATORY",
      },
      {
        day: "2024-02-01",
        roleIds: ["waiter"],
        startTime: { hours: 16, minutes: 0 },
        endTime: { hours: 22, minutes: 0 },
        targetCount: 1,
        priority: "MANDATORY",
      },
    ],
  }),
};
