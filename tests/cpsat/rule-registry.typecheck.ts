/**
 * Type-level tests for CP-SAT rule registries.
 * Each line marked @ts-expect-error must produce a type error.
 */

import * as z from "zod";
import type { ModelBuilderConfig } from "../../src/cpsat/model-builder.js";
import { compileRuleDescriptor, defineRuleDescriptor, schedulingDay } from "../../src/index.js";
import {
  builtInCpsatRuleRegistry,
  createCpsatRuleRegistry,
  type CpsatRuleConfigEntry,
  type CpsatRuleConfigEntryFor,
} from "../../src/cpsat/rules.js";

const _builtInEntry: CpsatRuleConfigEntry = {
  name: "max-hours-day",
  hours: 8,
  priority: "MANDATORY",
};

const _invalidBuiltInEntry: CpsatRuleConfigEntry = {
  name: "max-hours-day",
  // @ts-expect-error: max-hours-day requires hours, not factor
  factor: 1.5,
  priority: "MANDATORY",
};

const debugRuleRegistry = createCpsatRuleRegistry({
  debug: defineRuleDescriptor({
    name: "debug",
    schema: z.object({
      flag: z.boolean(),
      memberIds: z.array(z.string()).optional(),
    }),
    compile(_config) {
      return { rule: "debug", artifacts: [] };
    },
  }),
});

type DebugRuleConfigEntry = CpsatRuleConfigEntryFor<typeof debugRuleRegistry>;

const _customEntry: DebugRuleConfigEntry = {
  name: "debug",
  flag: true,
};

const _invalidCustomEntry: DebugRuleConfigEntry = {
  name: "debug",
  // @ts-expect-error: debug does not accept built-in max-hours-day fields
  hours: 8,
  priority: "MANDATORY",
};

const combinedRuleRegistry = createCpsatRuleRegistry({
  ...builtInCpsatRuleRegistry,
  ...debugRuleRegistry,
});

type CombinedRuleConfigEntry = CpsatRuleConfigEntryFor<typeof combinedRuleRegistry>;

const _combinedBuiltInEntry: CombinedRuleConfigEntry = {
  name: "max-hours-day",
  hours: 8,
  priority: "MANDATORY",
};

const _combinedCustomEntry: CombinedRuleConfigEntry = {
  name: "debug",
  flag: true,
};

const _invalidCombinedEntry: CombinedRuleConfigEntry = {
  name: "debug",
  // @ts-expect-error: debug config must match the debug descriptor
  hours: 8,
  priority: "MANDATORY",
};

const _customModelBuilderConfig: ModelBuilderConfig<typeof debugRuleRegistry> = {
  members: [],
  shiftPatterns: [],
  schedulingPeriod: {
    dateRange: { start: "2024-02-01", end: "2024-02-01" },
  },
  coverage: [],
  ruleRegistry: debugRuleRegistry,
  ruleConfigs: [
    {
      name: "debug",
      flag: true,
    },
  ],
};

const _invalidCustomModelBuilderConfig: ModelBuilderConfig<typeof debugRuleRegistry> = {
  members: [],
  shiftPatterns: [],
  schedulingPeriod: {
    dateRange: { start: "2024-02-01", end: "2024-02-01" },
  },
  coverage: [],
  ruleRegistry: debugRuleRegistry,
  ruleConfigs: [
    {
      name: "debug",
      // @ts-expect-error: debug config remains type-safe when used through ModelBuilderConfig
      hours: 8,
      priority: "MANDATORY",
    },
  ],
};

const _combinedModelBuilderConfig: ModelBuilderConfig<typeof combinedRuleRegistry> = {
  members: [],
  shiftPatterns: [],
  schedulingPeriod: {
    dateRange: { start: "2024-02-01", end: "2024-02-01" },
  },
  coverage: [],
  ruleRegistry: combinedRuleRegistry,
  ruleConfigs: [
    {
      name: "max-hours-day",
      hours: 8,
      priority: "MANDATORY",
    },
    {
      name: "debug",
      flag: true,
    },
  ],
};

const _compiledDebugRule = compileRuleDescriptor(
  debugRuleRegistry.debug,
  { flag: true },
  {
    members: [],
    shiftPatterns: [],
    days: [schedulingDay("2024-02-01")],
    weekStartsOn: "monday",
  },
);

void [
  _builtInEntry,
  _invalidBuiltInEntry,
  _customEntry,
  _invalidCustomEntry,
  _combinedBuiltInEntry,
  _combinedCustomEntry,
  _invalidCombinedEntry,
  _customModelBuilderConfig,
  _invalidCustomModelBuilderConfig,
  _combinedModelBuilderConfig,
  _compiledDebugRule,
];
