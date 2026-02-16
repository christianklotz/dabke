/**
 * High-level schedule definition API.
 *
 * Small, composable factory functions that produce a complete scheduling
 * configuration. Designed for LLM code generation: each concept is a single
 * function call with per-call type safety.
 *
 * @example
 * ```typescript
 * import {
 *   defineSchedule, t, time, cover, shift,
 *   maxHoursPerDay, maxHoursPerWeek, minRestBetweenShifts,
 *   weekdays, weekend,
 * } from "dabke";
 *
 * export default defineSchedule({
 *   roles: ["waiter", "runner", "manager"],
 *   skills: ["senior"],
 *
 *   times: {
 *     lunch: time({ start: t(12), end: t(15) }),
 *     dinner: time(
 *       { start: t(17), end: t(21) },
 *       { start: t(18), end: t(22), dayOfWeek: weekend },
 *     ),
 *   },
 *
 *   coverage: [
 *     cover("lunch", "waiter", 2),
 *     cover("dinner", "waiter", 4, { dayOfWeek: weekdays }),
 *     cover("dinner", "waiter", 5, { dayOfWeek: weekend }),
 *   ],
 *
 *   shiftPatterns: [
 *     shift("lunch_shift", t(12), t(15)),
 *     shift("evening", t(17), t(22)),
 *   ],
 *
 *   rules: [
 *     maxHoursPerDay(10),
 *     maxHoursPerWeek(48),
 *     minRestBetweenShifts(10),
 *   ],
 * });
 * ```
 *
 * @module
 */

import type { DayOfWeek, SchedulingPeriod, TimeOfDay } from "./types.js";
import type {
  SemanticTimeDef,
  SemanticTimeVariant,
  SemanticTimeEntry,
  MixedCoverageRequirement,
} from "./cpsat/semantic-time.js";
import { defineSemanticTimes } from "./cpsat/semantic-time.js";
import { resolveDaysFromPeriod } from "./datetime.utils.js";
import type { ModelBuilderConfig } from "./cpsat/model-builder.js";
import type { SchedulingEmployee, ShiftPattern, Priority } from "./cpsat/types.js";
import type { CpsatRuleConfigEntry } from "./cpsat/rules/rules.types.js";
import type { RecurringPeriod } from "./cpsat/rules/scope.types.js";

// ============================================================================
// Primitives
// ============================================================================

/** Creates a {@link TimeOfDay} value. */
export function t(hours: number, minutes = 0): TimeOfDay {
  return { hours, minutes };
}

/** Monday through Friday. */
export const weekdays: readonly DayOfWeek[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
] as const;

/** Saturday and Sunday. */
export const weekend: readonly DayOfWeek[] = ["saturday", "sunday"] as const;

// ============================================================================
// Semantic Times
// ============================================================================

/** A time entry within a {@link time} definition. */
export interface TimeEntry {
  /** When this time period starts. */
  start: TimeOfDay;
  /** When this time period ends. */
  end: TimeOfDay;
  /** Restrict this entry to specific days of the week. */
  dayOfWeek?: readonly DayOfWeek[];
  /** Restrict this entry to specific dates (YYYY-MM-DD). */
  dates?: string[];
}

/**
 * Defines a semantic time period, optionally with day/date-scoped entries.
 *
 * @remarks
 * Every argument is a {@link TimeEntry} with the same shape. An entry without
 * `dayOfWeek`/`dates` is the default (applies when no scoped entry matches).
 * At most one default entry is allowed. If no default, the time only exists
 * on the scoped days.
 *
 * Resolution precedence: `dates` > `dayOfWeek` > default.
 *
 * @example Every day
 * ```typescript
 * lunch: time({ start: t(12), end: t(15) }),
 * ```
 *
 * @example Default with weekend variant
 * ```typescript
 * dinner: time(
 *   { start: t(17), end: t(21) },
 *   { start: t(18), end: t(22), dayOfWeek: weekend },
 * ),
 * ```
 *
 * @example No default (specific days only)
 * ```typescript
 * happy_hour: time(
 *   { start: t(16), end: t(18), dayOfWeek: ["monday", "tuesday"] },
 *   { start: t(17), end: t(19), dayOfWeek: ["friday"] },
 * ),
 * ```
 */
export function time(...entries: [TimeEntry, ...TimeEntry[]]): SemanticTimeEntry {
  // Validate: at most one default (no dayOfWeek and no dates)
  const defaults = entries.filter((e) => !e.dayOfWeek && !e.dates);
  if (defaults.length > 1) {
    throw new Error(
      "time() accepts at most one default entry (without dayOfWeek or dates). " +
        `Found ${defaults.length} default entries.`,
    );
  }

  // Single entry without scoping: simple SemanticTimeDef
  if (entries.length === 1 && !entries[0].dayOfWeek && !entries[0].dates) {
    return {
      startTime: entries[0].start,
      endTime: entries[0].end,
    } satisfies SemanticTimeDef;
  }

  // Multiple entries or scoped entries: SemanticTimeVariant[]
  return entries.map((entry): SemanticTimeVariant => {
    const variant: SemanticTimeVariant = {
      startTime: entry.start,
      endTime: entry.end,
    };
    if (entry.dayOfWeek) variant.dayOfWeek = entry.dayOfWeek as DayOfWeek[];
    if (entry.dates) variant.dates = entry.dates;
    return variant;
  });
}

// ============================================================================
// Coverage
// ============================================================================

/** Options for a {@link cover} call. */
export interface CoverageOptions {
  /** Additional skill filter (AND logic with the target role). */
  skills?: [string, ...string[]];
  /** Restrict to specific days of the week. */
  dayOfWeek?: readonly DayOfWeek[];
  /** Restrict to specific dates (YYYY-MM-DD). */
  dates?: string[];
  /** Defaults to `"MANDATORY"`. */
  priority?: Priority;
}

/**
 * A coverage entry returned by {@link cover}.
 *
 * @remarks
 * Carries the semantic time name and target type information for
 * compile-time validation by {@link defineSchedule}.
 */
export interface CoverageEntry<T extends string = string, R extends string = string> {
  /** @internal */ readonly _type: "coverage";
  /** @internal */ readonly timeName: T;
  /** @internal */ readonly target: R | R[];
  /** @internal */ readonly count: number;
  /** @internal */ readonly options: CoverageOptions;
}

/**
 * Defines a staffing requirement for a semantic time period.
 *
 * @remarks
 * The `target` parameter is resolved against declared `roles` and `skills`:
 *
 * - Single string: matched against roles first, then skills
 * - Array of strings: OR logic (any of the listed roles)
 * - With `skills` option: role AND skill(s) filter
 *
 * @param timeName - Name of a declared semantic time
 * @param target - Role name, skill name, or array of role names (OR)
 * @param count - Number of people needed
 * @param opts - See {@link CoverageOptions}
 *
 * @example
 * ```typescript
 * cover("lunch", "waiter", 2),
 * cover("lunch", ["manager", "supervisor"], 1),
 * cover("dinner", "keyholder", 1),
 * cover("lunch", "waiter", 1, { skills: ["senior"] }),
 * cover("lunch", "waiter", 3, { dayOfWeek: weekend }),
 * ```
 */
export function cover<T extends string, R extends string>(
  timeName: T,
  target: R | [R, ...R[]],
  count: number,
  opts?: CoverageOptions,
): CoverageEntry<T, R> {
  return {
    _type: "coverage",
    timeName,
    target,
    count,
    options: opts ?? {},
  };
}

// ============================================================================
// Shift Patterns
// ============================================================================

/** Options for a {@link shift} call. */
export interface ShiftOptions {
  /** Restrict who can work this shift by role. */
  roles?: [string, ...string[]];
  /** Restrict which days this shift is available. */
  dayOfWeek?: readonly DayOfWeek[];
  /** Physical location for this shift. */
  locationId?: string;
}

/**
 * A shift pattern definition returned by {@link shift}.
 */
export interface ShiftPatternDef {
  /** @internal */ readonly _type: "shiftPattern";
  readonly id: string;
  readonly startTime: TimeOfDay;
  readonly endTime: TimeOfDay;
  readonly options: ShiftOptions;
}

/**
 * Defines a shift pattern (time slot template).
 *
 * @param id - Unique identifier for this shift pattern
 * @param startTime - When the shift starts
 * @param endTime - When the shift ends
 * @param opts - See {@link ShiftOptions}
 *
 * @example
 * ```typescript
 * shift("morning", t(11, 30), t(15)),
 * shift("evening", t(17), t(22)),
 * shift("kitchen", t(6), t(14), { roles: ["chef", "prep_cook"] }),
 * ```
 */
export function shift(
  id: string,
  startTime: TimeOfDay,
  endTime: TimeOfDay,
  opts?: ShiftOptions,
): ShiftPatternDef {
  return {
    _type: "shiftPattern",
    id,
    startTime,
    endTime,
    options: opts ?? {},
  };
}

// ============================================================================
// Rules
// ============================================================================

/**
 * Scoping options shared by most rule functions.
 *
 * @remarks
 * `appliesTo` is resolved against declared roles, then skills, then runtime
 * member IDs. The namespaces are guaranteed disjoint by validation.
 */
export interface RuleOptions {
  /** Who this rule applies to (role name, skill name, or member ID). */
  appliesTo?: string | string[];
  /** Restrict to specific days of the week. */
  dayOfWeek?: readonly DayOfWeek[];
  /** Restrict to a date range. */
  dateRange?: { start: string; end: string };
  /** Restrict to specific dates (YYYY-MM-DD). */
  dates?: string[];
  /** Restrict to recurring calendar periods. */
  recurringPeriods?: [RecurringPeriod, ...RecurringPeriod[]];
  /** Defaults to `"MANDATORY"`. */
  priority?: Priority;
}

/** Options for rules that support entity scoping only (no time scoping). */
export interface EntityOnlyRuleOptions {
  appliesTo?: string | string[];
  priority?: Priority;
}

/** Options for {@link timeOff}. Time scoping is required. */
export interface TimeOffOptions {
  appliesTo?: string | string[];
  /** Off from this time until end of day. */
  from?: TimeOfDay;
  /** Off from start of day until this time. */
  until?: TimeOfDay;
  dayOfWeek?: readonly DayOfWeek[];
  dateRange?: { start: string; end: string };
  dates?: string[];
  recurringPeriods?: [RecurringPeriod, ...RecurringPeriod[]];
  priority?: Priority;
}

/** Options for {@link assignTogether}. */
export interface AssignTogetherOptions {
  priority?: Priority;
}

// Internal rule entry type
interface RuleEntryBase {
  readonly _type: "rule";
  readonly _rule: string;
}

/** An opaque rule entry returned by rule functions. */
export type RuleEntry = RuleEntryBase & Record<string, unknown>;

function makeRule(rule: string, fields: Record<string, unknown>): RuleEntry {
  return { _type: "rule", _rule: rule, ...fields };
}

/**
 * Limits how many hours a person can work in a single day.
 *
 * @param hours - Maximum hours per day
 * @param opts - Entity and time scoping
 */
export function maxHoursPerDay(hours: number, opts?: RuleOptions): RuleEntry {
  return makeRule("max-hours-day", { hours, ...opts });
}

/**
 * Caps total hours a person can work within each scheduling week.
 *
 * @param hours - Maximum hours per week
 * @param opts - Entity and time scoping
 */
export function maxHoursPerWeek(hours: number, opts?: RuleOptions): RuleEntry {
  return makeRule("max-hours-week", { hours, ...opts });
}

/**
 * Ensures a person works at least a minimum number of hours per day.
 *
 * @param hours - Minimum hours per day
 * @param opts - Entity scoping only
 */
export function minHoursPerDay(hours: number, opts?: EntityOnlyRuleOptions): RuleEntry {
  return makeRule("min-hours-day", { hours, ...opts });
}

/**
 * Enforces a minimum total number of hours per scheduling week.
 *
 * @param hours - Minimum hours per week
 * @param opts - Entity scoping only
 */
export function minHoursPerWeek(hours: number, opts?: EntityOnlyRuleOptions): RuleEntry {
  return makeRule("min-hours-week", { hours, ...opts });
}

/**
 * Limits how many shifts a person can work in a single day.
 *
 * @param shifts - Maximum shifts per day
 * @param opts - Entity and time scoping
 */
export function maxShiftsPerDay(shifts: number, opts?: RuleOptions): RuleEntry {
  return makeRule("max-shifts-day", { shifts, ...opts });
}

/**
 * Limits how many consecutive days a person can be assigned.
 *
 * @param days - Maximum consecutive days
 * @param opts - Entity scoping only
 */
export function maxConsecutiveDays(days: number, opts?: EntityOnlyRuleOptions): RuleEntry {
  return makeRule("max-consecutive-days", { days, ...opts });
}

/**
 * Requires that once a person starts working, they continue for a minimum
 * number of consecutive days.
 *
 * @param days - Minimum consecutive days
 * @param opts - Entity scoping only
 */
export function minConsecutiveDays(days: number, opts?: EntityOnlyRuleOptions): RuleEntry {
  return makeRule("min-consecutive-days", { days, ...opts });
}

/**
 * Enforces a minimum rest period between any two shifts a person works.
 *
 * @param hours - Minimum rest hours between shifts
 * @param opts - Entity scoping only
 */
export function minRestBetweenShifts(hours: number, opts?: EntityOnlyRuleOptions): RuleEntry {
  return makeRule("min-rest-between-shifts", { hours, ...opts });
}

/**
 * Adds objective weight to prefer or avoid assigning team members.
 *
 * @param level - `"high"` to prefer assigning, `"low"` to avoid
 * @param opts - Entity and time scoping (no priority; preference is the priority mechanism)
 */
export function preference(level: "high" | "low", opts?: Omit<RuleOptions, "priority">): RuleEntry {
  return makeRule("employee-assignment-priority", { preference: level, ...opts });
}

/**
 * Prefers assigning a person to shift patterns at a specific location.
 *
 * @param locationId - The location to prefer
 * @param opts - Entity scoping only
 */
export function preferLocation(locationId: string, opts?: EntityOnlyRuleOptions): RuleEntry {
  return makeRule("location-preference", { locationId, ...opts });
}

/**
 * Blocks or penalizes assignments during specified time periods.
 *
 * @remarks
 * At least one time scoping field is required (`dayOfWeek`, `dateRange`,
 * `dates`, or `recurringPeriods`).
 *
 * Use `from` for "off from this time until end of day" and `until` for
 * "off from start of day until this time."
 *
 * @param opts - See {@link TimeOffOptions}
 *
 * @example
 * ```typescript
 * timeOff({ appliesTo: "mauro", dayOfWeek: weekend }),
 * timeOff({ appliesTo: "student", dayOfWeek: ["wednesday"], from: t(14) }),
 * timeOff({ appliesTo: "alice", dateRange: { start: "2024-02-01", end: "2024-02-05" } }),
 * ```
 */
export function timeOff(opts: TimeOffOptions): RuleEntry {
  return makeRule("time-off", { ...opts });
}

/**
 * Encourages or enforces that team members work the same shifts on a day.
 *
 * @param members - At least 2 member IDs
 * @param opts - See {@link AssignTogetherOptions}
 *
 * @example
 * ```typescript
 * assignTogether(["alice", "bob"], { priority: "HIGH" }),
 * ```
 */
export function assignTogether(
  members: [string, string, ...string[]],
  opts?: AssignTogetherOptions,
): RuleEntry {
  return makeRule("assign-together", { members, ...opts });
}

// ============================================================================
// Schedule Definition
// ============================================================================

/** A team member available for scheduling. */
export interface SchedulingMember {
  /** Unique identifier. Must not contain colons or collide with role/skill names. */
  id: string;
  /** Roles this member can fill. Each must be a declared role. */
  roles: string[];
  /** Skills this member has. Each must be a declared skill. */
  skills?: string[];
}

/** Runtime arguments passed to {@link ScheduleDefinition.createSchedulerConfig}. */
export interface RuntimeArgs {
  /** The scheduling period (date range + optional filters). */
  schedulingPeriod: SchedulingPeriod;
  /** Team members available for this scheduling run. */
  members: SchedulingMember[];
  /** Ad-hoc rules injected at runtime (e.g., vacation, holiday closures). */
  runtimeRules?: RuleEntry[];
}

/** Result of {@link defineSchedule}. */
export interface ScheduleDefinition {
  /** Produce a {@link ModelBuilderConfig} for the solver. */
  createSchedulerConfig(args: RuntimeArgs): ModelBuilderConfig;
  /** Declared role names. */
  readonly roles: readonly string[];
  /** Declared skill names. */
  readonly skills: readonly string[];
  /** Names of declared semantic times. */
  readonly timeNames: readonly string[];
  /** Shift pattern IDs. */
  readonly shiftPatternIds: readonly string[];
  /** Internal rule identifiers in kebab-case (e.g., "max-hours-day", "time-off"). */
  readonly ruleNames: readonly string[];
}

/** Configuration for {@link defineSchedule}. */
export interface ScheduleConfig<
  R extends readonly string[],
  S extends readonly string[],
  T extends Record<string, SemanticTimeEntry>,
> {
  /** Declared role names. */
  roles: R;
  /** Declared skill names. */
  skills?: S;
  /** Named semantic time periods. */
  times: T;
  /** Staffing requirements per time period. */
  coverage: CoverageEntry<keyof T & string, R[number] | NonNullable<S>[number]>[];
  /** Available shift patterns. */
  shiftPatterns: ShiftPatternDef[];
  /** Scheduling rules and constraints. */
  rules?: RuleEntry[];
  /** Days of the week the business operates (inclusion filter). */
  dayOfWeek?: readonly DayOfWeek[];
  /** Which day starts the week for weekly rules. Defaults to `"monday"`. */
  weekStartsOn?: DayOfWeek;
}

/**
 * Defines a complete schedule configuration.
 *
 * @remarks
 * Validates the static config at call time (role/skill disjointness, coverage
 * targets, shift pattern roles). Returns a {@link ScheduleDefinition} whose
 * `createSchedulerConfig` method validates runtime data (member IDs,
 * `appliesTo` resolution) and produces a {@link ModelBuilderConfig}.
 *
 * @example
 * ```typescript
 * import { defineSchedule, t, time, cover, shift, maxHoursPerDay } from "dabke";
 *
 * export default defineSchedule({
 *   roles: ["waiter", "manager"],
 *   times: { lunch: time({ start: t(12), end: t(15) }) },
 *   coverage: [cover("lunch", "waiter", 2)],
 *   shiftPatterns: [shift("lunch_shift", t(12), t(15))],
 *   rules: [maxHoursPerDay(10)],
 * });
 * ```
 */
export function defineSchedule<
  const R extends readonly string[],
  const S extends readonly string[],
  const T extends Record<string, SemanticTimeEntry>,
>(config: ScheduleConfig<R, S, T>): ScheduleDefinition {
  const roles = new Set<string>(config.roles);
  const skills = new Set<string>(config.skills ?? []);

  // Validate role/skill disjointness
  for (const skill of skills) {
    if (roles.has(skill)) {
      throw new Error(
        `"${skill}" is declared as both a role and a skill. Roles and skills must be disjoint.`,
      );
    }
  }

  // Validate shift pattern role references
  for (const sp of config.shiftPatterns) {
    if (sp.options.roles) {
      for (const role of sp.options.roles) {
        if (!roles.has(role)) {
          throw new Error(
            `Shift pattern "${sp.id}" references unknown role "${role}". ` +
              `Declared roles: ${[...roles].join(", ")}`,
          );
        }
      }
    }
  }

  // Validate coverage entries
  for (const entry of config.coverage) {
    const targets = Array.isArray(entry.target) ? entry.target : [entry.target];
    if (Array.isArray(entry.target)) {
      // Array target: all must be roles (OR logic)
      for (const target of targets) {
        if (!roles.has(target)) {
          throw new Error(
            `Coverage for "${entry.timeName}" references "${target}" in a role OR group, ` +
              `but it is not a declared role. Declared roles: ${[...roles].join(", ")}`,
          );
        }
      }
    } else {
      // Single target: must be role or skill
      if (!roles.has(entry.target) && !skills.has(entry.target)) {
        throw new Error(
          `Coverage for "${entry.timeName}" references unknown target "${entry.target}". ` +
            `Declared roles: ${[...roles].join(", ")}. ` +
            `Declared skills: ${[...skills].join(", ")}`,
        );
      }
    }
    // Validate skills option
    if (entry.options.skills) {
      for (const s of entry.options.skills) {
        if (!skills.has(s)) {
          throw new Error(
            `Coverage for "${entry.timeName}" uses skill filter "${s}" ` +
              `which is not a declared skill. Declared skills: ${[...skills].join(", ")}`,
          );
        }
      }
    }
  }

  // Build semantic time context
  const semanticTimes = defineSemanticTimes(config.times);

  // Convert coverage entries to semantic coverage requirements
  const coverageReqs = buildCoverageRequirements(config.coverage, roles, skills);

  // Convert shift pattern defs to internal ShiftPattern type
  const shiftPatterns = buildShiftPatterns(config.shiftPatterns);

  return {
    roles: config.roles as readonly string[],
    skills: (config.skills ?? []) as readonly string[],
    timeNames: Object.keys(config.times) as readonly string[],
    shiftPatternIds: config.shiftPatterns.map((sp) => sp.id) as readonly string[],
    ruleNames: (config.rules ?? []).map((r: RuleEntry) => r._rule) as readonly string[],
    createSchedulerConfig(args: RuntimeArgs): ModelBuilderConfig {
      // Detect duplicate member IDs
      const memberIds = new Set<string>();
      for (const member of args.members) {
        if (memberIds.has(member.id)) {
          throw new Error(`Duplicate member ID "${member.id}".`);
        }
        memberIds.add(member.id);
      }

      // Validate member IDs don't collide with roles/skills
      for (const member of args.members) {
        if (roles.has(member.id)) {
          throw new Error(`Member ID "${member.id}" collides with a declared role name.`);
        }
        if (skills.has(member.id)) {
          throw new Error(`Member ID "${member.id}" collides with a declared skill name.`);
        }
      }

      // Validate member roles/skills reference declared roles/skills
      for (const member of args.members) {
        for (const role of member.roles) {
          if (!roles.has(role)) {
            throw new Error(
              `Member "${member.id}" references unknown role "${role}". ` +
                `Declared roles: ${[...roles].join(", ")}`,
            );
          }
        }
        if (member.skills) {
          for (const skill of member.skills) {
            if (!skills.has(skill)) {
              throw new Error(
                `Member "${member.id}" references unknown skill "${skill}". ` +
                  `Declared skills: ${[...skills].join(", ")}`,
              );
            }
          }
        }
      }

      // Convert members to SchedulingEmployee
      const employees: SchedulingEmployee[] = args.members.map((m) => ({
        id: m.id,
        roleIds: m.roles,
        skillIds: m.skills,
      }));

      // Resolve rules
      const specRules = config.rules ?? [];
      const runtimeRules = args.runtimeRules ?? [];
      const allRules = [...specRules, ...runtimeRules];
      const ruleConfigs = resolveRules(allRules, roles, skills, memberIds);

      // Resolve scheduling period with dayOfWeek filter
      const resolvedPeriod = applyDaysFilter(args.schedulingPeriod, config.dayOfWeek);
      const days = resolveDaysFromPeriod(resolvedPeriod);

      // Resolve coverage
      const resolvedCoverage = semanticTimes.resolve(coverageReqs, days);

      return {
        employees,
        shiftPatterns,
        schedulingPeriod: resolvedPeriod,
        coverage: resolvedCoverage,
        ruleConfigs,
        weekStartsOn: config.weekStartsOn,
      };
    },
  };
}

// ============================================================================
// Internal: Coverage Translation
// ============================================================================

function buildCoverageRequirements<T extends string>(
  entries: CoverageEntry<T, string>[],
  roles: Set<string>,
  skills: Set<string>,
): MixedCoverageRequirement<T>[] {
  return entries.map((entry) => {
    const base: {
      semanticTime: T;
      targetCount: number;
      priority?: Priority;
      dayOfWeek?: DayOfWeek[];
      dates?: string[];
    } = {
      semanticTime: entry.timeName,
      targetCount: entry.count,
    };

    if (entry.options.priority) base.priority = entry.options.priority;
    if (entry.options.dayOfWeek) base.dayOfWeek = entry.options.dayOfWeek as DayOfWeek[];
    if (entry.options.dates) base.dates = entry.options.dates;

    if (Array.isArray(entry.target)) {
      // Array = OR of roles
      return {
        ...base,
        roleIds: entry.target as [string, ...string[]],
      } satisfies MixedCoverageRequirement<T>;
    }

    // Single target
    const singleTarget = entry.target as string;
    if (roles.has(singleTarget)) {
      // Role-based coverage, optionally with skill filter
      if (entry.options.skills) {
        return {
          ...base,
          roleIds: [singleTarget] as [string, ...string[]],
          skillIds: entry.options.skills,
        } satisfies MixedCoverageRequirement<T>;
      }
      return {
        ...base,
        roleIds: [singleTarget] as [string, ...string[]],
      } satisfies MixedCoverageRequirement<T>;
    }

    if (skills.has(singleTarget)) {
      // Skill-based coverage
      return {
        ...base,
        skillIds: [singleTarget] as [string, ...string[]],
      } satisfies MixedCoverageRequirement<T>;
    }

    // Should not reach here due to validation in defineSchedule
    throw new Error(`Coverage target "${singleTarget}" is not a declared role or skill.`);
  }) as MixedCoverageRequirement<T>[];
}

// ============================================================================
// Internal: Shift Pattern Translation
// ============================================================================

function buildShiftPatterns(defs: ShiftPatternDef[]): ShiftPattern[] {
  return defs.map((def) => {
    const pattern: ShiftPattern = {
      id: def.id,
      startTime: def.startTime,
      endTime: def.endTime,
    };
    if (def.options.roles) pattern.roleIds = def.options.roles;
    if (def.options.dayOfWeek) pattern.dayOfWeek = def.options.dayOfWeek as DayOfWeek[];
    if (def.options.locationId) pattern.locationId = def.options.locationId;
    return pattern;
  });
}

// ============================================================================
// Internal: Rule Translation
// ============================================================================

/**
 * Resolves an `appliesTo` value into v1 entity scope fields.
 *
 * Each target string is checked against roles, skills, then member IDs.
 * If all targets resolve to the same namespace, they are combined into one
 * scope field. If they span namespaces, an error is thrown (the caller should
 * use separate rule entries).
 */
function resolveAppliesTo(
  appliesTo: string | string[] | undefined,
  roles: Set<string>,
  skills: Set<string>,
  memberIds: Set<string>,
): {
  employeeIds?: [string, ...string[]];
  roleIds?: [string, ...string[]];
  skillIds?: [string, ...string[]];
} {
  if (!appliesTo) return {};

  const targets = Array.isArray(appliesTo) ? appliesTo : [appliesTo];
  if (targets.length === 0) return {};

  const resolvedRoles: string[] = [];
  const resolvedSkills: string[] = [];
  const resolvedMembers: string[] = [];

  for (const target of targets) {
    if (roles.has(target)) {
      resolvedRoles.push(target);
    } else if (skills.has(target)) {
      resolvedSkills.push(target);
    } else if (memberIds.has(target)) {
      resolvedMembers.push(target);
    } else {
      throw new Error(`appliesTo target "${target}" is not a declared role, skill, or member ID.`);
    }
  }

  // Count how many namespaces were used
  const namespacesUsed = [resolvedRoles, resolvedSkills, resolvedMembers].filter(
    (arr) => arr.length > 0,
  ).length;

  if (namespacesUsed > 1) {
    // Mixed namespaces: not supported in a single v1 rule config.
    // For now, throw an error with guidance.
    throw new Error(
      `appliesTo targets span multiple namespaces (roles: [${resolvedRoles.join(", ")}], ` +
        `skills: [${resolvedSkills.join(", ")}], members: [${resolvedMembers.join(", ")}]). ` +
        `Use separate rule entries for each namespace.`,
    );
  }

  if (resolvedRoles.length > 0) {
    return { roleIds: resolvedRoles as [string, ...string[]] };
  }
  if (resolvedSkills.length > 0) {
    return { skillIds: resolvedSkills as [string, ...string[]] };
  }
  if (resolvedMembers.length > 0) {
    return { employeeIds: resolvedMembers as [string, ...string[]] };
  }
  return {};
}

function resolveTimeScope(entry: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (entry.dayOfWeek) result.dayOfWeek = entry.dayOfWeek;
  if (entry.dateRange) result.dateRange = entry.dateRange;
  if (entry.dates) result.specificDates = entry.dates;
  if (entry.recurringPeriods) result.recurringPeriods = entry.recurringPeriods;
  return result;
}

function resolveRules(
  rules: RuleEntry[],
  roles: Set<string>,
  skills: Set<string>,
  memberIds: Set<string>,
): CpsatRuleConfigEntry[] {
  return rules.map((rule) => {
    const { _type, _rule, appliesTo, ...rest } = rule as RuleEntry & {
      appliesTo?: string | string[];
    };

    const entityScope =
      _rule === "assign-together" ? {} : resolveAppliesTo(appliesTo, roles, skills, memberIds);

    switch (_rule) {
      case "max-hours-day":
        return {
          name: "max-hours-day" as const,
          hours: rest.hours as number,
          priority: (rest.priority as Priority) ?? "MANDATORY",
          ...entityScope,
          ...resolveTimeScope(rest),
        };

      case "max-hours-week":
        return {
          name: "max-hours-week" as const,
          hours: rest.hours as number,
          priority: (rest.priority as Priority) ?? "MANDATORY",
          ...entityScope,
          ...resolveTimeScope(rest),
        };

      case "min-hours-day":
        return {
          name: "min-hours-day" as const,
          hours: rest.hours as number,
          priority: (rest.priority as Priority) ?? "MANDATORY",
          ...entityScope,
        };

      case "min-hours-week":
        return {
          name: "min-hours-week" as const,
          hours: rest.hours as number,
          priority: (rest.priority as Priority) ?? "MANDATORY",
          ...entityScope,
        };

      case "max-shifts-day":
        return {
          name: "max-shifts-day" as const,
          shifts: rest.shifts as number,
          priority: (rest.priority as Priority) ?? "MANDATORY",
          ...entityScope,
          ...resolveTimeScope(rest),
        };

      case "max-consecutive-days":
        return {
          name: "max-consecutive-days" as const,
          days: rest.days as number,
          priority: (rest.priority as Priority) ?? "MANDATORY",
          ...entityScope,
        };

      case "min-consecutive-days":
        return {
          name: "min-consecutive-days" as const,
          days: rest.days as number,
          priority: (rest.priority as Priority) ?? "MANDATORY",
          ...entityScope,
        };

      case "min-rest-between-shifts":
        return {
          name: "min-rest-between-shifts" as const,
          hours: rest.hours as number,
          priority: (rest.priority as Priority) ?? "MANDATORY",
          ...entityScope,
        };

      case "employee-assignment-priority":
        return {
          name: "employee-assignment-priority" as const,
          preference: rest.preference as "high" | "low",
          ...entityScope,
          ...resolveTimeScope(rest),
        };

      case "location-preference":
        return {
          name: "location-preference" as const,
          locationId: rest.locationId as string,
          priority: (rest.priority as Priority) ?? "MANDATORY",
          ...entityScope,
        };

      case "time-off": {
        const timeScope = resolveTimeScope(rest);
        const hasTimeScope =
          timeScope.dayOfWeek ||
          timeScope.dateRange ||
          timeScope.specificDates ||
          timeScope.recurringPeriods;
        if (!hasTimeScope) {
          throw new Error(
            "timeOff() requires at least one time scope (dayOfWeek, dateRange, dates, or recurringPeriods).",
          );
        }

        const config: Record<string, unknown> = {
          name: "time-off" as const,
          priority: (rest.priority as Priority) ?? "MANDATORY",
          ...entityScope,
          ...timeScope,
        };

        // Partial day support
        if (rest.from && rest.until) {
          config.startTime = rest.from;
          config.endTime = rest.until;
        } else if (rest.from) {
          config.startTime = rest.from;
          config.endTime = { hours: 23, minutes: 59 };
        } else if (rest.until) {
          config.startTime = { hours: 0, minutes: 0 };
          config.endTime = rest.until;
        }

        return config as CpsatRuleConfigEntry;
      }

      case "assign-together": {
        const members = rest.members as [string, string, ...string[]];
        for (const member of members) {
          if (!memberIds.has(member)) {
            throw new Error(
              `assignTogether references unknown member "${member}". ` +
                `Known member IDs: ${[...memberIds].join(", ")}`,
            );
          }
        }
        return {
          name: "assign-together" as const,
          groupEmployeeIds: members,
          priority: (rest.priority as Priority) ?? "MANDATORY",
        };
      }

      default:
        throw new Error(`Unknown rule type: ${_rule}`);
    }
  }) as CpsatRuleConfigEntry[];
}

// ============================================================================
// Internal: Scheduling Period Helpers
// ============================================================================

function applyDaysFilter(
  schedulingPeriod: SchedulingPeriod,
  dayOfWeek?: readonly DayOfWeek[],
): SchedulingPeriod {
  if (!dayOfWeek || dayOfWeek.length === 0) {
    return schedulingPeriod;
  }

  const existingDays = schedulingPeriod.dayOfWeek;
  if (!existingDays || existingDays.length === 0) {
    return { ...schedulingPeriod, dayOfWeek: dayOfWeek as DayOfWeek[] };
  }

  const existingSet = new Set(existingDays);
  const intersected = dayOfWeek.filter((day) => existingSet.has(day)) as DayOfWeek[];
  return { ...schedulingPeriod, dayOfWeek: intersected };
}
