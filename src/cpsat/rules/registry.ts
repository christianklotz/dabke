import {
  assignTogetherRuleDescriptor,
  assignmentPriorityRuleDescriptor,
  dayCostMultiplierRuleDescriptor,
  dayCostSurchargeRuleDescriptor,
  locationPreferenceRuleDescriptor,
  maxConcurrentAssignmentsRuleDescriptor,
  maxConsecutiveDaysRuleDescriptor,
  maxDaysOfWeekPerPeriodRuleDescriptor,
  maxDaysWeekRuleDescriptor,
  maxHoursDayRuleDescriptor,
  maxHoursWeekRuleDescriptor,
  maxShiftsDayRuleDescriptor,
  minConsecutiveDaysRuleDescriptor,
  minDaysOfWeekPerPeriodRuleDescriptor,
  minDaysWeekRuleDescriptor,
  minHoursDayRuleDescriptor,
  minHoursWeekRuleDescriptor,
  minRestBetweenShiftsRuleDescriptor,
  minimizeCostRuleDescriptor,
  mustAssignRuleDescriptor,
  overtimeDailyMultiplierRuleDescriptor,
  overtimeDailySurchargeRuleDescriptor,
  overtimeTieredMultiplierRuleDescriptor,
  overtimeWeeklyMultiplierRuleDescriptor,
  overtimeWeeklySurchargeRuleDescriptor,
  rolePreferenceRuleDescriptor,
  targetDaysWeekRuleDescriptor,
  targetPeakConcurrentAssignmentsRuleDescriptor,
  timeCostSurchargeRuleDescriptor,
  timeOffRuleDescriptor,
} from "./index.js";
import type { BuiltInCpsatRuleRegistry, CpsatRuleName, CpsatRuleRegistry } from "./rules.types.js";

/**
 * Validates that each rule registry key matches the descriptor name it points to.
 *
 * @remarks
 * This enforces the invariant required by registry-driven config typing and by
 * runtime rule resolution. A registry entry like `{ debug: descriptorNamedFoo }`
 * is rejected because the key and descriptor identity diverge.
 *
 * @category Rules
 */
export function assertValidCpsatRuleRegistry<Registry extends CpsatRuleRegistry>(
  ruleRegistry: Registry,
): Registry {
  for (const [key, descriptor] of Object.entries(ruleRegistry)) {
    if (descriptor.name !== key) {
      throw new Error(
        `Registered CP-SAT rule descriptor key "${key}" must match descriptor.name "${descriptor.name}".`,
      );
    }
  }

  return ruleRegistry;
}

/**
 * Validates that a registry does not shadow built-in rule names with different descriptors.
 *
 * @remarks
 * A registry may reuse the exact built-in descriptor instance under the same name,
 * but it may not replace a built-in rule with an incompatible descriptor.
 */
export function assertNoBuiltInCpsatRuleOverrides<Registry extends CpsatRuleRegistry>(
  ruleRegistry: Registry,
): Registry {
  for (const name in ruleRegistry) {
    if (
      name in builtInCpsatRuleRegistry &&
      ruleRegistry[name] !== builtInCpsatRuleRegistry[name as CpsatRuleName]
    ) {
      throw new Error(`Cannot override built-in CP-SAT rule "${name}" in custom registry`);
    }
  }

  return ruleRegistry;
}

/**
 * Creates a custom CP-SAT rule registry.
 *
 * @remarks
 * Built-in rule names cannot be redefined unless the registry entry points to
 * the exact same built-in descriptor instance.
 *
 * @example
 * ```ts
 * const debugRuleRegistry = createCpsatRuleRegistry({
 *   debug: defineRuleDescriptor({
 *     name: "debug",
 *     schema: z.object({ flag: z.boolean() }),
 *     compile() {
 *       return { rule: "debug", artifacts: [] };
 *     },
 *   }),
 * });
 * ```
 *
 * @category Rules
 */
export function createCpsatRuleRegistry<Registry extends CpsatRuleRegistry>(
  ruleRegistry: Registry,
): Registry {
  assertNoBuiltInCpsatRuleOverrides(ruleRegistry);
  return assertValidCpsatRuleRegistry(ruleRegistry);
}

/**
 * The built-in CP-SAT rule registry.
 *
 * @remarks
 * Pass this to {@link defineRuleFor} when you want registry-bound authoring for
 * built-in rules, or spread it into a larger registry when building a fully
 * explicit descriptor set.
 *
 * @category Rules
 */
export const builtInCpsatRuleRegistry = assertValidCpsatRuleRegistry({
  "assign-together": assignTogetherRuleDescriptor,
  "assignment-priority": assignmentPriorityRuleDescriptor,
  "location-preference": locationPreferenceRuleDescriptor,
  "role-preference": rolePreferenceRuleDescriptor,
  "max-concurrent-assignments": maxConcurrentAssignmentsRuleDescriptor,
  "target-peak-concurrent-assignments": targetPeakConcurrentAssignmentsRuleDescriptor,
  "target-days-week": targetDaysWeekRuleDescriptor,
  "max-consecutive-days": maxConsecutiveDaysRuleDescriptor,
  "max-days-week": maxDaysWeekRuleDescriptor,
  "max-hours-day": maxHoursDayRuleDescriptor,
  "max-hours-week": maxHoursWeekRuleDescriptor,
  "max-shifts-day": maxShiftsDayRuleDescriptor,
  "min-consecutive-days": minConsecutiveDaysRuleDescriptor,
  "min-days-week": minDaysWeekRuleDescriptor,
  "min-hours-day": minHoursDayRuleDescriptor,
  "min-hours-week": minHoursWeekRuleDescriptor,
  "min-rest-between-shifts": minRestBetweenShiftsRuleDescriptor,
  "must-assign": mustAssignRuleDescriptor,
  "time-off": timeOffRuleDescriptor,
  "minimize-cost": minimizeCostRuleDescriptor,
  "day-cost-multiplier": dayCostMultiplierRuleDescriptor,
  "day-cost-surcharge": dayCostSurchargeRuleDescriptor,
  "time-cost-surcharge": timeCostSurchargeRuleDescriptor,
  "overtime-weekly-multiplier": overtimeWeeklyMultiplierRuleDescriptor,
  "overtime-weekly-surcharge": overtimeWeeklySurchargeRuleDescriptor,
  "overtime-daily-multiplier": overtimeDailyMultiplierRuleDescriptor,
  "overtime-daily-surcharge": overtimeDailySurchargeRuleDescriptor,
  "overtime-tiered-multiplier": overtimeTieredMultiplierRuleDescriptor,
  "max-days-of-week-per-period": maxDaysOfWeekPerPeriodRuleDescriptor,
  "min-days-of-week-per-period": minDaysOfWeekPerPeriodRuleDescriptor,
} satisfies BuiltInCpsatRuleRegistry);
