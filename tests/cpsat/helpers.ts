// Re-export solver container utilities from testing
export { startSolverContainer } from "../../src/testing/solver-container.js";

import { HttpSolverClient } from "../../src/client.js";
import type { CompilationRule, ModelBuilderConfig } from "../../src/cpsat/model-builder.js";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import type {
  CoverageRequirement,
  ShiftPattern,
  SchedulingEmployee,
} from "../../src/cpsat/types.js";
import type { TimeOfDay, SchedulingPeriod } from "../../src/types.js";

export const decodeAssignments = (values: Record<string, number> = {}) =>
  Object.entries(values)
    .filter(([name, value]) => value === 1 && name.startsWith("assign:"))
    .map(([name]) => {
      const [, employeeId, shiftPatternId, day] = name.split(":");
      return { employeeId, shiftPatternId, day };
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

export class PatternPenaltyRule implements CompilationRule {
  constructor(
    private readonly patternId: string,
    private readonly weight: number,
  ) {}

  compile(b: ModelBuilder): void {
    const pattern = b.shiftPatterns.find((p) => p.id === this.patternId);
    if (!pattern) return;

    for (const emp of b.employees) {
      if (!b.canAssign(emp, pattern)) continue;
      for (const day of b.days) {
        b.addPenalty(b.assignment(emp.id, pattern.id, day), this.weight);
      }
    }
  }
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

/**
 * Creates a minimal single-role config for simple test scenarios.
 *
 * Use this when all employees share the same role and you just need
 * basic coverage. For multi-role or complex scenarios, build the config
 * explicitly or use createBaseConfig.
 *
 * @example
 * const config = createSimpleConfig({
 *   roleId: "waiter",
 *   employeeIds: ["alice", "bob"],
 *   schedulingPeriod: { specificDates: ["2024-02-01"] },
 * });
 */
export function createSimpleConfig(opts: {
  roleId: string;
  employeeIds: string[];
  shiftId?: string;
  shiftStart?: TimeOfDay;
  shiftEnd?: TimeOfDay;
  schedulingPeriod?: SchedulingPeriod;
  targetCount?: number;
}): BaseScenarioConfig {
  const schedulingPeriod = opts.schedulingPeriod ?? { specificDates: ["2024-02-01"] };
  const days =
    "specificDates" in schedulingPeriod
      ? (schedulingPeriod.specificDates ?? ["2024-02-01"])
      : ["2024-02-01"];
  const shiftStart = opts.shiftStart ?? { hours: 9, minutes: 0 };
  const shiftEnd = opts.shiftEnd ?? { hours: 17, minutes: 0 };
  const shiftId = opts.shiftId ?? "day";
  const roleIds: [string, ...string[]] = [opts.roleId];

  return {
    employees: opts.employeeIds.map((id) => ({ id, roleIds: [opts.roleId] })),
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
  employeeIds?: string[];
  /** Provide full employee objects for more control over roles/skills */
  employees?: SchedulingEmployee[];
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
 * 3. First role from first employee (if `employees` provided)
 * 4. Default "role"
 *
 * For complex multi-role scenarios, provide explicit `employees`, `shiftPatterns`,
 * and `coverage` to avoid implicit derivation issues.
 */
export const createBaseConfig = (overrides: BaseConfigOverrides = {}): BaseScenarioConfig => {
  // Derive roleIds: explicit roleIds > roleId > from employees > default
  const roleIds: [string, ...string[]] =
    overrides.roleIds ??
    (overrides.roleId ? [overrides.roleId] : null) ??
    (overrides.employees?.[0]?.roleIds as [string, ...string[]] | undefined) ?? ["role"];

  // Use provided employees or create from employeeIds
  const employees: SchedulingEmployee[] =
    overrides.employees ??
    (overrides.employeeIds ?? ["alice", "bob"]).map((id) => ({
      id,
      roleIds: [...roleIds],
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

  const schedulingPeriod = overrides.schedulingPeriod ?? { specificDates: ["2024-02-01"] };
  const days =
    "specificDates" in schedulingPeriod
      ? (schedulingPeriod.specificDates ?? ["2024-02-01"])
      : ["2024-02-01"];

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
    employees,
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
  /** Single day, single shift, two employees (alice, bob) */
  twoEmployeesOneShift: (): BaseScenarioConfig =>
    createSimpleConfig({
      roleId: "staff",
      employeeIds: ["alice", "bob"],
      schedulingPeriod: { specificDates: ["2024-02-01"] },
    }),

  /** Week of weekdays (Mon-Fri), single role */
  weekdaySchedule: (opts: { roleId?: string; employeeIds?: string[] } = {}): BaseScenarioConfig =>
    createSimpleConfig({
      roleId: opts.roleId ?? "staff",
      employeeIds: opts.employeeIds ?? ["alice", "bob", "charlie"],
      schedulingPeriod: {
        specificDates: [
          "2024-02-05", // Mon
          "2024-02-06", // Tue
          "2024-02-07", // Wed
          "2024-02-08", // Thu
          "2024-02-09", // Fri
        ],
      },
    }),

  /** Restaurant with morning and evening shifts */
  restaurantSplitShifts: (): BaseScenarioConfig => ({
    employees: [
      { id: "chef1", roleIds: ["chef"] },
      { id: "chef2", roleIds: ["chef"] },
      { id: "waiter1", roleIds: ["waiter"] },
      { id: "waiter2", roleIds: ["waiter"] },
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
    schedulingPeriod: { specificDates: ["2024-02-01"] },
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
