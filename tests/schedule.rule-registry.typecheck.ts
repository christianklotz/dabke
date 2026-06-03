/**
 * Type-level tests for registry-aware schedule authoring.
 * Each line marked @ts-expect-error must produce a type error.
 */

import * as z from "zod";
import { defineRuleDescriptor } from "../src/cpsat/rule-descriptor.js";
import { builtInCpsatRuleRegistry, createCpsatRuleRegistry } from "../src/cpsat/rules.js";
import type { Schedule } from "../src/index.js";
import {
  assignTogether,
  cover,
  defineRule,
  defineRuleFor,
  maxDaysOfWeekPerPeriod,
  maxHoursPerDay,
  minDaysOfWeekPerPeriod,
  schedule,
  scheduleWithRuleRegistry,
  shift,
  t,
  time,
  timeOff,
} from "../src/index.js";
import type { RuleEntry } from "../src/schedule/index.js";

const baseScheduleConfig = {
  roleIds: ["waiter"] as const,
  times: {
    lunch: time({ startTime: t(12), endTime: t(15) }),
  },
  coverage: [cover("lunch", "waiter", 1)],
  shiftPatterns: [shift("lunch-shift", t(12), t(15))],
};

const debugRuleRegistry = createCpsatRuleRegistry({
  debug: defineRuleDescriptor({
    name: "debug",
    schema: z.object({
      flag: z.boolean(),
    }),
    compile(_config) {
      return { rule: "debug", artifacts: [] };
    },
  }),
});

const combinedRuleRegistry = createCpsatRuleRegistry({
  ...builtInCpsatRuleRegistry,
  ...debugRuleRegistry,
});

const defineBuiltInRule = defineRuleFor(builtInCpsatRuleRegistry);
const defineDebugRule = defineRuleFor(debugRuleRegistry);

function debugRule(flag: boolean): RuleEntry {
  return defineRule("debug", { flag });
}

const _builtInHelperSchedule = schedule({
  ...baseScheduleConfig,
  rules: [maxHoursPerDay(8)],
});

const _builtInDefineRuleSchedule = schedule({
  ...baseScheduleConfig,
  rules: [
    defineBuiltInRule("max-hours-day", {
      hours: 8,
      priority: "MANDATORY",
    }),
  ],
});

const _builtInDirectDefineRuleSchedule = schedule({
  ...baseScheduleConfig,
  rules: [defineRule("max-hours-day", { hours: 8, priority: "MANDATORY" })],
});

// @ts-expect-error: direct built-in defineRule usage must match built-in config fields
const _invalidBuiltInDirectDefineRuleFieldsSchedule = schedule({
  ...baseScheduleConfig,
  rules: [defineRule("max-hours-day", { hourz: 8, priority: "MANDATORY" })],
});

const _timeOffRuleName: "time-off" = timeOff({
  appliesTo: "waiter",
  dayOfWeek: ["monday"],
})._rule;

const _assignTogetherRuleName: "assign-together" = assignTogether(["alice", "bob"])._rule;

const _maxDaysOfWeekPerPeriodRuleName: "max-days-of-week-per-period" = maxDaysOfWeekPerPeriod(
  1,
  ["monday"],
  { weeks: 1 },
)._rule;

const _minDaysOfWeekPerPeriodRuleName: "min-days-of-week-per-period" = minDaysOfWeekPerPeriod(
  1,
  ["monday"],
  { weeks: 1 },
)._rule;

const _customRuleSchedule = schedule({
  ...baseScheduleConfig,
  ruleRegistry: debugRuleRegistry,
  rules: [debugRule(true)],
});

const _combinedRuleSchedule = schedule({
  ...baseScheduleConfig,
  ruleRegistry: debugRuleRegistry,
  rules: [maxHoursPerDay(8), debugRule(true)],
});

const _customOnlySchedule = scheduleWithRuleRegistry(debugRuleRegistry, {
  ...baseScheduleConfig,
  rules: [defineDebugRule("debug", { flag: true })],
});

const _combinedRegistrySchedule = schedule({
  ...baseScheduleConfig,
  ruleRegistry: combinedRuleRegistry,
  rules: [
    defineRule("debug", { flag: true }),
    defineRule("max-hours-day", { hours: 8, priority: "MANDATORY" }),
  ],
});

const _mergedRegistrySchedule: Schedule<typeof debugRuleRegistry> = schedule(
  baseScheduleConfig,
).with(
  schedule({
    ...baseScheduleConfig,
    ruleRegistry: debugRuleRegistry,
    rules: [debugRule(true)],
  }),
);

// @ts-expect-error: misspelled built-in rule names are rejected
const _invalidBuiltInRuleName = defineBuiltInRule("max-hours-dya", {
  hours: 8,
  priority: "MANDATORY",
});

const _invalidBuiltInRuleFields = defineBuiltInRule("max-hours-day", {
  // @ts-expect-error: built-in rule fields must match the selected built-in rule
  hourz: 8,
  priority: "MANDATORY",
});

const _invalidCustomRuleNameSchedule = schedule({
  ...baseScheduleConfig,
  ruleRegistry: debugRuleRegistry,
  rules: [
    // @ts-expect-error: custom rule names must exist in the active rule registry
    defineDebugRule("debig", { flag: true }),
  ],
});

const _invalidDirectCustomRuleNameSchedule = schedule({
  ...baseScheduleConfig,
  ruleRegistry: debugRuleRegistry,
  rules: [
    // @ts-expect-error: direct custom rules must match registry names
    defineRule("debig", { flag: true }),
  ],
});

const _invalidCustomRuleFieldsSchedule = schedule({
  ...baseScheduleConfig,
  ruleRegistry: debugRuleRegistry,
  rules: [
    // @ts-expect-error: custom rule fields must match the custom descriptor config
    defineDebugRule("debug", { enabled: true }),
  ],
});

const _invalidDirectCustomRuleFieldsSchedule = schedule({
  ...baseScheduleConfig,
  ruleRegistry: debugRuleRegistry,
  rules: [
    // @ts-expect-error: direct custom rules must match registry field shapes
    defineRule("debug", { enabled: true }),
  ],
});

const _invalidCustomOnlySchedule = scheduleWithRuleRegistry(debugRuleRegistry, {
  ...baseScheduleConfig,
  rules: [
    // @ts-expect-error: built-in helpers are not available in an explicitly custom-only registry
    maxHoursPerDay(8),
  ],
});

void [
  _builtInHelperSchedule,
  _builtInDefineRuleSchedule,
  _builtInDirectDefineRuleSchedule,
  _invalidBuiltInDirectDefineRuleFieldsSchedule,
  _timeOffRuleName,
  _assignTogetherRuleName,
  _maxDaysOfWeekPerPeriodRuleName,
  _minDaysOfWeekPerPeriodRuleName,
  _customRuleSchedule,
  _combinedRuleSchedule,
  _customOnlySchedule,
  _combinedRegistrySchedule,
  _mergedRegistrySchedule,
  _invalidBuiltInRuleName,
  _invalidBuiltInRuleFields,
  _invalidCustomRuleNameSchedule,
  _invalidDirectCustomRuleNameSchedule,
  _invalidCustomRuleFieldsSchedule,
  _invalidDirectCustomRuleFieldsSchedule,
  _invalidCustomOnlySchedule,
];
