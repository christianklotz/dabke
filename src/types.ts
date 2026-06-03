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
// Date String
// ============================================================================

/**
 * A date string in ISO 8601 calendar date format (YYYY-MM-DD).
 *
 * Template literal type that rejects arbitrary strings at compile time.
 * Use this wherever a raw date string is expected in scheduling APIs.
 *
 * @category Supporting Types
 */
export type DateString = `${number}-${number}-${number}`;

const DATE_STRING_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Checks whether a string matches the {@link DateString} YYYY-MM-DD format.
 *
 * @remarks
 * This validates string shape only. It does not guarantee that the value is a
 * semantically valid calendar date.
 *
 * @param value - String to test
 *
 * @category Supporting Types
 */
export function isDateString(value: string): value is DateString {
  return DATE_STRING_RE.test(value);
}

// ============================================================================
// Scheduling Day
// ============================================================================

/**
 * A calendar day with pre-computed date components.
 *
 * Constructed once from a YYYY-MM-DD string via {@link schedulingDay}, then
 * passed by reference. Replaces raw `string` day representations throughout
 * the solver so downstream code never needs to parse dates.
 *
 * @category Supporting Types
 */
export interface SchedulingDay {
  /** The canonical YYYY-MM-DD string. */
  readonly iso: DateString;
  /** Day of week (monday, tuesday, ...). */
  readonly dayOfWeek: DayOfWeek;
  /** 1-indexed month (1 = January, 12 = December). */
  readonly month: number;
  /** 1-indexed day of the month. */
  readonly dayOfMonth: number;
  /** Year-month key for grouping ("YYYY-MM"). */
  readonly yearMonth: string;
  /** Integer days since Unix epoch (1970-01-01 = 0). Useful for date arithmetic. */
  readonly epochDay: number;
}

export const DAY_NAMES: readonly DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const DAY_OF_WEEK_INDEX: Record<DayOfWeek, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * Creates a {@link SchedulingDay} from a YYYY-MM-DD string.
 *
 * Parses the date once in UTC and pre-computes all fields so that no
 * downstream code ever needs to construct a `Date` object.
 *
 * @param iso - Date string in YYYY-MM-DD format
 *
 * @category Supporting Types
 */
export function schedulingDay(iso: DateString): SchedulingDay {
  const date = new Date(`${iso}T00:00:00Z`);
  const dayOfWeek = DAY_NAMES[date.getUTCDay()]!;
  const month = date.getUTCMonth() + 1;
  const dayOfMonth = date.getUTCDate();
  return {
    iso,
    dayOfWeek,
    month,
    dayOfMonth,
    yearMonth: iso.slice(0, 7),
    epochDay: Math.floor(date.getTime() / 86_400_000),
  };
}

/**
 * Maps {@link DayOfWeek} names to JavaScript `Date.getUTCDay()` indices
 * (0 = Sunday, 6 = Saturday).
 *
 * @category Supporting Types
 */
export { DAY_OF_WEEK_INDEX };

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
  dateRange: { start: DateString; end: DateString };
  /**
   * Include only these days of the week.
   * If omitted, all days of the week are included.
   */
  dayOfWeek?: readonly DayOfWeek[];
  /**
   * Include only these specific dates (YYYY-MM-DD) within the range.
   * If omitted, all dates in the range are included (subject to dayOfWeek filter).
   */
  dates?: DateString[];
}
