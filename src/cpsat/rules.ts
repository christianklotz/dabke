/**
 * Low-level CP-SAT rule descriptor and registry APIs.
 *
 * @remarks
 * These exports are intended for advanced consumers building custom rule
 * registries or integrating directly with the descriptor layer underneath the
 * high-level {@link schedule} helpers.
 *
 * Rules are the feedback unit. Validation groups summarize rule outcomes for
 * presentation, while individual solver constraints remain implementation
 * details. Descriptor compilation therefore emits artifacts that make the
 * validation story explicit: reported constraints, pre-solve feedback,
 * post-solve validators, cost contributions, and explicit skip strategies for
 * scaffolding or artifacts with no meaningful validation feedback.
 *
 * @module
 */

export {
  assignTogetherRuleDescriptor,
  assignmentPriorityRuleDescriptor,
  locationPreferenceRuleDescriptor,
  maxConcurrentAssignmentsRuleDescriptor,
  maxConsecutiveDaysRuleDescriptor,
  maxHoursDayRuleDescriptor,
  maxHoursWeekRuleDescriptor,
  minConsecutiveDaysRuleDescriptor,
  minHoursDayRuleDescriptor,
  minHoursWeekRuleDescriptor,
  minRestBetweenShiftsRuleDescriptor,
  targetDaysWeekRuleDescriptor,
  targetPeakConcurrentAssignmentsRuleDescriptor,
  timeOffRuleDescriptor,
} from "./rules/index.js";

export {
  assertValidCpsatRuleRegistry,
  builtInCpsatRuleRegistry,
  createCpsatRuleRegistry,
} from "./rules/registry.js";

export type {
  AnyCpsatRuleConfigEntry,
  BuiltInCpsatRuleConfigRegistry,
  BuiltInCpsatRuleRegistry,
  CpsatRuleConfigByName,
  CpsatRuleConfigEntry,
  CpsatRuleConfigEntryFor,
  CpsatRuleName,
  CpsatRuleRegistry,
} from "./rules/rules.types.js";

export { buildCpsatRules, getMemberIdsForScope, resolveRuleScopes } from "./rules/resolver.js";
