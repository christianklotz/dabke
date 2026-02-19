/**
 * Type-level tests for scope-types.
 * Each line marked @ts-expect-error must produce a type error.
 * If tsc passes, the types are correct.
 */

import type { TimeOffConfig } from "../../src/cpsat/rules/time-off.js";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules/rules.types.js";

// ============================================================================
// Valid configs (should compile)
// ============================================================================

const _valid1: TimeOffConfig = {
  priority: "MANDATORY",
  dayOfWeek: ["sunday"],
};

const _valid2: TimeOffConfig = {
  priority: "MANDATORY",
  dayOfWeek: ["saturday", "sunday"],
  memberIds: ["mauro"],
};

const _valid3: TimeOffConfig = {
  priority: "HIGH",
  specificDates: ["2024-02-01"],
  roleIds: ["student"],
};

const _valid4: TimeOffConfig = {
  priority: "MANDATORY",
  dateRange: { start: "2024-02-01", end: "2024-02-05" },
};

const _valid5: TimeOffConfig = {
  priority: "LOW",
  recurringPeriods: [{ name: "summer", startMonth: 7, startDay: 1, endMonth: 8, endDay: 31 }],
  skillIds: ["keyholder"],
};

const _validEntry: CpsatRuleConfigEntry = {
  name: "time-off",
  priority: "MANDATORY",
  dayOfWeek: ["sunday"],
};

// ============================================================================
// THE ORIGINAL BUG — should be caught by tsc
// ============================================================================

const _bugEmptySpecificDates: TimeOffConfig = {
  priority: "MANDATORY",
  // @ts-expect-error: [] not assignable to [string, ...string[]]
  specificDates: [],
};

const _bugEmptyMemberIds: TimeOffConfig = {
  priority: "MANDATORY",
  dayOfWeek: ["monday"],
  // @ts-expect-error: [] not assignable to [string, ...string[]]
  memberIds: [],
};

// ============================================================================
// Missing time scope (should fail)
// ============================================================================

// @ts-expect-error: missing required time scope
const _noTime: TimeOffConfig = {
  priority: "MANDATORY",
};

// @ts-expect-error: missing required time scope
const _noTimeWithEntity: TimeOffConfig = {
  priority: "MANDATORY",
  memberIds: ["alice"],
};

// ============================================================================
// Multiple entity scopes (should fail)
// ============================================================================

// @ts-expect-error: roleIds is never when memberIds is present
const _multiEntity: TimeOffConfig = {
  priority: "MANDATORY",
  dayOfWeek: ["monday"],
  memberIds: ["alice"],
  roleIds: ["barista"],
};

// ============================================================================
// Multiple time scopes (should fail)
// ============================================================================

// @ts-expect-error: specificDates is never when dayOfWeek is present
const _multiTime: TimeOffConfig = {
  priority: "MANDATORY",
  dayOfWeek: ["monday"],
  specificDates: ["2024-02-01"],
};

void [
  _valid1,
  _valid2,
  _valid3,
  _valid4,
  _valid5,
  _validEntry,
  _bugEmptySpecificDates,
  _bugEmptyMemberIds,
  _noTime,
  _noTimeWithEntity,
  _multiEntity,
  _multiTime,
];
