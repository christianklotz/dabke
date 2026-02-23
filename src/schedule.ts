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
 *   schedule, t, time, cover, shift,
 *   maxHoursPerDay, maxHoursPerWeek, minRestBetweenShifts,
 *   weekdays, weekend,
 * } from "dabke";
 *
 * const venue = schedule({
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
 *
 * const result = await venue
 *   .with([
 *     { id: "alice", roleIds: ["cashier"], skillIds: ["keyholder"] },
 *   ])
 *   .solve(client, { dateRange: { start: "2025-03-03", end: "2025-03-09" } });
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
import type { ModelBuilderConfig, CompilationResult } from "./cpsat/model-builder.js";
import { ModelBuilder } from "./cpsat/model-builder.js";
import type { SchedulingMember, ShiftPattern, Priority } from "./cpsat/types.js";
import type {
  CpsatRuleName,
  CpsatRuleConfigEntry,
  CreateCpsatRuleFunction,
} from "./cpsat/rules/rules.types.js";
import { builtInCpsatRuleFactories } from "./cpsat/rules/registry.js";
import type { RecurringPeriod } from "./cpsat/rules/scope.types.js";
import type { OvertimeTier } from "./cpsat/rules/overtime-tiered-multiplier.js";
import type { SolverClient, SolverResponse } from "./client.types.js";
import { parseSolverResponse, resolveAssignments } from "./cpsat/response.js";
import type { ShiftAssignment } from "./cpsat/response.js";
import type { ScheduleValidation } from "./cpsat/validation.types.js";
import { calculateScheduleCost } from "./cpsat/cost.js";
import type { CostBreakdown } from "./cpsat/cost.js";

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
export const weekdays = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
] as const satisfies readonly [DayOfWeek, ...DayOfWeek[]];

/**
 * Saturday and Sunday.
 *
 * @category Time Periods
 */
export const weekend = ["saturday", "sunday"] as const satisfies readonly [
  DayOfWeek,
  ...DayOfWeek[],
];

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
  dayOfWeek?: readonly [DayOfWeek, ...DayOfWeek[]];
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
 * compile-time validation by {@link schedule}. This is an opaque
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
  if (opts?.dayOfWeek) pattern.dayOfWeek = opts.dayOfWeek;
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
  dayOfWeek?: readonly [DayOfWeek, ...DayOfWeek[]];
  /** Restrict to a date range. */
  dateRange?: { start: string; end: string };
  /** Restrict to specific dates (YYYY-MM-DD). */
  dates?: string[];
  /** Restrict to recurring calendar periods. */
  recurringPeriods?: [RecurringPeriod, ...RecurringPeriod[]];
}

/**
 * Context passed to a rule's resolve function during compilation.
 *
 * Contains the declared roles, skills, and member IDs so the resolver
 * can translate user-facing fields (like `appliesTo`) into internal
 * scoping fields.
 *
 * @category Rules
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
 *
 * @category Rules
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

/** A value that can be passed to {@link Schedule.with}. */
type WithArg = Schedule | SchedulingMember[];

// ============================================================================
// SolveResult
// ============================================================================

/** Status of a solve attempt, using idiomatic lowercase TypeScript literals. */
export type SolveStatus = "optimal" | "feasible" | "infeasible" | "no_solution";

/**
 * Result of {@link Schedule.solve}.
 *
 * @category Schedule Definition
 */
export interface SolveResult {
  /** Outcome of the solve attempt. */
  status: SolveStatus;
  /** Shift assignments (empty when infeasible or no solution). */
  assignments: ShiftAssignment[];
  /** Validation diagnostics from compilation. */
  validation: ScheduleValidation;
  /** Cost breakdown (present when cost rules are used and a solution is found). */
  cost?: CostBreakdown;
}

/**
 * Options for {@link Schedule.solve} and {@link Schedule.compile}.
 *
 * @category Schedule Definition
 */
export interface SolveOptions {
  /** The date range to schedule. */
  dateRange: { start: string; end: string };
  /**
   * Fixed assignments from a prior solve (e.g., rolling schedule).
   * These are injected as fixed variables in the solver.
   *
   * Not yet implemented. Providing pinned assignments throws an error.
   */
  pinned?: ShiftAssignment[];
}

// ============================================================================
// Schedule Configuration
// ============================================================================

/**
 * Configuration for {@link schedule}.
 *
 * @remarks
 * Coverage entries for the same semantic time and target stack additively.
 * An unscoped entry applies every day; adding a weekend-only entry on top
 * doubles the count on those days. Use mutually exclusive `dayOfWeek` on
 * both entries to avoid stacking. See {@link cover} for details.
 *
 * `roleIds`, `times`, `coverage`, and `shiftPatterns` are required.
 * These four fields form the minimum solvable schedule.
 *
 * @category Schedule Definition
 */
export interface ScheduleConfig<
  R extends readonly string[] = readonly string[],
  S extends readonly string[] = readonly string[],
  T extends Record<string, SemanticTimeEntry> = Record<string, SemanticTimeEntry>,
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
  /**
   * Custom rule factories. Keys are rule names, values are functions
   * that take a config object and return a {@link CompilationRule}.
   * Built-in rule names cannot be overridden.
   */
  ruleFactories?: Record<string, CreateCpsatRuleFunction>;
  /** Team members (typically added via `.with()` at runtime). */
  members?: SchedulingMember[];
  /** Days of the week the business operates (inclusion filter). */
  dayOfWeek?: readonly [DayOfWeek, ...DayOfWeek[]];
  /** Which day starts the week for weekly rules. Defaults to `"monday"`. */
  weekStartsOn?: DayOfWeek;
}

// ============================================================================
// Internal merged config
// ============================================================================

/** Internal representation of a fully merged schedule. */
interface MergedScheduleConfig {
  roleIds: string[];
  skillIds: string[];
  times: Record<string, SemanticTimeEntry>;
  coverage: CoverageEntry[];
  shiftPatterns: ShiftPattern[];
  rules: RuleEntry[];
  ruleFactories: Record<string, CreateCpsatRuleFunction>;
  members: SchedulingMember[];
  dayOfWeek?: readonly [DayOfWeek, ...DayOfWeek[]];
  weekStartsOn?: DayOfWeek;
}

// ============================================================================
// Schedule class
// ============================================================================

/**
 * An immutable schedule definition.
 *
 * Created by {@link schedule}, composed via {@link Schedule.with},
 * and solved via {@link Schedule.solve}.
 *
 * @category Schedule Definition
 */
export class Schedule {
  readonly #config: Readonly<MergedScheduleConfig>;

  /** @internal */
  constructor(config: MergedScheduleConfig) {
    this.#config = config;
  }

  /** @internal Returns a defensive copy of the config for merging. */
  _getConfig(): MergedScheduleConfig {
    return {
      ...this.#config,
      roleIds: [...this.#config.roleIds],
      skillIds: [...this.#config.skillIds],
      times: { ...this.#config.times },
      coverage: [...this.#config.coverage],
      shiftPatterns: [...this.#config.shiftPatterns],
      rules: [...this.#config.rules],
      ruleFactories: { ...this.#config.ruleFactories },
      members: [...this.#config.members],
    };
  }

  // --------------------------------------------------------------------------
  // Inspection
  // --------------------------------------------------------------------------

  /** Declared role IDs. */
  get roleIds(): readonly string[] {
    return this.#config.roleIds;
  }

  /** Declared skill IDs. */
  get skillIds(): readonly string[] {
    return this.#config.skillIds;
  }

  /** Names of declared semantic times. */
  get timeNames(): readonly string[] {
    return Object.keys(this.#config.times);
  }

  /** Shift pattern IDs. */
  get shiftPatternIds(): readonly string[] {
    return this.#config.shiftPatterns.map((sp) => sp.id);
  }

  /** Internal rule identifiers in kebab-case. */
  get ruleNames(): readonly string[] {
    return this.#config.rules.map((r) => r._rule);
  }

  // --------------------------------------------------------------------------
  // Composition
  // --------------------------------------------------------------------------

  /**
   * Merges schedules or members onto this schedule, returning a new
   * immutable `Schedule`. The original is untouched.
   *
   * Accepts any mix of `Schedule` instances and `SchedulingMember[]` arrays.
   *
   * Merge semantics (when merging schedules):
   * - Roles: union (additive)
   * - Skills: union (additive)
   * - Times: additive; error on name collision
   * - Coverage: additive
   * - Shift patterns: additive; error on ID collision
   * - Rules: additive
   * - Members: additive; error on duplicate ID
   *
   * Validation runs eagerly: role/skill disjointness, coverage targets
   * referencing declared roles/skills, member role references, etc.
   */
  with(...args: WithArg[]): Schedule {
    const merged = mergeConfig(this.#config, args);
    return new Schedule(merged);
  }

  // --------------------------------------------------------------------------
  // Solve / compile
  // --------------------------------------------------------------------------

  /**
   * Compiles, validates, solves, and parses in one call.
   *
   * @param client - Solver client (e.g., `new HttpSolverClient(fetch, url)`)
   * @param options - Date range and optional pinned assignments
   */
  async solve(client: SolverClient, options: SolveOptions): Promise<SolveResult> {
    const compiled = this.compile(options);
    if (!compiled.canSolve) {
      return {
        status: "infeasible",
        assignments: [],
        validation: compiled.validation,
      };
    }

    const response = await client.solve(compiled.request);
    return buildSolveResult(response, compiled, this.#config);
  }

  /**
   * Diagnostic escape hatch. Compiles the schedule without solving.
   *
   * @param options - Date range and optional pinned assignments
   */
  compile(options: SolveOptions): CompilationResult & { builder: ModelBuilder } {
    if (options.pinned && options.pinned.length > 0) {
      throw new Error("Pinned assignments are not yet supported.");
    }

    const modelConfig = resolveToModelConfig(this.#config, options);
    const builder = new ModelBuilder(modelConfig);
    const result = builder.compile();
    return { ...result, builder };
  }
}

// ============================================================================
// schedule() factory
// ============================================================================

/**
 * Create a schedule definition.
 *
 * Returns an immutable {@link Schedule} that can be composed via `.with()`
 * and solved via `.solve()`.
 *
 * @example
 * ```typescript
 * const venue = schedule({
 *   roleIds: ["waiter", "runner", "manager"],
 *   skillIds: ["senior"],
 *   times: {
 *     lunch: time({ startTime: t(12), endTime: t(15) }),
 *     dinner: time(
 *       { startTime: t(17), endTime: t(21) },
 *       { startTime: t(18), endTime: t(22), dayOfWeek: weekend },
 *     ),
 *   },
 *   coverage: [
 *     cover("lunch", "waiter", 2),
 *     cover("dinner", "waiter", 4, { dayOfWeek: weekdays }),
 *     cover("dinner", "waiter", 5, { dayOfWeek: weekend }),
 *     cover("dinner", "manager", 1),
 *   ],
 *   shiftPatterns: [
 *     shift("lunch_shift", t(11, 30), t(15)),
 *     shift("evening", t(17), t(22)),
 *   ],
 *   rules: [
 *     maxHoursPerDay(10),
 *     maxHoursPerWeek(48),
 *     minRestBetweenShifts(11),
 *   ],
 * });
 * ```
 *
 * @category Schedule Definition
 */
export function schedule<
  const R extends readonly string[],
  const S extends readonly string[],
  const T extends Record<string, SemanticTimeEntry>,
>(config: ScheduleConfig<R, S, T>): Schedule {
  const merged = buildMergedConfig(config as unknown as ScheduleConfig);
  validateConfig(merged);
  return new Schedule(merged);
}

/**
 * Create a partial schedule for composition via `.with()`.
 *
 * Unlike {@link schedule}, all fields are optional. Use this for
 * schedules that layer rules, coverage, or other config onto a
 * complete base schedule.
 *
 * @example
 * ```typescript
 * const companyPolicy = partialSchedule({
 *   rules: [maxHoursPerWeek(40), minRestBetweenShifts(11)],
 * });
 *
 * const ready = venue.with(companyPolicy, teamMembers);
 * ```
 *
 * @category Schedule Definition
 */
export function partialSchedule(config: Partial<ScheduleConfig>): Schedule {
  const merged = buildMergedConfig({
    roleIds: [],
    times: {},
    coverage: [],
    shiftPatterns: [],
    ...config,
  } as ScheduleConfig);
  validateConfig(merged);
  return new Schedule(merged);
}

// ============================================================================
// Internal: Build merged config from user input
// ============================================================================

function buildMergedConfig(config: ScheduleConfig): MergedScheduleConfig {
  return {
    roleIds: [...config.roleIds],
    skillIds: [...(config.skillIds ?? [])],
    times: { ...config.times },
    coverage: [...config.coverage],
    shiftPatterns: [...config.shiftPatterns],
    rules: [...(config.rules ?? [])],
    ruleFactories: config.ruleFactories ? { ...config.ruleFactories } : {},
    members: [...(config.members ?? [])],
    dayOfWeek: config.dayOfWeek,
    weekStartsOn: config.weekStartsOn,
  };
}

// ============================================================================
// Internal: Validate merged config
// ============================================================================

function validateConfig(config: MergedScheduleConfig): void {
  const roles = new Set<string>(config.roleIds);
  const skills = new Set<string>(config.skillIds);

  // Validate custom rule factories don't override built-in names
  for (const name of Object.keys(config.ruleFactories)) {
    if (name in builtInCpsatRuleFactories) {
      throw new Error(
        `Custom rule factory "${name}" conflicts with a built-in rule. Choose a different name.`,
      );
    }
  }

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
    validateCoverageEntry(entry, roles, skills);
  }

  // Validate member references
  const memberIds = new Set<string>();
  for (const member of config.members) {
    if (memberIds.has(member.id)) {
      throw new Error(`Duplicate member ID "${member.id}".`);
    }
    memberIds.add(member.id);

    if (roles.has(member.id)) {
      throw new Error(`Member ID "${member.id}" collides with a declared role name.`);
    }
    if (skills.has(member.id)) {
      throw new Error(`Member ID "${member.id}" collides with a declared skill name.`);
    }

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
}

function validateCoverageEntry(
  entry: CoverageEntry,
  roles: Set<string>,
  skills: Set<string>,
): void {
  const targets = Array.isArray(entry.target) ? entry.target : [entry.target];
  if (Array.isArray(entry.target)) {
    for (const target of targets) {
      if (!roles.has(target)) {
        throw new Error(
          `Coverage for "${entry.timeName}" references "${target}" in a role OR group, ` +
            `but it is not a declared role. Declared roles: ${[...roles].join(", ")}`,
        );
      }
    }
  } else {
    if (!roles.has(entry.target) && !skills.has(entry.target)) {
      throw new Error(
        `Coverage for "${entry.timeName}" references unknown target "${entry.target}". ` +
          `Declared roles: ${[...roles].join(", ")}. ` +
          `Declared skills: ${[...skills].join(", ")}`,
      );
    }
  }
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

// ============================================================================
// Internal: Merge logic
// ============================================================================

function mergeConfig(base: Readonly<MergedScheduleConfig>, args: WithArg[]): MergedScheduleConfig {
  const result: MergedScheduleConfig = {
    roleIds: [...base.roleIds],
    skillIds: [...base.skillIds],
    times: { ...base.times },
    coverage: [...base.coverage],
    shiftPatterns: [...base.shiftPatterns],
    rules: [...base.rules],
    ruleFactories: { ...base.ruleFactories },
    members: [...base.members],
    dayOfWeek: base.dayOfWeek,
    weekStartsOn: base.weekStartsOn,
  };

  for (const arg of args) {
    if (arg instanceof Schedule) {
      mergeScheduleFragment(result, arg);
    } else if (Array.isArray(arg)) {
      mergeMembers(result, arg);
    } else {
      throw new Error(
        `Unexpected argument passed to .with(): expected Schedule or SchedulingMember[], got ${typeof arg}`,
      );
    }
  }

  // Validate the merged result
  validateConfig(result);
  return result;
}

function mergeScheduleFragment(result: MergedScheduleConfig, s: Schedule): void {
  const other = s._getConfig();

  // dayOfWeek: error on conflict (semantics of union vs intersection are ambiguous)
  if (other.dayOfWeek !== undefined) {
    if (result.dayOfWeek !== undefined) {
      const baseSet = new Set(result.dayOfWeek);
      const same =
        result.dayOfWeek.length === other.dayOfWeek.length &&
        other.dayOfWeek.every((d) => baseSet.has(d));
      if (!same) {
        throw new Error(
          "Cannot merge schedules with different dayOfWeek filters. " +
            `Base has [${result.dayOfWeek.join(", ")}], ` +
            `incoming has [${other.dayOfWeek.join(", ")}].`,
        );
      }
    } else {
      result.dayOfWeek = other.dayOfWeek;
    }
  }

  // weekStartsOn: error on conflict (only one week boundary for weekly rules)
  if (other.weekStartsOn !== undefined) {
    if (result.weekStartsOn !== undefined && result.weekStartsOn !== other.weekStartsOn) {
      throw new Error(
        "Cannot merge schedules with different weekStartsOn values. " +
          `Base has "${result.weekStartsOn}", incoming has "${other.weekStartsOn}".`,
      );
    }
    result.weekStartsOn = other.weekStartsOn;
  }

  // Roles: union
  for (const role of other.roleIds) {
    if (!result.roleIds.includes(role)) {
      result.roleIds.push(role);
    }
  }

  // Skills: union
  for (const skill of other.skillIds) {
    if (!result.skillIds.includes(skill)) {
      result.skillIds.push(skill);
    }
  }

  // Times: additive, error on collision
  for (const [name, entry] of Object.entries(other.times)) {
    if (name in result.times) {
      throw new Error(
        `Time name "${name}" already exists. Cannot merge schedules with colliding time names.`,
      );
    }
    result.times[name] = entry;
  }

  // Coverage: additive
  result.coverage.push(...other.coverage);

  // Shift patterns: additive, error on ID collision
  const existingIds = new Set(result.shiftPatterns.map((sp) => sp.id));
  for (const sp of other.shiftPatterns) {
    if (existingIds.has(sp.id)) {
      throw new Error(
        `Shift pattern ID "${sp.id}" already exists. Cannot merge schedules with colliding shift pattern IDs.`,
      );
    }
    result.shiftPatterns.push(sp);
    existingIds.add(sp.id);
  }

  // Rules: additive
  result.rules.push(...other.rules);

  // Rule factories: merge, error on collision
  for (const [name, factory] of Object.entries(other.ruleFactories)) {
    if (name in result.ruleFactories && result.ruleFactories[name] !== factory) {
      throw new Error(
        `Rule factory "${name}" already registered. Cannot merge schedules with colliding rule factories.`,
      );
    }
    result.ruleFactories[name] = factory;
  }

  // Members: additive, error on duplicate ID
  const existingMemberIds = new Set(result.members.map((m) => m.id));
  for (const member of other.members) {
    if (existingMemberIds.has(member.id)) {
      throw new Error(
        `Duplicate member ID "${member.id}". Cannot merge schedules with colliding member IDs.`,
      );
    }
    result.members.push(member);
    existingMemberIds.add(member.id);
  }
}

function mergeMembers(result: MergedScheduleConfig, incoming: SchedulingMember[]): void {
  const existingIds = new Set(result.members.map((m) => m.id));
  for (const member of incoming) {
    if (existingIds.has(member.id)) {
      throw new Error(
        `Duplicate member ID "${member.id}". Cannot merge members with colliding IDs.`,
      );
    }
    result.members.push(member);
    existingIds.add(member.id);
  }
}

// ============================================================================
// Internal: Resolve to ModelBuilderConfig
// ============================================================================

function resolveToModelConfig(
  config: Readonly<MergedScheduleConfig>,
  options: SolveOptions,
): ModelBuilderConfig {
  const roles = new Set<string>(config.roleIds);
  const skills = new Set<string>(config.skillIds);
  const memberIds = new Set<string>(config.members.map((m) => m.id));

  // Build semantic time context
  const semanticTimes = defineSemanticTimes(config.times);

  // Convert coverage entries to semantic coverage requirements
  const coverageReqs = buildCoverageRequirements(config.coverage, roles, skills);

  // Resolve scheduling period with dayOfWeek filter
  const schedulingPeriod: SchedulingPeriod = {
    dateRange: options.dateRange,
  };
  const resolvedPeriod = applyDaysFilter(schedulingPeriod, config.dayOfWeek);
  const days = resolveDaysFromPeriod(resolvedPeriod);

  // Resolve coverage
  const resolvedCoverage = semanticTimes.resolve(coverageReqs, days);

  // Resolve rules
  const allRules = [...config.rules];

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
    const missingPay = config.members.filter((m) => !m.pay).map((m) => m.id);
    if (missingPay.length > 0) {
      throw new Error(
        `Cost rules require pay data on all members. Missing pay: ${missingPay.join(", ")}`,
      );
    }
  }

  // Sort rules so minimize-cost compiles before modifier rules
  const sortedRules = sortCostRulesFirst(allRules);
  const ruleConfigs = resolveRules(sortedRules, roles, skills, memberIds);

  return {
    members: config.members,
    shiftPatterns: config.shiftPatterns,
    schedulingPeriod: resolvedPeriod,
    coverage: resolvedCoverage,
    ruleConfigs,
    ruleFactories:
      Object.keys(config.ruleFactories).length > 0
        ? { ...builtInCpsatRuleFactories, ...config.ruleFactories }
        : undefined,
    weekStartsOn: config.weekStartsOn,
  };
}

// ============================================================================
// Internal: Build SolveResult from solver response
// ============================================================================

function mapSolverStatus(solverStatus: SolverResponse["status"]): SolveStatus {
  switch (solverStatus) {
    case "OPTIMAL":
      return "optimal";
    case "FEASIBLE":
      return "feasible";
    case "INFEASIBLE":
      return "infeasible";
    case "TIMEOUT":
    case "ERROR":
      return "no_solution";
    default:
      return "no_solution";
  }
}

function buildSolveResult(
  response: SolverResponse,
  compiled: CompilationResult & { builder: ModelBuilder },
  config: Readonly<MergedScheduleConfig>,
): SolveResult {
  const status = mapSolverStatus(response.status);
  const parsed = parseSolverResponse(response);

  // Run post-solve validation when a solution exists
  if (parsed.assignments.length > 0 && (status === "optimal" || status === "feasible")) {
    const resolved = resolveAssignments(parsed.assignments, compiled.builder.shiftPatterns);
    compiled.builder.reporter.analyzeSolution(response);
    compiled.builder.validateSolution(resolved);
  }

  const validation = compiled.builder.reporter.getValidation();

  const result: SolveResult = {
    status,
    assignments: parsed.assignments,
    validation,
  };

  // Compute cost breakdown when cost rules are present and a solution was found
  if (parsed.assignments.length > 0 && (status === "optimal" || status === "feasible")) {
    const hasCostRules = config.rules.some((r) => r._rule === "minimize-cost");
    if (hasCostRules) {
      result.cost = calculateScheduleCost(parsed.assignments, {
        members: config.members,
        shiftPatterns: config.shiftPatterns,
        rules: compiled.builder.rules,
      });
    }
  }

  return result;
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
 * Each target string is checked against roles, skills, then member IDs.
 * If all targets resolve to the same namespace, they are combined into one
 * scope field. If they span namespaces, an error is thrown; the caller
 * should use separate rule entries instead.
 */
function resolveAppliesTo(
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

function resolveRules(
  rules: RuleEntry[],
  roles: Set<string>,
  skills: Set<string>,
  memberIds: Set<string>,
): CpsatRuleConfigEntry[] {
  const ctx: RuleResolveContext = { roles, skills, memberIds };

  return rules.map((rule) => {
    // Rules with custom resolvers handle their own translation
    if (rule._resolve) {
      return rule._resolve(ctx) as CpsatRuleConfigEntry;
    }

    // Default resolution: appliesTo → entity scope, dates → specificDates
    const { _type, _rule, _resolve, appliesTo, dates, ...passthrough } = rule as RuleEntry & {
      appliesTo?: string | string[];
      dates?: string[];
    };

    const entityScope = resolveAppliesTo(appliesTo, roles, skills, memberIds);
    const resolvedDates = dates ? { specificDates: dates } : {};

    return {
      name: _rule,
      ...passthrough,
      ...entityScope,
      ...resolvedDates,
    } as CpsatRuleConfigEntry;
  }) as CpsatRuleConfigEntry[];
}

// ============================================================================
// Internal: Cost Rule Ordering
// ============================================================================

/**
 * Sorts rules so that `minimize-cost` compiles before cost modifier rules.
 *
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
  dayOfWeek?: readonly [DayOfWeek, ...DayOfWeek[]],
): SchedulingPeriod {
  if (!dayOfWeek || dayOfWeek.length === 0) {
    return schedulingPeriod;
  }

  const existingDays = schedulingPeriod.dayOfWeek;
  if (!existingDays || existingDays.length === 0) {
    return { ...schedulingPeriod, dayOfWeek: [...dayOfWeek] };
  }

  const existingSet = new Set(existingDays);
  const intersected = dayOfWeek.filter((day) => existingSet.has(day));
  return { ...schedulingPeriod, dayOfWeek: intersected };
}
