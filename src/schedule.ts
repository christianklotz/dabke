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
 *   roleIds: ["cashier", "floor_lead", "stocker"],
 *   skillIds: ["keyholder"],
 *
 *   times: {
 *     opening: time({ startTime: t(8), endTime: t(10) }),
 *     peak_hours: time(
 *       { startTime: t(11), endTime: t(14) },
 *       { startTime: t(10), endTime: t(15), dayOfWeek: weekend },
 *     ),
 *     closing: time({ startTime: t(20), endTime: t(22) }),
 *   },
 *
 *   coverage: [
 *     cover("opening", "keyholder", 1),
 *     cover("peak_hours", "cashier", 3, { dayOfWeek: weekdays }),
 *     cover("peak_hours", "cashier", 5, { dayOfWeek: weekend }),
 *     cover("closing", "floor_lead", 1),
 *   ],
 *
 *   shiftPatterns: [
 *     shift("morning", t(8), t(14)),
 *     shift("afternoon", t(14), t(22)),
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
  CoverageVariant,
} from "./cpsat/semantic-time.js";

export type { CoverageVariant } from "./cpsat/semantic-time.js";
import { defineSemanticTimes } from "./cpsat/semantic-time.js";
import { resolveDaysFromPeriod } from "./datetime.utils.js";
import type { ModelBuilderConfig } from "./cpsat/model-builder.js";
import type { SchedulingMember, ShiftPattern, Priority } from "./cpsat/types.js";
import type { CpsatRuleName, CpsatRuleConfigEntry } from "./cpsat/rules/rules.types.js";
import type { RecurringPeriod } from "./cpsat/rules/scope.types.js";
import type { OvertimeTier } from "./cpsat/rules/overtime-tiered-multiplier.js";

// ============================================================================
// Primitives
// ============================================================================

/**
 * Creates a {@link TimeOfDay} value.
 *
 * @param hours - Hour component (0-23)
 * @param minutes - Minute component (0-59)
 *
 * @example Hours only
 * ```ts
 * t(9)   // { hours: 9, minutes: 0 }
 * ```
 *
 * @example Hours and minutes
 * ```ts
 * t(17, 30)  // { hours: 17, minutes: 30 }
 * ```
 */
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

/**
 * Defines a named time window.
 *
 * @remarks
 * A semantic time is any recurring period you need to reference:
 * service hours, delivery windows, peak periods, weekly events. Times
 * may overlap (e.g., "dinner" 18:00-22:00 and "happy_hour"
 * 17:30-18:30, or "lunch" 12:00-14:00 with "peak_lunch"
 * 13:00-13:30). Coverage and rules reference these names; each
 * generates independent constraints.
 *
 * Every argument is a {@link SemanticTimeVariant} with `startTime`/`endTime`
 * and optional `dayOfWeek`/`dates` scoping. An entry without scoping is the
 * default (applies when no scoped entry matches). At most one default is
 * allowed. If no default, the time only exists on the scoped days.
 *
 * Resolution precedence: `dates` > `dayOfWeek` > default.
 *
 * @example Every day
 * ```typescript
 * day_shift: time({ startTime: t(7), endTime: t(15) }),
 * ```
 *
 * @example Default with weekend variant
 * ```typescript
 * peak_hours: time(
 *   { startTime: t(9), endTime: t(17) },
 *   { startTime: t(10), endTime: t(15), dayOfWeek: weekend },
 * ),
 * ```
 *
 * @example No default (specific days only)
 * ```typescript
 * happy_hour: time(
 *   { startTime: t(16), endTime: t(18), dayOfWeek: ["monday", "tuesday"] },
 *   { startTime: t(17), endTime: t(19), dayOfWeek: ["friday"] },
 * ),
 * ```
 */
export function time(
  ...entries: [SemanticTimeVariant, ...SemanticTimeVariant[]]
): SemanticTimeEntry {
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
      startTime: entries[0].startTime,
      endTime: entries[0].endTime,
    } satisfies SemanticTimeDef;
  }

  // Multiple entries or scoped entries: shallow-copy to decouple from caller
  return entries.map((entry) => Object.assign({}, entry));
}

// ============================================================================
// Coverage
// ============================================================================

/**
 * Options for a {@link cover} call.
 *
 * @remarks
 * Day/date scoping controls which days this coverage entry applies to.
 * An entry without `dayOfWeek` or `dates` applies every day in the
 * scheduling period.
 */
export interface CoverageOptions {
  /** Additional skill ID filter (AND logic with the target role). */
  skillIds?: [string, ...string[]];
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
 * compile-time validation by {@link defineSchedule}. This is an opaque
 * token; pass it directly into the `coverage` array.
 */
export interface CoverageEntry<T extends string = string, R extends string = string> {
  /** @internal */ readonly _type: "coverage";
  /** @internal */ readonly timeName: T;
  /** @internal */ readonly target: R | R[];
  /** @internal */ readonly count: number;
  /** @internal */ readonly options: CoverageOptions;
  /** @internal  When present, this entry uses variant-based resolution. */
  readonly variants?: readonly CoverageVariant[];
}

/**
 * Defines a staffing requirement for a semantic time period.
 *
 * @remarks
 * Two call forms are supported:
 *
 * **Simple form** `cover(time, target, count, opts?)` creates a single
 * constraint. Use `dayOfWeek`/`dates` in `opts` to restrict which days
 * it applies to.
 *
 * **Variant form** `cover(time, target, ...variants)` accepts one or more
 * {@link CoverageVariant} entries with day-specific counts. For each
 * scheduling day, exactly one variant is selected using the same
 * precedence as {@link time}: `dates` > `dayOfWeek` > default (unscoped).
 * At most one variant may be unscoped (the default). Days with no matching
 * variant produce no coverage. See {@link CoverageVariant} for the entry
 * shape.
 *
 * **Target resolution.** The `target` parameter is resolved against declared
 * `roleIds` and `skillIds`:
 *
 * - Single string: matched against roles first, then skills.
 * - Array of strings: OR logic (any of the listed roles).
 * - With `skillIds` option (simple form only): role AND skill(s) filter.
 *
 * @param timeName - Name of a declared semantic time
 * @param target - Role name, skill name, or array of role names (OR)
 * @param count - Number of people needed (simple form)
 * @param opts - See {@link CoverageOptions} (simple form)
 *
 * @example Basic role coverage
 * ```ts
 * cover("day_shift", "nurse", 3)
 * ```
 *
 * @example OR logic (any of the listed roles)
 * ```ts
 * cover("day_shift", ["manager", "team_lead"], 1)
 * ```
 *
 * @example Skill-based coverage
 * ```ts
 * cover("night_shift", "keyholder", 1)
 * ```
 *
 * @example Role with skill filter (role AND skill)
 * ```ts
 * cover("day_shift", "nurse", 1, { skillIds: ["charge_nurse"] })
 * ```
 *
 * @example Day-of-week scoping (simple form)
 * ```ts
 * cover("peak_hours", "cashier", 3, { dayOfWeek: weekdays }),
 * cover("peak_hours", "cashier", 5, { dayOfWeek: weekend }),
 * ```
 *
 * @example Default with date override (variant form)
 * ```ts
 * cover("peak_hours", "agent",
 *   { count: 4 },
 *   { count: 2, dates: ["2025-12-24"] },
 * )
 * ```
 *
 * @example Weekday vs weekend with holiday override (variant form)
 * ```ts
 * cover("peak_hours", "agent",
 *   { count: 3, dayOfWeek: weekdays },
 *   { count: 5, dayOfWeek: weekend },
 *   { count: 8, dates: ["2025-12-31"] },
 * )
 * ```
 */
export function cover<T extends string, R extends string>(
  timeName: T,
  target: R | [R, ...R[]],
  count: number,
  opts?: CoverageOptions,
): CoverageEntry<T, R>;
export function cover<T extends string, R extends string>(
  timeName: T,
  target: R | [R, ...R[]],
  ...variants: [CoverageVariant, ...CoverageVariant[]]
): CoverageEntry<T, R>;
export function cover<T extends string, R extends string>(
  timeName: T,
  target: R | [R, ...R[]],
  countOrFirstVariant: number | CoverageVariant,
  ...rest: unknown[]
): CoverageEntry<T, R> {
  if (typeof countOrFirstVariant === "number") {
    // Simple form: cover(time, target, count, opts?)
    return {
      _type: "coverage",
      timeName,
      target,
      count: countOrFirstVariant,
      options: (rest[0] as CoverageOptions | undefined) ?? {},
    };
  }

  // Variant form: cover(time, target, ...variants)
  const variants = [countOrFirstVariant, ...(rest as CoverageVariant[])];

  const defaults = variants.filter((v) => !v.dayOfWeek && !v.dates);
  if (defaults.length > 1) {
    throw new Error(
      "cover() accepts at most one default variant (without dayOfWeek or dates). " +
        `Found ${defaults.length} default variants.`,
    );
  }

  return {
    _type: "coverage",
    timeName,
    target,
    count: 0,
    options: {},
    variants,
  };
}

// ============================================================================
// Shift Patterns
// ============================================================================

/**
 * Creates a {@link ShiftPattern} (time slot template).
 *
 * @remarks
 * Shift patterns define when people can work: the concrete time slots
 * the solver may assign members to. Each pattern repeats across all
 * scheduling days unless filtered by `dayOfWeek` or `roleIds`.
 *
 * @example
 * ```typescript
 * shift("early", t(6), t(14)),
 * shift("day", t(9), t(17)),
 * shift("night", t(22), t(6), { roleIds: ["nurse", "doctor"] }),
 * ```
 */
export function shift(
  id: string,
  startTime: TimeOfDay,
  endTime: TimeOfDay,
  opts?: Pick<ShiftPattern, "roleIds" | "dayOfWeek" | "locationId">,
): ShiftPattern {
  const pattern: ShiftPattern = { id, startTime, endTime };
  if (opts?.roleIds) pattern.roleIds = opts.roleIds;
  if (opts?.dayOfWeek) pattern.dayOfWeek = opts.dayOfWeek as DayOfWeek[];
  if (opts?.locationId) pattern.locationId = opts.locationId;
  return pattern;
}

// ============================================================================
// Rules
// ============================================================================

/**
 * Scoping options shared by most rule functions.
 *
 * @remarks
 * Each rule function returns an opaque {@link RuleEntry} for the `rules`
 * array. Most accept a `RuleOptions` parameter for scoping and priority.
 *
 * **Entity scoping.** `appliesTo` targets a role name, skill name, or
 * member ID. It is resolved against declared roles first, then skills,
 * then runtime member IDs. The namespaces are guaranteed disjoint by
 * validation. Unscoped rules apply to all members.
 *
 * **Time scoping.** `dayOfWeek`, `dateRange`, `dates`, and
 * `recurringPeriods` narrow when the rule is active. Unscoped rules
 * apply to every day in the scheduling period.
 *
 * **Priority.** Defaults to `MANDATORY` (hard constraint the solver
 * must satisfy). Use `LOW`, `MEDIUM`, or `HIGH` for soft preferences
 * the solver may violate when necessary.
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

/**
 * Options for rules that support entity scoping only (no time scoping).
 *
 * @remarks
 * Used by rules whose semantics are inherently per-day or per-week
 * (e.g., {@link minHoursPerDay}, {@link maxConsecutiveDays}) and cannot
 * be meaningfully restricted to a date range or day of week.
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
 */
export interface TimeOffOptions {
  /** Who this rule applies to (role name, skill name, or member ID). */
  appliesTo?: string | string[];
  /** Off from this time until end of day. */
  from?: TimeOfDay;
  /** Off from start of day until this time. */
  until?: TimeOfDay;
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

/** Options for {@link assignTogether}. */
export interface AssignTogetherOptions {
  /** Defaults to `"MANDATORY"`. */
  priority?: Priority;
}

/**
 * Options for cost rules.
 *
 * Cost rules are objective terms, not constraints. The `priority` field from
 * {@link RuleOptions} does not apply.
 */
export interface CostRuleOptions {
  /** Who this rule applies to (role name, skill name, or member ID). */
  appliesTo?: string | string[];
  /** Restrict to specific days of the week. */
  dayOfWeek?: DayOfWeek[];
  /** Restrict to a date range. */
  dateRange?: { start: string; end: string };
  /** Restrict to specific dates (YYYY-MM-DD). */
  dates?: string[];
  /** Restrict to recurring calendar periods. */
  recurringPeriods?: [RecurringPeriod, ...RecurringPeriod[]];
}

// Internal rule entry type
interface RuleEntryBase {
  readonly _type: "rule";
  readonly _rule: CpsatRuleName;
}

/**
 * An opaque rule entry returned by rule functions.
 *
 * @remarks
 * Pass these directly into the `rules` array of {@link ScheduleConfig} or
 * the `runtimeRules` array of {@link RuntimeArgs}. The internal fields are
 * resolved during {@link ScheduleDefinition.createSchedulerConfig}.
 */
export type RuleEntry = RuleEntryBase & Record<string, unknown>;

function makeRule(rule: CpsatRuleName, fields: Record<string, unknown>): RuleEntry {
  return { _type: "rule", _rule: rule, ...fields };
}

/**
 * Limits how many hours a person can work in a single day.
 *
 * @example Global limit
 * ```ts
 * maxHoursPerDay(10)
 * ```
 *
 * @example Scoped to a role
 * ```ts
 * maxHoursPerDay(6, { appliesTo: "student" })
 * ```
 */
export function maxHoursPerDay(hours: number, opts?: RuleOptions): RuleEntry {
  return makeRule("max-hours-day", { hours, ...opts });
}

/**
 * Caps total hours a person can work within each scheduling week.
 *
 * @example Global cap
 * ```ts
 * maxHoursPerWeek(48)
 * ```
 *
 * @example Part-time cap for a skill group
 * ```ts
 * maxHoursPerWeek(20, { appliesTo: "part_time" })
 * ```
 */
export function maxHoursPerWeek(hours: number, opts?: RuleOptions): RuleEntry {
  return makeRule("max-hours-week", { hours, ...opts });
}

/**
 * Ensures a person works at least a minimum number of hours per day when assigned.
 *
 * @example
 * ```ts
 * minHoursPerDay(4)
 * ```
 */
export function minHoursPerDay(hours: number, opts?: EntityOnlyRuleOptions): RuleEntry {
  return makeRule("min-hours-day", { hours, ...opts });
}

/**
 * Enforces a minimum total number of hours per scheduling week.
 *
 * @example Guaranteed minimum for full-time members
 * ```ts
 * minHoursPerWeek(30, { appliesTo: "full_time" })
 * ```
 */
export function minHoursPerWeek(hours: number, opts?: EntityOnlyRuleOptions): RuleEntry {
  return makeRule("min-hours-week", { hours, ...opts });
}

/**
 * Limits how many shifts a person can work in a single day.
 *
 * @example One shift per day
 * ```ts
 * maxShiftsPerDay(1)
 * ```
 */
export function maxShiftsPerDay(shifts: number, opts?: RuleOptions): RuleEntry {
  return makeRule("max-shifts-day", { shifts, ...opts });
}

/**
 * Limits how many consecutive days a person can be assigned.
 *
 * @example Five-day work week limit
 * ```ts
 * maxConsecutiveDays(5)
 * ```
 */
export function maxConsecutiveDays(days: number, opts?: EntityOnlyRuleOptions): RuleEntry {
  return makeRule("max-consecutive-days", { days, ...opts });
}

/**
 * Requires a minimum stretch of consecutive working days once assigned.
 *
 * @example
 * ```ts
 * minConsecutiveDays(2)
 * ```
 */
export function minConsecutiveDays(days: number, opts?: EntityOnlyRuleOptions): RuleEntry {
  return makeRule("min-consecutive-days", { days, ...opts });
}

/**
 * Enforces a minimum rest period between any two shifts a person works.
 *
 * @example EU Working Time Directive (11 hours)
 * ```ts
 * minRestBetweenShifts(11)
 * ```
 */
export function minRestBetweenShifts(hours: number, opts?: EntityOnlyRuleOptions): RuleEntry {
  return makeRule("min-rest-between-shifts", { hours, ...opts });
}

/**
 * Adds objective weight to prefer or avoid assigning team members.
 *
 * @param level - `"high"` to prefer assigning, `"low"` to avoid
 * @param opts - Entity and time scoping (no priority; preference is the priority mechanism)
 *
 * @example Prefer assigning full-time staff
 * ```ts
 * preference("high", { appliesTo: "full_time" })
 * ```
 *
 * @example Avoid assigning a specific member on weekends
 * ```ts
 * preference("low", { appliesTo: "alice", dayOfWeek: weekend })
 * ```
 */
export function preference(level: "high" | "low", opts?: Omit<RuleOptions, "priority">): RuleEntry {
  return makeRule("assignment-priority", { preference: level, ...opts });
}

/**
 * Prefers assigning a person to shift patterns at a specific location.
 *
 * @example
 * ```ts
 * preferLocation("north_wing", { appliesTo: "alice" })
 * ```
 */
export function preferLocation(locationId: string, opts?: EntityOnlyRuleOptions): RuleEntry {
  return makeRule("location-preference", { locationId, ...opts });
}

/**
 * Tells the solver to minimize total labor cost.
 *
 * @remarks
 * Without this rule, cost modifiers only affect post-solve calculation.
 * When present, the solver actively prefers cheaper assignments.
 *
 * For hourly members, penalizes each assignment proportionally to cost.
 * For salaried members, adds a fixed weekly salary cost when they have
 * any assignment that week (zero marginal cost up to contracted hours).
 *
 * @example
 * ```ts
 * minimizeCost()
 * ```
 */
export function minimizeCost(opts?: CostRuleOptions): RuleEntry {
  return makeRule("minimize-cost", { ...opts });
}

/**
 * Multiplies the base rate for assignments on specified days.
 *
 * @remarks
 * The base cost (1x) is already counted by {@link minimizeCost};
 * this rule adds only the extra portion above 1x.
 *
 * @example Weekend multiplier
 * ```typescript
 * dayMultiplier(1.5, { dayOfWeek: weekend })
 * ```
 */
export function dayMultiplier(factor: number, opts?: CostRuleOptions): RuleEntry {
  return makeRule("day-cost-multiplier", { factor, ...opts });
}

/**
 * Adds a flat extra amount per hour for assignments on specified days.
 *
 * @remarks
 * The surcharge is independent of the member's base rate.
 *
 * @example Weekend surcharge
 * ```typescript
 * daySurcharge(500, { dayOfWeek: weekend })
 * ```
 */
export function daySurcharge(amountPerHour: number, opts?: CostRuleOptions): RuleEntry {
  return makeRule("day-cost-surcharge", { amountPerHour, ...opts });
}

/**
 * Adds a flat surcharge per hour for the portion of a shift that overlaps a time-of-day window.
 *
 * @remarks
 * The window supports overnight spans (e.g., 22:00-06:00). The surcharge
 * is independent of the member's base rate.
 *
 * @param amountPerHour - Flat surcharge per hour in smallest currency unit
 * @param window - Time-of-day window
 * @param opts - Entity and time scoping
 *
 * @example Night differential
 * ```typescript
 * timeSurcharge(200, { from: t(22), until: t(6) })
 * ```
 */
export function timeSurcharge(
  amountPerHour: number,
  window: { from: TimeOfDay; until: TimeOfDay },
  opts?: CostRuleOptions,
): RuleEntry {
  return makeRule("time-cost-surcharge", { amountPerHour, window, ...opts });
}

/**
 * Applies a multiplier to hours beyond a weekly threshold.
 *
 * @remarks
 * Only the extra portion above 1x is added (the base cost is already
 * counted by {@link minimizeCost}).
 *
 * @example
 * ```typescript
 * overtimeMultiplier({ after: 40, factor: 1.5 })
 * ```
 */
export function overtimeMultiplier(
  opts: { after: number; factor: number } & CostRuleOptions,
): RuleEntry {
  return makeRule("overtime-weekly-multiplier", { ...opts });
}

/**
 * Adds a flat surcharge per hour beyond a weekly threshold.
 *
 * @remarks
 * The surcharge is independent of the member's base rate.
 *
 * @example
 * ```typescript
 * overtimeSurcharge({ after: 40, amount: 1000 })
 * ```
 */
export function overtimeSurcharge(
  opts: { after: number; amount: number } & CostRuleOptions,
): RuleEntry {
  return makeRule("overtime-weekly-surcharge", { ...opts });
}

/**
 * Applies a multiplier to hours beyond a daily threshold.
 *
 * @remarks
 * Only the extra portion above 1x is added (the base cost is already
 * counted by {@link minimizeCost}).
 *
 * @example
 * ```typescript
 * dailyOvertimeMultiplier({ after: 8, factor: 1.5 })
 * ```
 */
export function dailyOvertimeMultiplier(
  opts: { after: number; factor: number } & CostRuleOptions,
): RuleEntry {
  return makeRule("overtime-daily-multiplier", { ...opts });
}

/**
 * Adds a flat surcharge per hour beyond a daily threshold.
 *
 * @remarks
 * The surcharge is independent of the member's base rate.
 *
 * @example
 * ```typescript
 * dailyOvertimeSurcharge({ after: 8, amount: 500 })
 * ```
 */
export function dailyOvertimeSurcharge(
  opts: { after: number; amount: number } & CostRuleOptions,
): RuleEntry {
  return makeRule("overtime-daily-surcharge", { ...opts });
}

/**
 * Applies multiple overtime thresholds with increasing multipliers.
 *
 * @remarks
 * Each tier applies only to the hours between its threshold and the next.
 * Tiers must be sorted by threshold ascending.
 *
 * @example
 * ```typescript
 * // Hours 0-40: base rate
 * // Hours 40-48: 1.5x
 * // Hours 48+: 2.0x
 * tieredOvertimeMultiplier([
 *   { after: 40, factor: 1.5 },
 *   { after: 48, factor: 2.0 },
 * ])
 * ```
 */
export function tieredOvertimeMultiplier(
  tiers: [OvertimeTier, ...OvertimeTier[]],
  opts?: CostRuleOptions,
): RuleEntry {
  return makeRule("overtime-tiered-multiplier", { tiers, ...opts });
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

/**
 * Runtime arguments passed to {@link ScheduleDefinition.createSchedulerConfig}.
 *
 * @remarks
 * Separates data known at runtime (team roster, date range, ad-hoc rules)
 * from the static schedule definition. Runtime rules are merged after the
 * definition's own rules and undergo the same `appliesTo` resolution.
 */
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
  /** Declared role IDs. */
  readonly roleIds: readonly string[];
  /** Declared skill IDs. */
  readonly skillIds: readonly string[];
  /** Names of declared semantic times. */
  readonly timeNames: readonly string[];
  /** Shift pattern IDs. */
  readonly shiftPatternIds: readonly string[];
  /** Internal rule identifiers in kebab-case (e.g., "max-hours-day", "time-off"). */
  readonly ruleNames: readonly string[];
}

/**
 * Configuration for {@link defineSchedule}.
 *
 * @remarks
 * Coverage entries for the same semantic time and target stack additively.
 * An unscoped entry applies every day; adding a weekend-only entry on top
 * doubles the count on those days. Use mutually exclusive `dayOfWeek` on
 * both entries to avoid stacking. See {@link cover} for details.
 */
export interface ScheduleConfig<
  R extends readonly string[],
  S extends readonly string[],
  T extends Record<string, SemanticTimeEntry>,
> {
  /** Declared role IDs. */
  roleIds: R;
  /** Declared skill IDs. */
  skillIds?: S;
  /** Named semantic time periods. */
  times: T;
  /** Staffing requirements per time period (entries stack additively). */
  coverage: CoverageEntry<keyof T & string, R[number] | NonNullable<S>[number]>[];
  /** Available shift patterns. */
  shiftPatterns: ShiftPattern[];
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
 *   roleIds: ["agent", "supervisor"],
 *   times: { peak: time({ startTime: t(9), endTime: t(17) }) },
 *   coverage: [cover("peak", "agent", 4)],
 *   shiftPatterns: [shift("day", t(9), t(17))],
 *   rules: [maxHoursPerDay(8)],
 * });
 * ```
 */
export function defineSchedule<
  const R extends readonly string[],
  const S extends readonly string[],
  const T extends Record<string, SemanticTimeEntry>,
>(config: ScheduleConfig<R, S, T>): ScheduleDefinition {
  const roles = new Set<string>(config.roleIds);
  const skills = new Set<string>(config.skillIds ?? []);

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
    if (sp.roleIds) {
      for (const role of sp.roleIds) {
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
    // Validate skillIds option
    if (entry.options.skillIds) {
      for (const s of entry.options.skillIds) {
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

  const shiftPatterns = config.shiftPatterns;

  return {
    roleIds: config.roleIds as readonly string[],
    skillIds: (config.skillIds ?? []) as readonly string[],
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

      // Validate member roleIds/skillIds reference declared roles/skills
      for (const member of args.members) {
        for (const role of member.roleIds) {
          if (!roles.has(role)) {
            throw new Error(
              `Member "${member.id}" references unknown role "${role}". ` +
                `Declared roles: ${[...roles].join(", ")}`,
            );
          }
        }
        if (member.skillIds) {
          for (const skill of member.skillIds) {
            if (!skills.has(skill)) {
              throw new Error(
                `Member "${member.id}" references unknown skill "${skill}". ` +
                  `Declared skills: ${[...skills].join(", ")}`,
              );
            }
          }
        }
      }

      // Resolve rules
      const specRules = config.rules ?? [];
      const runtimeRules = args.runtimeRules ?? [];
      const allRules = [...specRules, ...runtimeRules];

      // Validate pay data when cost rules are present
      const costRuleNames = new Set([
        "minimize-cost",
        "day-cost-multiplier",
        "day-cost-surcharge",
        "time-cost-surcharge",
        "overtime-weekly-multiplier",
        "overtime-weekly-surcharge",
        "overtime-daily-multiplier",
        "overtime-daily-surcharge",
        "overtime-tiered-multiplier",
      ]);
      const hasCostRules = allRules.some((r) => costRuleNames.has(r._rule));
      if (hasCostRules) {
        const missingPay = args.members.filter((m) => !m.pay).map((m) => m.id);
        if (missingPay.length > 0) {
          throw new Error(
            `Cost rules require pay data on all members. Missing pay: ${missingPay.join(", ")}`,
          );
        }
      }

      // Sort rules so minimize-cost compiles before modifier rules
      const sortedRules = sortCostRulesFirst(allRules);
      const ruleConfigs = resolveRules(sortedRules, roles, skills, memberIds);

      // Resolve scheduling period with dayOfWeek filter
      const resolvedPeriod = applyDaysFilter(args.schedulingPeriod, config.dayOfWeek);
      const days = resolveDaysFromPeriod(resolvedPeriod);

      // Resolve coverage
      const resolvedCoverage = semanticTimes.resolve(coverageReqs, days);

      return {
        members: args.members,
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
    // Variant form: produce a VariantCoverageRequirement
    if (entry.variants) {
      return buildVariantCoverageRequirement(entry, roles, skills);
    }

    // Simple form: produce a SemanticCoverageRequirement
    const base: {
      semanticTime: T;
      targetCount: number;
      priority?: Priority;
      dayOfWeek?: [DayOfWeek, ...DayOfWeek[]];
      dates?: string[];
    } = {
      semanticTime: entry.timeName,
      targetCount: entry.count,
    };

    if (entry.options.priority) base.priority = entry.options.priority;
    if (entry.options.dayOfWeek && entry.options.dayOfWeek.length > 0) {
      base.dayOfWeek = entry.options.dayOfWeek as [DayOfWeek, ...DayOfWeek[]];
    }
    if (entry.options.dates) base.dates = entry.options.dates;

    return buildSimpleCoverageTarget(entry, base, roles, skills);
  }) as MixedCoverageRequirement<T>[];
}

/**
 * Resolve the target (role/skill) for a simple coverage entry.
 */
function buildSimpleCoverageTarget<T extends string>(
  entry: CoverageEntry<T, string>,
  base: {
    semanticTime: T;
    targetCount: number;
    priority?: Priority;
    dayOfWeek?: [DayOfWeek, ...DayOfWeek[]];
    dates?: string[];
  },
  roles: Set<string>,
  skills: Set<string>,
): MixedCoverageRequirement<T> {
  if (Array.isArray(entry.target)) {
    return {
      ...base,
      roleIds: entry.target as [string, ...string[]],
    } satisfies MixedCoverageRequirement<T>;
  }

  const singleTarget = entry.target as string;
  if (roles.has(singleTarget)) {
    if (entry.options.skillIds) {
      return {
        ...base,
        roleIds: [singleTarget] as [string, ...string[]],
        skillIds: entry.options.skillIds,
      } satisfies MixedCoverageRequirement<T>;
    }
    return {
      ...base,
      roleIds: [singleTarget] as [string, ...string[]],
    } satisfies MixedCoverageRequirement<T>;
  }

  if (skills.has(singleTarget)) {
    return {
      ...base,
      skillIds: [singleTarget] as [string, ...string[]],
    } satisfies MixedCoverageRequirement<T>;
  }

  throw new Error(`Coverage target "${singleTarget}" is not a declared role or skill.`);
}

/**
 * Build a VariantCoverageRequirement from a variant-form CoverageEntry.
 */
function buildVariantCoverageRequirement<T extends string>(
  entry: CoverageEntry<T, string>,
  roles: Set<string>,
  skills: Set<string>,
): MixedCoverageRequirement<T> {
  const variants = entry.variants! as unknown as [CoverageVariant, ...CoverageVariant[]];

  const resolveTarget = (): {
    roleIds?: [string, ...string[]];
    skillIds?: [string, ...string[]];
  } => {
    if (Array.isArray(entry.target)) {
      return { roleIds: entry.target as [string, ...string[]] };
    }
    const singleTarget = entry.target as string;
    if (roles.has(singleTarget)) {
      return { roleIds: [singleTarget] as [string, ...string[]] };
    }
    if (skills.has(singleTarget)) {
      return { skillIds: [singleTarget] as [string, ...string[]] };
    }
    throw new Error(`Coverage target "${singleTarget}" is not a declared role or skill.`);
  };

  return {
    semanticTime: entry.timeName,
    variants,
    ...resolveTarget(),
  } as MixedCoverageRequirement<T>;
}

// ============================================================================
// Internal: Rule Translation
// ============================================================================

/**
 * Resolves an `appliesTo` value into entity scope fields.
 *
 * @remarks
 * Each target string is checked against roles, skills, then member IDs.
 * If all targets resolve to the same namespace, they are combined into one
 * scope field. If they span namespaces, an error is thrown; the caller
 * should use separate rule entries instead.
 */
function resolveAppliesTo(
  appliesTo: string | string[] | undefined,
  roles: Set<string>,
  skills: Set<string>,
  memberIds: Set<string>,
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
    // Mixed namespaces not supported in a single rule config.
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

function resolveRules(
  rules: RuleEntry[],
  roles: Set<string>,
  skills: Set<string>,
  memberIds: Set<string>,
): CpsatRuleConfigEntry[] {
  return rules.map((rule) => {
    const { _type, _rule, appliesTo, dates, ...passthrough } = rule as RuleEntry & {
      appliesTo?: string | string[];
      dates?: string[];
    };

    const entityScope =
      _rule === "assign-together" ? {} : resolveAppliesTo(appliesTo, roles, skills, memberIds);

    // Rename dates → specificDates (internal field name)
    const resolvedDates = dates ? { specificDates: dates } : {};

    switch (_rule) {
      case "time-off": {
        const { from, until, ...timeOffRest } = passthrough as Record<string, unknown> & {
          from?: TimeOfDay;
          until?: TimeOfDay;
        };

        if (
          !timeOffRest.dayOfWeek &&
          !timeOffRest.dateRange &&
          !dates &&
          !timeOffRest.recurringPeriods
        ) {
          throw new Error(
            "timeOff() requires at least one time scope (dayOfWeek, dateRange, dates, or recurringPeriods).",
          );
        }

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
          name: _rule,
          ...timeOffRest,
          ...entityScope,
          ...resolvedDates,
          ...partialDay,
        } as CpsatRuleConfigEntry;
      }

      case "assign-together": {
        const { members, ...atRest } = passthrough as Record<string, unknown> & {
          members: [string, string, ...string[]];
        };
        for (const member of members) {
          if (!memberIds.has(member)) {
            throw new Error(
              `assignTogether references unknown member "${member}". ` +
                `Known member IDs: ${[...memberIds].join(", ")}`,
            );
          }
        }
        return { name: _rule, groupMemberIds: members, ...atRest } as CpsatRuleConfigEntry;
      }

      default:
        return {
          name: _rule,
          ...passthrough,
          ...entityScope,
          ...resolvedDates,
        } as CpsatRuleConfigEntry;
    }
  }) as CpsatRuleConfigEntry[];
}

// ============================================================================
// Internal: Cost Rule Ordering
// ============================================================================

/**
 * Sorts rules so that `minimize-cost` compiles before cost modifier rules.
 *
 * @remarks
 * The `minimize-cost` rule must be compiled first because modifier rules
 * (multipliers, surcharges) reference cost variables it creates.
 * Non-cost rules retain their original relative order.
 */
function sortCostRulesFirst(rules: RuleEntry[]): RuleEntry[] {
  return rules.toSorted((a, b) => {
    const aIsCostBase = a._rule === "minimize-cost" ? 0 : 1;
    const bIsCostBase = b._rule === "minimize-cost" ? 0 : 1;
    return aIsCostBase - bIsCostBase;
  });
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
