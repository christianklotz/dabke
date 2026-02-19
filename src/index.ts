/**
 * Scheduling library powered by constraint programming (CP-SAT).
 *
 * Define teams, shifts, coverage, and rules. dabke turns them
 * into an optimized schedule.
 *
 * @remarks
 * ## Core Concepts
 *
 * **ModelBuilder**: Creates the constraint programming model from your team,
 * shift patterns, coverage requirements, and rules.
 *
 * **Semantic Time**: Flexible time period definitions that can vary by day or date.
 * - `{ name: "morning", startTime: { hours: 8 }, endTime: { hours: 12 } }`
 * - The same semantic name can map to different times based on context
 * - Enables business-friendly scheduling: "Need 3 waiters during lunch_rush"
 *
 * **Rules System**: Translate business requirements into scheduling constraints.
 * - 12 built-in rules: hours limits, time-off, rest periods, prioritization, etc.
 * - Scoping: Apply rules globally, per person, per role, or per time period
 * - Priority levels: MANDATORY (hard constraint) vs LOW/MEDIUM/HIGH (soft preferences)
 *
 * @example Complete workflow
 * ```typescript
 * import {
 *   ModelBuilder,
 *   HttpSolverClient,
 *   parseSolverResponse,
 *   defineSemanticTimes,
 * } from "dabke";
 *
 * // Define semantic times
 * const times = defineSemanticTimes({
 *   business_hours: { startTime: { hours: 9 }, endTime: { hours: 17 } },
 * });
 *
 * // Create coverage requirements
 * const coverage = times.coverage([
 *   { semanticTime: "business_hours", roleIds: ["worker"], targetCount: 2 },
 * ]);
 *
 * // Define shift patterns
 * const shiftPatterns = [
 *   { id: "day_shift", startTime: { hours: 9 }, endTime: { hours: 17 } },
 * ];
 *
 * // Build the model
 * const builder = new ModelBuilder({
 *   members: [{ id: "alice", roles: ["worker"] }],
 *   shiftPatterns,
 *   schedulingPeriod: {
 *     dateRange: { start: "2026-02-09", end: "2026-02-15" },
 *   },
 *   coverage: times.resolve(coverage, ["2026-02-09", "2026-02-10"]),
 *   ruleConfigs: [
 *     { name: "max-hours-week", hours: 40, priority: "MANDATORY" },
 *   ],
 * });
 *
 * // Compile and solve
 * const client = new HttpSolverClient(fetch, "http://localhost:8080");
 * const { request, canSolve, validation } = builder.compile();
 * if (!canSolve) {
 *   console.error("Cannot solve:", validation.errors);
 * } else {
 *   const response = await client.solve(request);
 *   const result = parseSolverResponse(response);
 * }
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// Time primitives
// ============================================================================

export type {
  TimeOfDay,
  CalendarDate,
  DayOfWeek,
  TimeHorizon,
  DateTime,
  DateTimeComponents,
  DateTimeRange,
  SchedulingPeriod,
} from "./types.js";

export { DayOfWeekSchema } from "./types.js";

// ============================================================================
// Date/time utilities
// ============================================================================

export {
  dateToCalendarDate,
  dateTimeToDate,
  compareDateTimes,
  toDayOfWeek,
  toDayOfWeekUTC,
  formatDateString,
  generateDays,
  splitPeriodIntoDays,
  splitPeriodIntoWeeks,
  dateTimeRangesOverlap,
  daysBetween,
  resolveDaysFromPeriod,
} from "./datetime.utils.js";

// ============================================================================
// Errors
// ============================================================================

export { ORSchedulingError } from "./errors.js";

// ============================================================================
// Solver client
// ============================================================================

export { HttpSolverClient } from "./client.js";

export type {
  SolverClient,
  SolverRequest,
  SolverResponse,
  SolverVariable,
  SolverConstraint,
  SolverTerm,
  SolverObjective,
  SolverStatus,
  SoftConstraintViolation,
  FetcherLike,
} from "./client.types.js";

export { SOLVER_STATUS } from "./client.types.js";

export { SolverRequestSchema, SolverResponseSchema, SolverStatusSchema } from "./client.schemas.js";

// ============================================================================
// Model builder
// ============================================================================

export { ModelBuilder } from "./cpsat/model-builder.js";

export type {
  ModelBuilderConfig,
  CompilationResult,
  CompilationRule,
  RuleValidationContext,
  CostContext,
  CostEntry,
  CostContribution,
} from "./cpsat/model-builder.js";

// ============================================================================
// Solver response parsing
// ============================================================================

export { parseSolverResponse, resolveAssignments } from "./cpsat/response.js";

export type { ShiftAssignment, ResolvedShiftAssignment, SolverResult } from "./cpsat/response.js";

// ============================================================================
// Rules
// ============================================================================

export {
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
} from "./cpsat/rules/index.js";

export type {
  EntityScopeType,
  OptionalTimeScopeType,
  RequiredTimeScopeType,
  ParsedEntityScope,
  ParsedTimeScope,
  RecurringPeriod,
} from "./cpsat/rules/scope.types.js";
export type { AssignTogetherConfig } from "./cpsat/rules/assign-together.js";
export type { AssignmentPriorityConfig } from "./cpsat/rules/assignment-priority.js";
export type { LocationPreferenceConfig } from "./cpsat/rules/location-preference.js";
export type { MaxConsecutiveDaysConfig } from "./cpsat/rules/max-consecutive-days.js";
export type { MaxHoursDayConfig } from "./cpsat/rules/max-hours-day.js";
export type { MaxHoursWeekConfig } from "./cpsat/rules/max-hours-week.js";
export type { MaxShiftsDayConfig } from "./cpsat/rules/max-shifts-day.js";
export type { MinConsecutiveDaysConfig } from "./cpsat/rules/min-consecutive-days.js";
export type { MinHoursDayConfig } from "./cpsat/rules/min-hours-day.js";
export type { MinHoursWeekConfig } from "./cpsat/rules/min-hours-week.js";
export type { MinRestBetweenShiftsConfig } from "./cpsat/rules/min-rest-between-shifts.js";
export type { TimeOffConfig } from "./cpsat/rules/time-off.js";
export type { MinimizeCostConfig } from "./cpsat/rules/minimize-cost.js";
export type { DayCostMultiplierConfig } from "./cpsat/rules/day-cost-multiplier.js";
export type { DayCostSurchargeConfig } from "./cpsat/rules/day-cost-surcharge.js";
export type { TimeCostSurchargeConfig } from "./cpsat/rules/time-cost-surcharge.js";
export type { OvertimeWeeklyMultiplierConfig } from "./cpsat/rules/overtime-weekly-multiplier.js";
export type { OvertimeWeeklySurchargeConfig } from "./cpsat/rules/overtime-weekly-surcharge.js";
export type { OvertimeDailyMultiplierConfig } from "./cpsat/rules/overtime-daily-multiplier.js";
export type { OvertimeDailySurchargeConfig } from "./cpsat/rules/overtime-daily-surcharge.js";
export type {
  OvertimeTieredMultiplierConfig,
  OvertimeTier,
} from "./cpsat/rules/overtime-tiered-multiplier.js";

export { builtInCpsatRuleFactories, createCpsatRuleFactory } from "./cpsat/rules/registry.js";

export type {
  CpsatRuleRegistry,
  CpsatRuleName,
  CpsatRuleConfigEntry,
  CpsatRuleFactories,
  BuiltInCpsatRuleFactories,
  CreateCpsatRuleFunction,
  CpsatRuleRegistryFromFactories,
} from "./cpsat/rules/rules.types.js";

// ============================================================================
// Semantic time
// ============================================================================

export {
  defineSemanticTimes,
  isConcreteCoverage,
  isSemanticCoverage,
} from "./cpsat/semantic-time.js";

export type {
  SemanticTimeDef,
  SemanticTimeVariant,
  SemanticTimeEntry,
  SemanticTimeContext,
  SemanticCoverageRequirement,
  ConcreteCoverageRequirement,
  MixedCoverageRequirement,
} from "./cpsat/semantic-time.js";

// ============================================================================
// Cost calculation
// ============================================================================

export { calculateScheduleCost, COST_CATEGORY } from "./cpsat/cost.js";

export type { CostBreakdown, MemberCostDetail, CostCalculationConfig } from "./cpsat/cost.js";

// ============================================================================
// Types (scheduling domain)
// ============================================================================

export type {
  HourlyPay,
  SalariedPay,
  SchedulingMember,
  ShiftPattern,
  CoverageRequirement,
  TimeInterval,
  Priority,
  ModelBuilderOptions,
} from "./cpsat/types.js";

// ============================================================================
// Constants
// ============================================================================

export { OBJECTIVE_WEIGHTS } from "./cpsat/utils.js";

// ============================================================================
// Validation
// ============================================================================

export { ValidationReporterImpl } from "./cpsat/validation-reporter.js";

export type { ValidationReporter } from "./cpsat/validation-reporter.js";

export type { TrackedConstraint, CoverageExclusion } from "./cpsat/validation.types.js";

export type {
  ScheduleValidation,
  ScheduleError,
  ScheduleViolation,
  SchedulePassed,
  CoverageError,
  CoverageViolation,
  CoveragePassed,
  RuleError,
  RuleViolation,
  RulePassed,
  SolverError,
  ValidationContext,
  ValidationSummary,
  GroupKey,
} from "./cpsat/validation.types.js";

export { groupKey } from "./cpsat/validation.types.js";

export { summarizeValidation } from "./cpsat/validation-reporter.js";

export {
  validateCoverageRoles,
  validateCoverageSkills,
  validateCoverageConfig,
} from "./validation.js";

export type {
  CoverageValidationResult,
  SkillValidationResult,
  CoverageConfigValidationResult,
} from "./validation.js";

// ============================================================================
// Schedule Definition API (v2)
// ============================================================================

export {
  defineSchedule,
  t,
  time,
  cover,
  shift,
  maxHoursPerDay,
  maxHoursPerWeek,
  minHoursPerDay,
  minHoursPerWeek,
  maxShiftsPerDay,
  maxConsecutiveDays,
  minConsecutiveDays,
  minRestBetweenShifts,
  preference,
  preferLocation,
  timeOff,
  assignTogether,
  minimizeCost,
  dayMultiplier,
  daySurcharge,
  timeSurcharge,
  overtimeMultiplier,
  overtimeSurcharge,
  dailyOvertimeMultiplier,
  dailyOvertimeSurcharge,
  tieredOvertimeMultiplier,
  weekdays,
  weekend,
} from "./schedule.js";

export type {
  TimeEntry,
  CoverageEntry,
  CoverageOptions,
  ShiftPatternDef,
  ShiftOptions,
  RuleEntry,
  RuleOptions,
  EntityOnlyRuleOptions,
  TimeOffOptions,
  AssignTogetherOptions,
  CostRuleOptions,
  RuntimeArgs,
  ScheduleDefinition,
  ScheduleConfig,
} from "./schedule.js";
