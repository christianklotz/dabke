import type { CompilationRule } from "../model-builder.js";

export type CreateCpsatRuleFunction<TConfig = any> = (config: TConfig) => CompilationRule;

// Registry of built-in rule names to their config types
export interface CpsatRuleRegistry {
  "assign-together": import("./assign-together.js").AssignTogetherConfig;
  "employee-assignment-priority": import("./employee-assignment-priority.js").EmployeeAssignmentPriorityConfig;
  "location-preference": import("./location-preference.js").LocationPreferenceConfig;
  "max-consecutive-days": import("./max-consecutive-days.js").MaxConsecutiveDaysConfig;
  "max-hours-day": import("./max-hours-day.js").MaxHoursDayConfig;
  "max-hours-week": import("./max-hours-week.js").MaxHoursWeekConfig;
  "max-shifts-day": import("./max-shifts-day.js").MaxShiftsDayConfig;
  "min-consecutive-days": import("./min-consecutive-days.js").MinConsecutiveDaysConfig;
  "min-hours-day": import("./min-hours-day.js").MinHoursDayConfig;
  "min-hours-week": import("./min-hours-week.js").MinHoursWeekConfig;
  "min-rest-between-shifts": import("./min-rest-between-shifts.js").MinRestBetweenShiftsConfig;
  "time-off": import("./time-off.js").TimeOffConfig;
}

export type CpsatRuleName = keyof CpsatRuleRegistry;

export type CpsatRuleFactories = {
  [ruleName: string]: CreateCpsatRuleFunction<any>;
};

export type BuiltInCpsatRuleFactories = {
  [K in CpsatRuleName]: CreateCpsatRuleFunction<CpsatRuleRegistry[K]>;
};

export type InferCpsatRuleConfig<T> =
  T extends CreateCpsatRuleFunction<infer Config> ? Config : never;

export type CpsatRuleRegistryFromFactories<F extends CpsatRuleFactories> = {
  [K in keyof F]: InferCpsatRuleConfig<F[K]>;
};

export type CpsatRuleConfigEntry<K extends CpsatRuleName = CpsatRuleName> = {
  name: K;
  config: CpsatRuleRegistry[K];
};
