/**
 * Scheduling library powered by constraint programming (CP-SAT).
 *
 * @remarks
 * ## Core Concepts
 *
 * **Schedule**: The primary API. Small, composable functions
 * ({@link time}, {@link cover}, {@link shift}, rule functions) produce a
 * complete scheduling configuration via {@link schedule}. Each concept
 * is a single function call with full type safety.
 *
 * **Times vs Shift Patterns**: These are two distinct concepts.
 * `times` are named time windows used to define and reference recurring
 * periods: service hours, delivery windows, peak periods, weekly events
 * like a fire drill. Times may overlap (e.g., "dinner" 18:00-22:00 and
 * "happy_hour" 17:30-18:30). Coverage and rules reference these names.
 * `shiftPatterns` define WHEN people CAN work (available time slots).
 * The solver assigns people to shift patterns whose hours overlap with
 * times to satisfy coverage. Not every shift pattern needs a
 * corresponding time; create times only for periods you need to
 * reference.
 *
 * **Rules**: Business requirements expressed as scheduling constraints.
 * - Built-in rules: hours limits, time-off, rest periods, preferences, cost optimization
 * - Scoping: apply rules globally, per person, per role, per skill, or per time period
 * - Priority: `MANDATORY` (hard constraint) vs `LOW`/`MEDIUM`/`HIGH` (soft preferences)
 *
 * **Solving**: {@link Schedule.compile} compiles the config into a
 * solver request; {@link Schedule.solve} sends it to the CP-SAT solver
 * and returns a {@link SolveResult}.
 *
 * @packageDocumentation
 */

// ============================================================================
// Time primitives
// ============================================================================

export type { DateString, TimeOfDay, DayOfWeek, SchedulingDay, SchedulingPeriod } from "./types.js";

export { schedulingDay, DAY_OF_WEEK_INDEX, DayOfWeekSchema } from "./types.js";

// ============================================================================
// Solver client
// ============================================================================

export { HttpSolverClient } from "./client.js";

export type {
  SolverClient,
  SolverRequest,
  SolverResponse,
  SolverStatus,
  SolverMode,
  SolverDiagnosticMode,
  SolverObjectiveStage,
  SolverStageResult,
  SolverSoftConstraintViolation,
  SolverHardConstraintConflict,
  FetcherLike,
} from "./client.types.js";

export { SOLVER_STATUS } from "./client.types.js";

export {
  SolverModeSchema,
  SolverDiagnosticModeSchema,
  SolverObjectiveStageSchema,
  SolverRequestSchema,
  SolverResponseSchema,
  SolverStageResultSchema,
  SolverStatusSchema,
  SolverHardConstraintConflictSchema,
} from "./client.schemas.js";

// ============================================================================
// Model builder
// ============================================================================

export { ModelBuilder } from "./cpsat/model-builder.js";

export type { ModelBuilderConfig, CompilationResult } from "./cpsat/model-builder.js";
export type { ModelSolveStrategy } from "./cpsat/types.js";

export { compileRuleDescriptor, defineRuleDescriptor } from "./cpsat/rule-descriptor.js";

export type {
  CostValidationStrategy,
  HardConstraintValidationStrategy,
  ObjectiveValidationStrategy,
  ReportHardConstraintValidationStrategy,
  ReportSoftConstraintValidationStrategy,
  RuleDescriptor,
  RuleCompileContext,
  RuleArtifact,
  SkipValidationStrategy,
  SoftConstraintValidationStrategy,
  CompiledRule,
  ValidationSkipCategory,
  CostEntry,
  CostContribution,
} from "./cpsat/rule-descriptor.js";

// ============================================================================
// Solver response parsing
// ============================================================================

export { parseSolverResponse, resolveAssignments } from "./cpsat/response.js";

export type { ShiftAssignment, ResolvedShiftAssignment, SolverResult } from "./cpsat/response.js";

// ============================================================================
// Cost calculation
// ============================================================================

export { calculateScheduleCost, COST_CATEGORY } from "./cpsat/cost.js";

export type { CostBreakdown, MemberCostDetail, CostCalculationConfig } from "./cpsat/cost.js";

// ============================================================================
// Rules (registry types)
// ============================================================================

export {
  assertValidCpsatRuleRegistry,
  builtInCpsatRuleRegistry,
  createCpsatRuleRegistry,
} from "./cpsat/rules/registry.js";

export type {
  BuiltInCpsatRuleConfigRegistry,
  BuiltInCpsatRuleRegistry,
  CpsatRuleConfigByName,
  CpsatRuleConfigEntry,
  CpsatRuleConfigEntryFor,
  CpsatRuleRegistry,
} from "./cpsat/rules/rules.types.js";

export type { RecurringPeriod } from "./cpsat/rules/scope.types.js";

export type { OvertimeTier } from "./cpsat/rules/overtime-tiered-multiplier.js";

// ============================================================================
// Types (scheduling domain)
// ============================================================================

export type {
  HourlyPay,
  SalariedPay,
  SchedulingMember,
  ShiftPattern,
  Priority,
} from "./cpsat/types.js";

// ============================================================================
// Constants
// ============================================================================

export { OBJECTIVE_WEIGHTS } from "./cpsat/utils.js";

// ============================================================================
// Validation
// ============================================================================

export type {
  ValidationGroup,
  ScheduleValidation,
  ScheduleError,
  CoverageError,
  RuleError,
  SolverError,
  ScheduleViolation,
  CoverageViolation,
  RuleViolation,
  SchedulePassed,
  CoveragePassed,
  RulePassed,
  ValidationSummary,
} from "./cpsat/validation.types.js";

export { summarizeValidation } from "./cpsat/validation-reporter.js";

// ============================================================================
// Schedule API
// ============================================================================

export {
  schedule,
  scheduleWithRuleRegistry,
  partialSchedule,
  Schedule,
  t,
  time,
  cover,
  shift,
  maxHoursPerDay,
  maxHoursPerWeek,
  minHoursPerDay,
  minHoursPerWeek,
  maxDaysPerWeek,
  minDaysPerWeek,
  targetDaysPerWeek,
  maxShiftsPerDay,
  maxConcurrentAssignments,
  targetPeakConcurrentAssignments,
  maxConsecutiveDays,
  minConsecutiveDays,
  minRestBetweenShifts,
  mustAssign,
  preferAssignment,
  avoidAssignment,
  preferRole,
  preferLocation,
  timeOff,
  assignTogether,
  maxDaysOfWeekPerPeriod,
  minDaysOfWeekPerPeriod,
  defineRule,
  defineRuleFor,
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
} from "./schedule/index.js";

export type {
  CoverageEntry,
  CoverageOptions,
  CoverageVariant,
  RuleEntry,
  RuleResolveContext,
  RuleOptions,
  ScheduleRuleEntry,
  EntityOnlyRuleOptions,
  TargetDaysPerWeekOptions,
  TimeOffOptions,
  AssignTogetherOptions,
  MaxConcurrentAssignmentsOptions,
  TargetPeakConcurrentAssignmentsOptions,
  DaysOfWeekPerPeriodOptions,
  CostRuleOptions,
  ScheduleConfig,
  ScheduleWithRuleRegistryConfig,
  SolveResult,
  SolveStatus,
  SolveStrategy,
  SolveOptions,
} from "./schedule/index.js";
