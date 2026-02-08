import {
  createAssignTogetherRule,
  createEmployeeAssignmentPriorityRule,
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
} from "./index.js";
import type {
  BuiltInCpsatRuleFactories,
  CpsatRuleFactories,
  CpsatRuleName,
} from "./rules.types.js";

export const builtInCpsatRuleFactories: BuiltInCpsatRuleFactories = {
  "assign-together": createAssignTogetherRule,
  "employee-assignment-priority": createEmployeeAssignmentPriorityRule,
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
