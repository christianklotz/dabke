/**
 * Cost optimization rules: minimize labor cost with modifiers.
 *
 * @module
 */

import type { DayOfWeek, TimeOfDay } from "../types.js";
import type { OvertimeTier } from "../cpsat/rules/overtime-tiered-multiplier.js";
import type { RecurringPeriod } from "../cpsat/rules/scope.types.js";
import type { RuleEntry } from "./rules.js";
import { defineRule } from "./rules.js";

// ============================================================================
// Cost Rule Options
// ============================================================================

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

// ============================================================================
// Cost Rules
// ============================================================================

function makeCostRule(rule: string, fields: Record<string, unknown>): RuleEntry {
  return defineRule(rule, fields);
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
  return makeCostRule("minimize-cost", { ...opts });
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
  return makeCostRule("day-cost-multiplier", { factor, ...opts });
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
  return makeCostRule("day-cost-surcharge", { amountPerHour, ...opts });
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
  return makeCostRule("time-cost-surcharge", { amountPerHour, window, ...opts });
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
  return makeCostRule("overtime-weekly-multiplier", { ...opts });
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
  return makeCostRule("overtime-weekly-surcharge", { ...opts });
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
  return makeCostRule("overtime-daily-multiplier", { ...opts });
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
  return makeCostRule("overtime-daily-surcharge", { ...opts });
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
  return makeCostRule("overtime-tiered-multiplier", { tiers, ...opts });
}
