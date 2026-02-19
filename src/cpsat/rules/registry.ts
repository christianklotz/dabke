import {
  createAssignTogetherRule,
  createAssignmentPriorityRule,
  createLocationPreferenceRule,
  createMaxConsecutiveDaysRule,
  createMaxHoursDayRule,
  createMaxHoursWeekRule,
  createMaxShiftsDayRule,
  createMinConsecutiveDaysRule,
  createMinHoursDayRule,
  createMinHoursWeekRule,
  createMinRestBetweenShiftsRule,
  createTimeOffRule,
  createMinimizeCostRule,
  createDayCostMultiplierRule,
  createDayCostSurchargeRule,
  createTimeCostSurchargeRule,
  createOvertimeWeeklyMultiplierRule,
  createOvertimeWeeklySurchargeRule,
  createOvertimeDailyMultiplierRule,
  createOvertimeDailySurchargeRule,
  createOvertimeTieredMultiplierRule,
} from "./index.js";
import type {
  BuiltInCpsatRuleFactories,
  CpsatRuleFactories,
  CpsatRuleName,
} from "./rules.types.js";

export const builtInCpsatRuleFactories: BuiltInCpsatRuleFactories = {
  "assign-together": createAssignTogetherRule,
  "assignment-priority": createAssignmentPriorityRule,
  "location-preference": createLocationPreferenceRule,
  "max-consecutive-days": createMaxConsecutiveDaysRule,
  "max-hours-day": createMaxHoursDayRule,
  "max-hours-week": createMaxHoursWeekRule,
  "max-shifts-day": createMaxShiftsDayRule,
  "min-consecutive-days": createMinConsecutiveDaysRule,
  "min-hours-day": createMinHoursDayRule,
  "min-hours-week": createMinHoursWeekRule,
  "min-rest-between-shifts": createMinRestBetweenShiftsRule,
  "time-off": createTimeOffRule,
  "minimize-cost": createMinimizeCostRule,
  "day-cost-multiplier": createDayCostMultiplierRule,
  "day-cost-surcharge": createDayCostSurchargeRule,
  "time-cost-surcharge": createTimeCostSurchargeRule,
  "overtime-weekly-multiplier": createOvertimeWeeklyMultiplierRule,
  "overtime-weekly-surcharge": createOvertimeWeeklySurchargeRule,
  "overtime-daily-multiplier": createOvertimeDailyMultiplierRule,
  "overtime-daily-surcharge": createOvertimeDailySurchargeRule,
  "overtime-tiered-multiplier": createOvertimeTieredMultiplierRule,
};

/**
 * Creates a rule factory map, preventing overriding built-in rules.
 */
export function createCpsatRuleFactory<F extends CpsatRuleFactories>(factories: F): F {
  for (const name in factories) {
    if (
      name in builtInCpsatRuleFactories &&
      factories[name] !== builtInCpsatRuleFactories[name as CpsatRuleName]
    ) {
      throw new Error(`Cannot override built-in CP-SAT rule "${name}" in custom factory`);
    }
  }
  return factories;
}
