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
 *
 * @category Time Periods
 */
export function t(hours: number, minutes = 0): TimeOfDay {
  return { hours, minutes };
}

/**
 * Monday through Friday.
 *
 * @category Time Periods
 */
export const weekdays: readonly DayOfWeek[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
] as const;

/**
 * Saturday and Sunday.
 *
 * @category Time Periods
 */
export const weekend: readonly DayOfWeek[] = ["saturday", "sunday"] as const;

// ============================================================================
// Semantic Times
// ============================================================================

/**
 * Define a named semantic time period.
 *
 * @remarks
 * Each entry has `startTime`/`endTime` and optional `dayOfWeek` or `dates`
 * scoping. Entries without scoping are the default.
 *
 * @example
 * ```typescript
 * times: {
 *   // Simple: same times every day
 *   lunch: time({ startTime: t(12), endTime: t(15) }),
 *
 *   // Variants: different times on weekends
 *   dinner: time(
 *     { startTime: t(17), endTime: t(21) },
 *     { startTime: t(18), endTime: t(22), dayOfWeek: weekend },
 *   ),
 *
 *   // Point-in-time window (keyholder at opening)
 *   opening: time({ startTime: t(8, 30), endTime: t(9) }),
 * }
 * ```
 *
 * @privateRemarks
 * Resolution precedence: `dates` > `dayOfWeek` > default.
 *
 * @category Time Periods
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
 *
 * @category Coverage
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
 * Entries for the same time and role **stack additively**.
 * For weekday vs weekend staffing, use mutually exclusive `dayOfWeek`
 * on both entries.
 *
 * @param timeName - Name of a declared semantic time
 * @param target - Role name (string), array of role names (OR logic), or skill name
 * @param count - Number of people needed
 * @param opts - Options: `skillIds` (AND filter), `dayOfWeek`, `dates`, `priority`
 *
 * @example
 * ```typescript
 * coverage: [
 *   // 2 waiters during lunch
 *   cover("lunch", "waiter", 2),
 *
 *   // 1 manager OR supervisor during dinner
 *   cover("dinner", ["manager", "supervisor"], 1),
 *
 *   // 1 person with keyholder skill at opening
 *   cover("opening", "keyholder", 1),
 *
 *   // 1 senior waiter (role + skill AND)
 *   cover("lunch", "waiter", 1, { skillIds: ["senior"] }),
 *
 *   // Different counts by day (mutually exclusive dayOfWeek!)
 *   cover("lunch", "waiter", 2, { dayOfWeek: weekdays }),
 *   cover("lunch", "waiter", 3, { dayOfWeek: weekend }),
 * ]
 * ```
 *
 * @category Coverage
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
 * Define a shift pattern: a time slot available for employee assignment.
 *
 * @remarks
 * Each pattern repeats daily unless filtered by `dayOfWeek`.
 *
 * @example
 * ```typescript
 * shiftPatterns: [
 *   shift("morning", t(11, 30), t(15)),
 *   shift("evening", t(17), t(22)),
 *
 *   // Role-restricted shift
 *   shift("kitchen", t(6), t(14), { roleIds: ["chef", "prep_cook"] }),
 *
 *   // Day-restricted shift
 *   shift("saturday_short", t(9), t(14), { dayOfWeek: ["saturday"] }),
 *
 *   // Location-specific shift
 *   shift("terrace_lunch", t(12), t(16), { locationId: "terrace" }),
 * ]
 * ```
 *
 * @category Shift Patterns
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
 * Options for {@link assignTogether}.
 *
 * @category Rules
 */
export interface AssignTogetherOptions {
  /** Defaults to `"MANDATORY"`. */
  priority?: Priority;
}

/**
 * Options for cost rules.
 *
 * Cost rules are objective terms, not constraints. The `priority` field from
 * {@link RuleOptions} does not apply.
 *
 * @category Cost Optimization
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
 * Cost modifiers adjust the calculation:
 * - `dayMultiplier(factor, opts?)` - multiply base rate on specific days
 * - `daySurcharge(amount, opts?)` - flat extra per hour on specific days
 * - `timeSurcharge(amount, window, opts?)` - flat extra per hour during a time window
 * - `overtimeMultiplier({ after, factor }, opts?)` - weekly overtime multiplier
 * - `overtimeSurcharge({ after, amount }, opts?)` - weekly overtime surcharge
 * - `dailyOvertimeMultiplier({ after, factor }, opts?)` - daily overtime multiplier
 * - `dailyOvertimeSurcharge({ after, amount }, opts?)` - daily overtime surcharge
 * - `tieredOvertimeMultiplier(tiers, opts?)` - multiple overtime thresholds
 *
 * @example
 * ```ts
 * minimizeCost()
 * ```
 *
 * @category Cost Optimization
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
 * @category Cost Optimization
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
 * @category Cost Optimization
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
 * @category Cost Optimization
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
 * @category Cost Optimization
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
 * @category Cost Optimization
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
 * @category Cost Optimization
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
 * @category Cost Optimization
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
 * @category Cost Optimization
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
  return makeRule("time-off", { ...opts });
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
 *
 * @category Schedule Definition
 */
export interface RuntimeArgs {
  /** The scheduling period (date range + optional filters). */
  schedulingPeriod: SchedulingPeriod;
  /** Team members available for this scheduling run. */
  members: SchedulingMember[];
  /** Ad-hoc rules injected at runtime (e.g., vacation, holiday closures). */
  runtimeRules?: RuleEntry[];
}

/**
 * Result of {@link defineSchedule}.
 *
 * @category Schedule Definition
 */
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
 *
 * @category Schedule Definition
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
 * Define a complete schedule configuration.
 *
 * @param config - Schedule configuration object with:
 *   - `roleIds` (required): declared role names
 *   - `skillIds` (optional): declared skill names
 *   - `times` (required): named semantic time periods (see {@link time})
 *   - `coverage` (required): staffing requirements (see {@link cover})
 *   - `shiftPatterns` (required): available shifts (see {@link shift})
 *   - `rules` (optional): constraints and preferences (see rule functions)
 *   - `dayOfWeek` (optional): days the business operates (inclusion filter)
 *   - `weekStartsOn` (optional): defaults to `"monday"`
 *
 * @example
 * ```typescript
 * import {
 *   defineSchedule, t, time, cover, shift,
 *   maxHoursPerWeek, minRestBetweenShifts, timeOff,
 *   weekdays, weekend,
 * } from "dabke";
 *
 * export default defineSchedule({
 *   roleIds: ["waiter", "runner", "manager"],
 *   skillIds: ["senior"],
 *
 *   times: {
 *     lunch: time({ startTime: t(12), endTime: t(15) }),
 *     dinner: time(
 *       { startTime: t(17), endTime: t(21) },
 *       { startTime: t(18), endTime: t(22), dayOfWeek: weekend },
 *     ),
 *   },
 *
 *   coverage: [
 *     cover("lunch", "waiter", 2),
 *     cover("dinner", "waiter", 4, { dayOfWeek: weekdays }),
 *     cover("dinner", "waiter", 6, { dayOfWeek: weekend }),
 *   ],
 *
 *   shiftPatterns: [
 *     shift("morning", t(11, 30), t(15)),
 *     shift("evening", t(17), t(22)),
 *   ],
 *
 *   rules: [
 *     maxHoursPerWeek(48),
 *     minRestBetweenShifts(10),
 *     timeOff({ appliesTo: "alice", dayOfWeek: weekend }),
 *   ],
 * });
 * ```
 *
 * @category Schedule Definition
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
