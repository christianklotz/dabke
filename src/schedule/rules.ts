/**
 * Scheduling rules: constraints, preferences, and time-off.
 *
 * @module
 */

import type { DayOfWeek, TimeOfDay } from "../types.js";
import type { Priority } from "../cpsat/types.js";
import type { CpsatRuleName, CpsatRuleConfigEntry } from "../cpsat/rules/rules.types.js";
import type { RecurringPeriod } from "../cpsat/rules/scope.types.js";

// ============================================================================
// Rule Options
// ============================================================================

/**
 * Scoping options shared by most rule functions.
 *
 * @remarks
 * Default priority is `MANDATORY`. Use `appliesTo` to scope to a
 * role, skill, or member ID. Use time scoping options (`dayOfWeek`,
 * `dateRange`, `dates`) to limit when the rule applies.
 * Not all rules support all scoping options. Entity-only rules
 * (e.g., {@link maxConsecutiveDays}) ignore time scoping.
 *
 * @category Rules
 */
export interface RuleOptions {
  /** Who this rule applies to (role name, skill name, or member ID). */
  appliesTo?: string | string[];
  /** Restrict to specific days of the week. */
  dayOfWeek?: readonly [DayOfWeek, ...DayOfWeek[]];
  /** Restrict to a date range. */
  dateRange?: { start: string; end: string };
  /** Restrict to specific dates (YYYY-MM-DD). */
  dates?: string[];
  /** Restrict to recurring calendar periods. */
  recurringPeriods?: [RecurringPeriod, ...RecurringPeriod[]];
  /** Defaults to `"MANDATORY"`. */
  priority?: Priority;
}

/**
 * Options for rules that support entity scoping only (no time scoping).
 *
 * @remarks
 * Used by rules whose semantics are inherently per-day or per-week
 * (e.g., {@link minHoursPerDay}, {@link maxConsecutiveDays}) and cannot
 * be meaningfully restricted to a date range or day of week.
 *
 * @category Rules
 */
export interface EntityOnlyRuleOptions {
  /** Who this rule applies to (role name, skill name, or member ID). */
  appliesTo?: string | string[];
  /** Defaults to `"MANDATORY"`. */
  priority?: Priority;
}

/**
 * Options for {@link timeOff}.
 *
 * @remarks
 * At least one time scoping field is required (`dayOfWeek`, `dateRange`,
 * `dates`, or `recurringPeriods`). Use `from`/`until` to block only part
 * of a day.
 *
 * @category Rules
 */
export interface TimeOffOptions {
  /** Who this rule applies to (role name, skill name, or member ID). */
  appliesTo?: string | string[];
  /** Off from this time until end of day. */
  from?: TimeOfDay;
  /** Off from start of day until this time. */
  until?: TimeOfDay;
  /** Restrict to specific days of the week. */
  dayOfWeek?: readonly [DayOfWeek, ...DayOfWeek[]];
  /** Restrict to a date range. */
  dateRange?: { start: string; end: string };
  /** Restrict to specific dates (YYYY-MM-DD). */
  dates?: string[];
  /** Restrict to recurring calendar periods. */
  recurringPeriods?: [RecurringPeriod, ...RecurringPeriod[]];
  /** Defaults to `"MANDATORY"`. */
  priority?: Priority;
}

/**
 * Options for {@link assignTogether}.
 *
 * @category Rules
 */
export interface AssignTogetherOptions {
  /** Defaults to `"MANDATORY"`. */
  priority?: Priority;
}

// ============================================================================
// Rule Entry
// ============================================================================

/**
 * Context passed to a rule's resolve function during compilation.
 *
 * Contains the declared roles, skills, and member IDs so the resolver
 * can translate user-facing fields (like `appliesTo`) into internal
 * scoping fields.
 */
export interface RuleResolveContext {
  readonly roles: ReadonlySet<string>;
  readonly skills: ReadonlySet<string>;
  readonly memberIds: ReadonlySet<string>;
}

// Internal rule entry type
interface RuleEntryBase {
  readonly _type: "rule";
  readonly _rule: string;
  /**
   * Optional custom resolver. When present, `resolveRules()` calls this
   * instead of the default translation path. Built-in rules that need
   * special field mapping (e.g., `timeOff`, `assignTogether`) attach one;
   * all other rules use the default resolver.
   */
  readonly _resolve?: (ctx: RuleResolveContext) => Record<string, unknown> & { name: string };
}

/**
 * An opaque rule entry returned by rule functions.
 *
 * @remarks
 * Pass these directly into the `rules` array of {@link ScheduleConfig}.
 * The internal fields are resolved during compilation.
 */
export type RuleEntry = RuleEntryBase & Record<string, unknown>;

/**
 * Creates a rule entry for use in {@link ScheduleConfig.rules}.
 *
 * Built-in rules use the helpers (`maxHoursPerDay`, `timeOff`, etc.).
 * Custom rules can use `defineRule` to create entries that plug into the
 * same resolution and compilation pipeline.
 *
 * @param name - Rule name. Must match a key in the rule factory registry.
 * @param fields - Rule-specific configuration fields.
 * @param resolve - Optional custom resolver. When omitted, the default
 *   resolution applies: `appliesTo` is mapped to `roleIds`/`skillIds`/`memberIds`,
 *   `dates` is renamed to `specificDates`, and all other fields pass through.
 */
export function defineRule(
  name: string,
  fields: Record<string, unknown>,
  resolve?: (ctx: RuleResolveContext) => Record<string, unknown> & { name: string },
): RuleEntry {
  const { _type: _, _rule: __, ...safeFields } = fields;
  const entry: RuleEntry = { _type: "rule", _rule: name, ...safeFields };
  if (resolve) {
    Object.defineProperty(entry, "_resolve", { value: resolve, enumerable: false });
  }
  return entry;
}

function makeRule(rule: CpsatRuleName, fields: Record<string, unknown>): RuleEntry {
  return defineRule(rule, fields);
}

// ============================================================================
// Constraint Rules
// ============================================================================

/**
 * Limits hours per day.
 *
 * @example
 * ```typescript
 * maxHoursPerDay(10)
 * maxHoursPerDay(4, { appliesTo: "student", dayOfWeek: weekdays })
 * ```
 *
 * @category Rules
 */
export function maxHoursPerDay(hours: number, opts?: RuleOptions): RuleEntry {
  return makeRule("max-hours-day", { hours, ...opts });
}

/**
 * Limits hours per scheduling week.
 *
 * @example
 * ```typescript
 * maxHoursPerWeek(48)
 * maxHoursPerWeek(20, { appliesTo: "student" })
 * ```
 *
 * @category Rules
 */
export function maxHoursPerWeek(hours: number, opts?: RuleOptions): RuleEntry {
  return makeRule("max-hours-week", { hours, ...opts });
}

/**
 * Minimum hours when assigned on a day.
 *
 * @example
 * ```typescript
 * minHoursPerDay(4)
 * ```
 *
 * @category Rules
 */
export function minHoursPerDay(hours: number, opts?: EntityOnlyRuleOptions): RuleEntry {
  return makeRule("min-hours-day", { hours, ...opts });
}

/**
 * Minimum hours per scheduling week.
 *
 * @example
 * ```typescript
 * minHoursPerWeek(20, { priority: "HIGH" })
 * ```
 *
 * @category Rules
 */
export function minHoursPerWeek(hours: number, opts?: EntityOnlyRuleOptions): RuleEntry {
  return makeRule("min-hours-week", { hours, ...opts });
}

/**
 * Limits working days per scheduling week.
 *
 * @example
 * ```typescript
 * maxDaysPerWeek(5)
 * maxDaysPerWeek(3, { appliesTo: "part-time" })
 * ```
 *
 * @category Rules
 */
export function maxDaysPerWeek(days: number, opts?: RuleOptions): RuleEntry {
  return makeRule("max-days-week", { days, ...opts });
}

/**
 * Minimum working days per scheduling week.
 *
 * @example
 * ```typescript
 * minDaysPerWeek(3, { priority: "HIGH" })
 * minDaysPerWeek(5, { appliesTo: "full-time" })
 * ```
 *
 * @category Rules
 */
export function minDaysPerWeek(days: number, opts?: EntityOnlyRuleOptions): RuleEntry {
  return makeRule("min-days-week", { days, ...opts });
}

/**
 * Maximum distinct shifts per day.
 *
 * @example
 * ```typescript
 * maxShiftsPerDay(1)
 * maxShiftsPerDay(2, { appliesTo: "student", dayOfWeek: weekend })
 * ```
 *
 * @category Rules
 */
export function maxShiftsPerDay(shifts: number, opts?: RuleOptions): RuleEntry {
  return makeRule("max-shifts-day", { shifts, ...opts });
}

/**
 * Maximum consecutive working days.
 *
 * @example
 * ```typescript
 * maxConsecutiveDays(5)
 * ```
 *
 * @category Rules
 */
export function maxConsecutiveDays(days: number, opts?: EntityOnlyRuleOptions): RuleEntry {
  return makeRule("max-consecutive-days", { days, ...opts });
}

/**
 * Once working, continue for at least this many consecutive days.
 *
 * @example
 * ```typescript
 * minConsecutiveDays(2, { priority: "HIGH" })
 * ```
 *
 * @category Rules
 */
export function minConsecutiveDays(days: number, opts?: EntityOnlyRuleOptions): RuleEntry {
  return makeRule("min-consecutive-days", { days, ...opts });
}

/**
 * Minimum rest hours between shifts.
 *
 * @example
 * ```typescript
 * minRestBetweenShifts(10)
 * ```
 *
 * @category Rules
 */
export function minRestBetweenShifts(hours: number, opts?: EntityOnlyRuleOptions): RuleEntry {
  return makeRule("min-rest-between-shifts", { hours, ...opts });
}

/**
 * Prefer (`"high"`) or avoid (`"low"`) assigning. Requires `appliesTo`.
 *
 * @example
 * ```typescript
 * preference("high", { appliesTo: "waiter" })
 * preference("low", { appliesTo: "student", dayOfWeek: weekdays })
 * ```
 *
 * @category Rules
 */
export function preference(level: "high" | "low", opts?: Omit<RuleOptions, "priority">): RuleEntry {
  return makeRule("assignment-priority", { preference: level, ...opts });
}

/**
 * Prefer assigning to shifts at a specific location. Requires `appliesTo`.
 *
 * @example
 * ```typescript
 * preferLocation("terrace", { appliesTo: "alice" })
 * ```
 *
 * @category Rules
 */
export function preferLocation(locationId: string, opts?: EntityOnlyRuleOptions): RuleEntry {
  return makeRule("location-preference", { locationId, ...opts });
}

/**
 * Guarantees that targeted members appear on the schedule each week.
 *
 * @remarks
 * Use for staffing obligations: salaried employees who are paid regardless
 * of whether they work, or contracted staff who must be rostered. The solver
 * ensures each targeted member has at least one assignment per scheduling week.
 *
 * Always a soft constraint (HIGH priority internally). The schedule still
 * generates when a member genuinely cannot be placed (e.g., full week of
 * absences). Violations surface as validation warnings with distinct
 * messaging from {@link minDaysPerWeek}. Priority is not configurable;
 * the rule name communicates the intent.
 *
 * @example
 * ```typescript
 * mustAssign({ appliesTo: "diana" })
 * mustAssign({ appliesTo: ["diana", "yavuz"] })
 * ```
 *
 * @category Rules
 */
export function mustAssign(opts?: { appliesTo?: string | string[] }): RuleEntry {
  return makeRule("must-assign", { ...opts });
}

// ============================================================================
// Special Rules (custom resolvers)
// ============================================================================

/**
 * Block assignments during specified periods.
 * Requires at least one time scope (`dayOfWeek`, `dateRange`, `dates`, or `from`/`until`).
 *
 * @example
 * ```typescript
 * // Full days off
 * timeOff({ appliesTo: "alice", dateRange: { start: "2024-02-01", end: "2024-02-05" } })
 *
 * // Every weekend off
 * timeOff({ appliesTo: "mauro", dayOfWeek: weekend })
 *
 * // Wednesday afternoons off
 * timeOff({ appliesTo: "student", dayOfWeek: ["wednesday"], from: t(14) })
 * ```
 *
 * @category Rules
 */
export function timeOff(opts: TimeOffOptions): RuleEntry {
  const { from, until, ...rest } = opts;
  return defineRule("time-off", { from, until, ...rest }, (ctx) => {
    if (!rest.dayOfWeek && !rest.dateRange && !rest.dates && !rest.recurringPeriods) {
      throw new Error(
        "timeOff() requires at least one time scope (dayOfWeek, dateRange, dates, or recurringPeriods).",
      );
    }

    const { appliesTo, dates, ...passthrough } = rest;
    const entityScope = resolveAppliesTo(appliesTo, ctx.roles, ctx.skills, ctx.memberIds);
    const resolvedDates = dates ? { specificDates: dates } : {};

    const partialDay: Record<string, unknown> = {};
    if (from && until) {
      partialDay.startTime = from;
      partialDay.endTime = until;
    } else if (from) {
      partialDay.startTime = from;
      partialDay.endTime = { hours: 23, minutes: 59 };
    } else if (until) {
      partialDay.startTime = { hours: 0, minutes: 0 };
      partialDay.endTime = until;
    }

    return {
      name: "time-off",
      ...passthrough,
      ...entityScope,
      ...resolvedDates,
      ...partialDay,
    } as CpsatRuleConfigEntry;
  });
}

/**
 * Members work the same shifts on days they are both assigned.
 *
 * @example
 * ```typescript
 * assignTogether(["alice", "bob"])
 * assignTogether(["alice", "bob", "charlie"], { priority: "HIGH" })
 * ```
 *
 * @category Rules
 */
export function assignTogether(
  memberIds: [string, string, ...string[]],
  opts?: AssignTogetherOptions,
): RuleEntry {
  return defineRule("assign-together", { members: memberIds, ...opts }, (ctx) => {
    for (const member of memberIds) {
      if (!ctx.memberIds.has(member)) {
        throw new Error(
          `assignTogether references unknown member "${member}". ` +
            `Known member IDs: ${[...ctx.memberIds].join(", ")}`,
        );
      }
    }
    return {
      name: "assign-together",
      groupMemberIds: memberIds,
      ...opts,
    } as CpsatRuleConfigEntry;
  });
}

// ============================================================================
// Internal: appliesTo resolution (shared with definition.ts)
// ============================================================================

/**
 * Resolves an `appliesTo` value into entity scope fields.
 *
 * Each target string is checked against roles, skills, then member IDs.
 * If all targets resolve to the same namespace, they are combined into one
 * scope field. If they span namespaces, an error is thrown; the caller
 * should use separate rule entries instead.
 *
 * @internal
 */
export function resolveAppliesTo(
  appliesTo: string | string[] | undefined,
  roles: ReadonlySet<string>,
  skills: ReadonlySet<string>,
  memberIds: ReadonlySet<string>,
): {
  memberIds?: [string, ...string[]];
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
    return { memberIds: resolvedMembers as [string, ...string[]] };
  }
  return {};
}
