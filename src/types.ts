/**
 * Core scheduling types for the CP-SAT solver.
 *
 * @packageDocumentation
 */

import * as z from "zod";

// ============================================================================
// Time Primitives
// ============================================================================

/**
 * Day of the week identifier.
 *
 * @category Supporting Types
 */
export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

/**
 * Zod schema for {@link DayOfWeek}.
 * Useful for rule configs that need to accept a day-of-week string.
 */
export const DayOfWeekSchema = z.union([
  z.literal("monday"),
  z.literal("tuesday"),
  z.literal("wednesday"),
  z.literal("thursday"),
  z.literal("friday"),
  z.literal("saturday"),
  z.literal("sunday"),
]);

/**
 * Time of day (24-hour format).
 *
 * @category Supporting Types
 */
export interface TimeOfDay {
  hours: number;
  minutes: number;
}

// ============================================================================
// Scheduling Period
// ============================================================================

/**
 * Defines a scheduling period as a date range with optional filters.
 *
 * The `dateRange` specifies the overall scheduling window. Use `dayOfWeek`
 * and/or `dates` to narrow which days within the range are included.
 * Filters compose: a day must pass all specified filters to be included.
 *
 * @example All days in a week
 * ```typescript
 * const period: SchedulingPeriod = {
 *   dateRange: { start: '2025-02-03', end: '2025-02-09' },
 * };
 * ```
 *
 * @example Only specific days of the week (closed Mon/Tue)
 * ```typescript
 * const period: SchedulingPeriod = {
 *   dateRange: { start: '2025-02-03', end: '2025-02-09' },
 *   dayOfWeek: ['wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
 * };
 * ```
 *
 * @example Only specific dates within the range
 * ```typescript
 * const period: SchedulingPeriod = {
 *   dateRange: { start: '2025-02-03', end: '2025-02-09' },
 *   dates: ['2025-02-05', '2025-02-07'],
 * };
 * ```
 *
 * @category Supporting Types
 */
export interface SchedulingPeriod {
  /**
   * The overall scheduling window (start and end are inclusive).
   * Dates should be in YYYY-MM-DD format.
   */
  dateRange: { start: string; end: string };
  /**
   * Include only these days of the week.
   * If omitted, all days of the week are included.
   */
  dayOfWeek?: readonly DayOfWeek[];
  /**
   * Include only these specific dates (YYYY-MM-DD) within the range.
   * If omitted, all dates in the range are included (subject to dayOfWeek filter).
   */
  dates?: string[];
}
