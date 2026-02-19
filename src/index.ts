/**
 * Scheduling library powered by constraint programming (CP-SAT).
 *
 * Define teams, shifts, coverage, and rules declaratively. dabke compiles
 * them into a constraint model and solves for an optimized schedule.
 *
 * @remarks
 * ## Core Concepts
 *
 * **Schedule Definition**: The primary API. Small, composable functions
 * ({@link time}, {@link cover}, {@link shift}, rule functions) produce a
 * complete scheduling configuration via {@link defineSchedule}. Each concept
 * is a single function call with full type safety.
 *
 * **Rules**: Business requirements expressed as scheduling constraints.
 * - Built-in rules: hours limits, time-off, rest periods, preferences, cost optimization
 * - Scoping: apply rules globally, per person, per role, per skill, or per time period
 * - Priority: `MANDATORY` (hard constraint) vs `LOW`/`MEDIUM`/`HIGH` (soft preferences)
 *
 * **Solving**: {@link ScheduleDefinition.createSchedulerConfig} merges the
 * static definition with runtime data (members, scheduling period).
 * {@link ModelBuilder} compiles the config into a solver request;
 * {@link HttpSolverClient} sends it to the CP-SAT solver.
 *
 * @example Define a schedule
 * ```typescript
 * import {
 *   defineSchedule, t, time, cover, shift,
 *   maxHoursPerWeek, minRestBetweenShifts, timeOff,
 *   weekdays, weekend,
 * } from "dabke";
 *
 * const schedule = defineSchedule({
 *   roles: ["waiter", "manager"],
 *   skills: ["senior"],
 *
 *   times: {
 *     lunch: time({ start: t(12), end: t(15) }),
 *     dinner: time(
 *       { start: t(17), end: t(21) },
 *       { start: t(18), end: t(22), dayOfWeek: weekend },
 *     ),
 *   },
 *
 *   coverage: [
 *     cover("lunch", "waiter", 2),
 *     cover("dinner", "waiter", 3, { dayOfWeek: weekdays }),
 *     cover("dinner", "waiter", 4, { dayOfWeek: weekend }),
 *     cover("dinner", "manager", 1),
 *   ],
 *
 *   shiftPatterns: [
 *     shift("lunch_shift", t(12), t(15)),
 *     shift("evening", t(17), t(22)),
 *   ],
 *
 *   rules: [
 *     maxHoursPerWeek(40),
 *     minRestBetweenShifts(11),
 *     timeOff({ appliesTo: "alice", dayOfWeek: weekend }),
 *   ],
 * });
 * ```
 *
 * @example Solve a schedule
 * ```typescript
 * import { ModelBuilder, HttpSolverClient, parseSolverResponse } from "dabke";
 *
 * const config = schedule.createSchedulerConfig({
 *   schedulingPeriod: {
 *     dateRange: { start: "2026-02-09", end: "2026-02-15" },
 *   },
 *   members: [
 *     { id: "alice", roles: ["waiter"] },
 *     { id: "bob", roles: ["waiter", "manager"], skills: ["senior"] },
 *   ],
 * });
 *
 * const builder = new ModelBuilder(config);
 * const { request, canSolve, validation } = builder.compile();
 * if (canSolve) {
 *   const client = new HttpSolverClient(fetch, "http://localhost:8080");
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

export type { TimeOfDay, DayOfWeek, DateTime, SchedulingPeriod } from "./types.js";

export { DayOfWeekSchema } from "./types.js";

// ============================================================================
// Date/time utilities
// ============================================================================

export { dateTimeToDate } from "./datetime.utils.js";

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
// Rules (registry types)
// ============================================================================

export type {
  CpsatRuleRegistry,
  CpsatRuleName,
  CpsatRuleConfigEntry,
  CpsatRuleFactories,
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
  CoverageRequirement,
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

export type { ValidationReporter } from "./cpsat/validation-reporter.js";

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

export { summarizeValidation } from "./cpsat/validation-reporter.js";

export { groupKey } from "./cpsat/validation.types.js";

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
