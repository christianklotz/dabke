/**
 * High-level schedule definition API.
 *
 * Small, composable factory functions that produce a complete scheduling
 * configuration. Designed for LLM code generation: each concept is a single
 * function call with per-call type safety.
 *
 * @example
 * ```typescript
 * import {
 *   schedule, t, time, cover, shift,
 *   maxHoursPerDay, maxHoursPerWeek, minRestBetweenShifts,
 *   weekdays, weekend,
 * } from "dabke";
 *
 * const venue = schedule({
 *   roleIds: ["cashier", "floor_lead", "stocker"],
 *   skillIds: ["keyholder"],
 *
 *   times: {
 *     opening: time({ startTime: t(8), endTime: t(10) }),
 *     peak_hours: time(
 *       { startTime: t(11), endTime: t(14) },
 *       { startTime: t(10), endTime: t(15), dayOfWeek: weekend },
 *     ),
 *     closing: time({ startTime: t(20), endTime: t(22) }),
 *   },
 *
 *   coverage: [
 *     cover("opening", "keyholder", 1),
 *     cover("peak_hours", "cashier", 3, { dayOfWeek: weekdays }),
 *     cover("peak_hours", "cashier", 5, { dayOfWeek: weekend }),
 *     cover("closing", "floor_lead", 1),
 *   ],
 *
 *   shiftPatterns: [
 *     shift("morning", t(8), t(14)),
 *     shift("afternoon", t(14), t(22)),
 *   ],
 *
 *   rules: [
 *     maxHoursPerDay(10),
 *     maxHoursPerWeek(48),
 *     minRestBetweenShifts(10),
 *   ],
 * });
 *
 * const result = await venue
 *   .with([
 *     { id: "alice", roleIds: ["cashier"], skillIds: ["keyholder"] },
 *   ])
 *   .solve(client, { dateRange: { start: "2025-03-03", end: "2025-03-09" } });
 * ```
 *
 * @module
 */

// Time Periods
export { t, weekdays, weekend, time } from "./time-periods.js";

// Coverage
export { cover } from "./coverage.js";
export type { CoverageOptions, CoverageEntry, CoverageVariant } from "./coverage.js";

// Shift Patterns
export { shift } from "./shift-patterns.js";

// Rules
export {
  defineRule,
  defineRuleFor,
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
} from "./rules.js";
export type {
  RuleEntry,
  RuleResolveContext,
  RuleOptions,
  EntityOnlyRuleOptions,
  TargetDaysPerWeekOptions,
  TimeOffOptions,
  AssignTogetherOptions,
  MaxConcurrentAssignmentsOptions,
  TargetPeakConcurrentAssignmentsOptions,
  DaysOfWeekPerPeriodOptions,
  ScheduleRuleEntry,
} from "./rules.js";

// Cost Optimization
export {
  minimizeCost,
  dayMultiplier,
  daySurcharge,
  timeSurcharge,
  overtimeMultiplier,
  overtimeSurcharge,
  dailyOvertimeMultiplier,
  dailyOvertimeSurcharge,
  tieredOvertimeMultiplier,
} from "./cost.js";
export type { CostRuleOptions } from "./cost.js";

// Schedule Definition
export { schedule, scheduleWithRuleRegistry, partialSchedule, Schedule } from "./definition.js";
export type {
  ScheduleConfig,
  ScheduleWithRuleRegistryConfig,
  SolveResult,
  SolveStatus,
  SolveStrategy,
  SolveOptions,
} from "./definition.js";
