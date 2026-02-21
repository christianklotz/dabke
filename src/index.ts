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
 *   roleIds: ["nurse", "doctor"],
 *   skillIds: ["charge_nurse"],
 *
 *   times: {
 *     morning_round: time({ startTime: t(7), endTime: t(9) }),
 *     day_ward: time({ startTime: t(7), endTime: t(15) }),
 *     night_ward: time({ startTime: t(23), endTime: t(7) }),
 *   },
 *
 *   coverage: [
 *     cover("morning_round", "doctor", 1),
 *     cover("day_ward", "nurse", 3, { dayOfWeek: weekdays }),
 *     cover("day_ward", "nurse", 2, { dayOfWeek: weekend }),
 *     cover("night_ward", "nurse", 2),
 *     cover("night_ward", "charge_nurse", 1),
 *   ],
 *
 *   shiftPatterns: [
 *     shift("day", t(7), t(15)),
 *     shift("night", t(23), t(7)),
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
 *     { id: "alice", roleIds: ["nurse"], skillIds: ["charge_nurse"] },
 *     { id: "bob", roleIds: ["nurse"] },
 *     { id: "carol", roleIds: ["doctor"] },
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
// Rules (registry types)
// ============================================================================

export type {
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
// Schedule Definition API
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
  CoverageEntry,
  CoverageOptions,
  CoverageVariant,
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
