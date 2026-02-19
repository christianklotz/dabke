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
 * Time of day representation (hours and minutes, with optional seconds/nanos).
 *
 * Used for defining shift start/end times and semantic time boundaries.
 * Hours are in 24-hour format (0-23).
 *
 * @example
 * ```typescript
 * const morningStart: TimeOfDay = {
 *   hours: 9,
 *   minutes: 0
 * };
 *
 * const afternoonEnd: TimeOfDay = {
 *   hours: 17,
 *   minutes: 30
 * };
 * ```
 */
export interface TimeOfDay {
  hours: number;
  minutes: number;
  seconds?: number;
  nanos?: number;
}

/**
 * Calendar date representation (year, month, day).
 *
 * @example
 * ```typescript
 * const christmas: CalendarDate = {
 *   year: 2025,
 *   month: 12,
 *   day: 25
 * };
 * ```
 */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/**
 * Time horizon defining the start and end dates for scheduling.
 *
 * Specifies the date range over which the schedule should be generated.
 * The range is inclusive of start date and exclusive of end date.
 *
 * @example
 * ```typescript
 * // One week schedule starting Monday, March 3, 2025
 * const horizon: TimeHorizon = {
 *   start: new Date('2025-03-03'),  // Monday
 *   end: new Date('2025-03-10')     // Following Monday (exclusive)
 * };
 * ```
 */
export interface TimeHorizon {
  start: Date;
  end: Date;
}

// ============================================================================
// DateTime Types
// ============================================================================

export interface DateTimeComponents extends Partial<CalendarDate>, Partial<TimeOfDay> {}

interface DateTimeWithUtcOffset extends DateTimeComponents {
  utcOffset?: string;
  timeZone?: never;
}

interface DateTimeWithTimeZone extends DateTimeComponents {
  timeZone?: {
    id: string;
    version: string;
  };
  utcOffset?: never;
}

/**
 * Date and time representation supporting both UTC offset and timezone-aware formats.
 *
 * Can be specified either with a UTC offset (e.g., "-08:00") or with a timezone ID
 * (e.g., "America/Los_Angeles").
 */
export type DateTime = DateTimeWithUtcOffset | DateTimeWithTimeZone;

/**
 * Represents a time range with start and end DateTimes.
 * Used for checking overlaps and scheduling constraints.
 */
export interface DateTimeRange {
  start: DateTime;
  end: DateTime;
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
 * @example Only specific days of the week (restaurant closed Mon/Tue)
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
  dayOfWeek?: DayOfWeek[];
  /**
   * Include only these specific dates (YYYY-MM-DD) within the range.
   * If omitted, all dates in the range are included (subject to dayOfWeek filter).
   */
  dates?: string[];
}
