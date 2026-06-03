import type { RuleDescriptor } from "../rule-descriptor.js";

/**
 * Maps built-in CP-SAT rule names to their validated config types.
 *
 * @remarks
 * Use this when you need the exact config shape for a known built-in rule.
 * For registry-driven APIs, prefer `CpsatRuleRegistry`, `CpsatRuleConfigByName`,
 * and `CpsatRuleConfigEntryFor`.
 *
 * @category Rules
 */
export interface BuiltInCpsatRuleConfigRegistry {
  "assign-together": import("./assign-together.js").AssignTogetherConfig;
  "assignment-priority": import("./assignment-priority.js").AssignmentPriorityConfig;
  "location-preference": import("./location-preference.js").LocationPreferenceConfig;
  "role-preference": import("./role-preference.js").RolePreferenceConfig;
  "max-concurrent-assignments": import("./max-concurrent-assignments.js").MaxConcurrentAssignmentsConfig;
  "target-peak-concurrent-assignments": import("./target-peak-concurrent-assignments.js").TargetPeakConcurrentAssignmentsConfig;
  "target-days-week": import("./target-days-week.js").TargetDaysWeekConfig;
  "max-consecutive-days": import("./max-consecutive-days.js").MaxConsecutiveDaysConfig;
  "max-days-week": import("./max-days-week.js").MaxDaysWeekConfig;
  "max-hours-day": import("./max-hours-day.js").MaxHoursDayConfig;
  "max-hours-week": import("./max-hours-week.js").MaxHoursWeekConfig;
  "max-shifts-day": import("./max-shifts-day.js").MaxShiftsDayConfig;
  "min-consecutive-days": import("./min-consecutive-days.js").MinConsecutiveDaysConfig;
  "min-days-week": import("./min-days-week.js").MinDaysWeekConfig;
  "min-hours-day": import("./min-hours-day.js").MinHoursDayConfig;
  "min-hours-week": import("./min-hours-week.js").MinHoursWeekConfig;
  "min-rest-between-shifts": import("./min-rest-between-shifts.js").MinRestBetweenShiftsConfig;
  "must-assign": import("./must-assign.js").MustAssignConfig;
  "time-off": import("./time-off.js").TimeOffConfig;
  "minimize-cost": import("./minimize-cost.js").MinimizeCostConfig;
  "day-cost-multiplier": import("./day-cost-multiplier.js").DayCostMultiplierConfig;
  "day-cost-surcharge": import("./day-cost-surcharge.js").DayCostSurchargeConfig;
  "time-cost-surcharge": import("./time-cost-surcharge.js").TimeCostSurchargeConfig;
  "overtime-weekly-multiplier": import("./overtime-weekly-multiplier.js").OvertimeWeeklyMultiplierConfig;
  "overtime-weekly-surcharge": import("./overtime-weekly-surcharge.js").OvertimeWeeklySurchargeConfig;
  "overtime-daily-multiplier": import("./overtime-daily-multiplier.js").OvertimeDailyMultiplierConfig;
  "overtime-daily-surcharge": import("./overtime-daily-surcharge.js").OvertimeDailySurchargeConfig;
  "overtime-tiered-multiplier": import("./overtime-tiered-multiplier.js").OvertimeTieredMultiplierConfig;
  "max-days-of-week-per-period": import("./max-days-of-week-per-period.js").MaxDaysOfWeekPerPeriodConfig;
  "min-days-of-week-per-period": import("./min-days-of-week-per-period.js").MinDaysOfWeekPerPeriodConfig;
}

/**
 * The union of all built-in CP-SAT rule names.
 *
 * @category Rules
 */
export type CpsatRuleName = keyof BuiltInCpsatRuleConfigRegistry;

/**
 * A registry of CP-SAT rule descriptors keyed by rule name.
 *
 * @remarks
 * The registry key must exactly match each descriptor's `name` field.
 * Use `createCpsatRuleRegistry` to validate that invariant when building
 * custom registries.
 *
 * @category Rules
 */
export type CpsatRuleRegistry = Record<string, RuleDescriptor<string, unknown>>;

/**
 * The built-in CP-SAT rule registry shape.
 *
 * @category Rules
 */
export type BuiltInCpsatRuleRegistry = {
  [K in CpsatRuleName]: RuleDescriptor<K, BuiltInCpsatRuleConfigRegistry[K]>;
};

/**
 * Extracts the config type from a rule descriptor.
 *
 * @category Rules
 */
export type InferCpsatRuleConfig<T> =
  T extends RuleDescriptor<string, infer Config> ? Config : never;

/**
 * Maps a rule registry to a name-to-config lookup type.
 *
 * @example
 * ```ts
 * type ConfigByName = CpsatRuleConfigByName<typeof builtInCpsatRuleRegistry>;
 * //    ^? { "max-hours-day": MaxHoursDayConfig; ... }
 * ```
 *
 * @category Rules
 */
export type CpsatRuleConfigByName<Registry extends CpsatRuleRegistry> = {
  [K in keyof Registry & string]: InferCpsatRuleConfig<Registry[K]>;
};

/**
 * Builds the discriminated rule-entry union for a rule registry.
 *
 * @remarks
 * This preserves the pairing between each `name` value and the config fields
 * allowed for that rule.
 *
 * @category Rules
 */
export type CpsatRuleConfigEntryFor<Registry extends CpsatRuleRegistry> = {
  [K in keyof Registry & string]: { name: K } & InferCpsatRuleConfig<Registry[K]>;
}[keyof Registry & string];

/**
 * A normalized rule entry with an unconstrained string rule name.
 *
 * @remarks
 * This is used internally at points where the specific registry is no longer
 * known at the type level.
 *
 * @category Rules
 */
export type AnyCpsatRuleConfigEntry = { name: string } & Record<string, unknown>;

/**
 * A named rule configuration entry.
 *
 * Flat discriminated union: `name` is the discriminant and all config fields
 * (including scope fields like `memberIds`, `dayOfWeek`, etc.) sit at the
 * same level. This eliminates the `{ name, config: { ... } }` nesting that
 * invited misplacement of scope fields.
 *
 * @example
 * ```ts
 * const rules: CpsatRuleConfigEntry[] = [
 *   { name: "max-hours-week", hours: 40, priority: "MANDATORY" },
 *   { name: "time-off", memberIds: ["alice"], dayOfWeek: ["monday"], priority: "MANDATORY" },
 * ];
 * ```
 *
 * @category Rules
 */
export type CpsatRuleConfigEntry<Registry extends CpsatRuleRegistry = BuiltInCpsatRuleRegistry> =
  CpsatRuleConfigEntryFor<Registry>;
