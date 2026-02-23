/**
 * @privateRemarks
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

export type { TimeOfDay, DayOfWeek, SchedulingPeriod } from "./types.js";

export { DayOfWeekSchema } from "./types.js";

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
  CostEntry,
  CostContribution,
} from "./cpsat/model-builder.js";

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

export type {
  CpsatRuleConfigEntry,
  CpsatRuleFactories,
  CreateCpsatRuleFunction,
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
  maxShiftsPerDay,
  maxConsecutiveDays,
  minConsecutiveDays,
  minRestBetweenShifts,
  preference,
  preferLocation,
  timeOff,
  assignTogether,
  defineRule,
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
  CoverageEntry,
  CoverageOptions,
  CoverageVariant,
  RuleEntry,
  RuleResolveContext,
  RuleOptions,
  EntityOnlyRuleOptions,
  TimeOffOptions,
  AssignTogetherOptions,
  CostRuleOptions,
  ScheduleConfig,
  SolveResult,
  SolveStatus,
  SolveOptions,
} from "./schedule.js";
