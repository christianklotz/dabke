import { CalendarDate, DateTime, DateTimeRange, DayOfWeek, SchedulingPeriod } from "./types.js";

/**
 * Converts a JavaScript Date to a CalendarDate
 */
export function dateToCalendarDate(date: Date): CalendarDate {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1, // JS months are 0-indexed
    day: date.getDate(),
  };
}

/**
 * Converts a DateTime to a JavaScript Date
 * Internal helper function
 */
export function dateTimeToDate(dateTime: DateTime): Date {
  return new Date(
    dateTime.year || 0,
    (dateTime.month || 1) - 1,
    dateTime.day || 1,
    dateTime.hours || 0,
    dateTime.minutes || 0,
    dateTime.seconds || 0,
  );
}

/**
 * Compares two DateTimes
 * Returns:
 *  -1 if dateTime1 < dateTime2
 *   0 if dateTime1 = dateTime2
 *   1 if dateTime1 > dateTime2
 */
export function compareDateTimes(dateTime1: DateTime, dateTime2: DateTime): number {
  const date1 = dateTimeToDate(dateTime1);
  const date2 = dateTimeToDate(dateTime2);

  if (date1 < date2) return -1;
  if (date1 > date2) return 1;
  return 0;
}

export const DAY_OF_WEEK_MAP = {
  sunday: 0, // JavaScript Date week starts on Sunday
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/**
 * Helper to get the day of week name from a Date (local time)
 */
export function toDayOfWeek(date: Date): DayOfWeek {
  // getDay() always returns 0-6
  return DAY_NAMES[date.getDay()] as DayOfWeek;
}

/**
 * Helper to get the day of week name from a Date (UTC)
 * Use this when working with date strings like "2026-01-10" that are timezone-agnostic.
 */
export function toDayOfWeekUTC(date: Date): DayOfWeek {
  // getUTCDay() always returns 0-6
  return DAY_NAMES[date.getUTCDay()] as DayOfWeek;
}

/**
 * Formats a date as YYYY-MM-DD string
 */
export function formatDateString(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Generates an array of day strings (YYYY-MM-DD) from a time horizon.
 *
 * @param horizon - The time horizon with start (inclusive) and end (inclusive) dates
 * @returns Array of day strings in YYYY-MM-DD format
 *
 * @example
 * ```typescript
 * const days = generateDays({
 *   start: new Date('2025-01-01'),
 *   end: new Date('2025-01-04')
 * });
 * // Returns: ["2025-01-01", "2025-01-02", "2025-01-03", "2025-01-04"]
 * ```
 */
export function generateDays(horizon: { start: Date; end: Date }): string[] {
  const days: string[] = [];
  const current = new Date(horizon.start);

  while (current <= horizon.end) {
    days.push(formatDateString(current));
    current.setDate(current.getDate() + 1);
  }

  return days;
}

/**
 * Splits a time period into consecutive day ranges.
 *
 * Each range represents a single calendar day within the period from start to end.
 * This is useful for rules that need to apply constraints on a per-day basis,
 * such as maximum or minimum hours per day.
 *
 * @param start - The start date of the period (inclusive)
 * @param end - The end date of the period (exclusive)
 * @returns An array of [startDate, endDate] tuples, where each tuple represents
 *          a single day. The last range's end date will be the provided end date.
 *
 * @example
 * ```typescript
 * const ranges = splitPeriodIntoDays({
 *   start: new Date('2025-01-01'),
 *   end: new Date('2025-01-03')
 * });
 * // Returns:
 * // [
 * //   [Date('2025-01-01'), Date('2025-01-02')],
 * //   [Date('2025-01-02'), Date('2025-01-03')]
 * // ]
 * ```
 */
export function splitPeriodIntoDays({ start, end }: { start: Date; end: Date }): [Date, Date][] {
  const ranges: [Date, Date][] = [];

  let leftBound = new Date(start);
  let done = false;

  // Loop through each day
  leftBound = new Date(start);
  while (!done) {
    // Create next day date
    let rightBound = new Date(leftBound);
    rightBound.setDate(rightBound.getDate() + 1);

    if (rightBound >= end) {
      rightBound = end;
      done = true;
    }

    ranges.push([leftBound, rightBound]);
    leftBound = rightBound;
  }
  return ranges;
}

/**
 * Splits a time period into consecutive week ranges.
 *
 * Each range represents a week period starting on the specified day of the week.
 * This is useful for rules that need to apply constraints on a per-week basis,
 * such as maximum or minimum hours per week.
 *
 * The first range starts at the provided start date (not necessarily on weekStartsOn).
 * Subsequent ranges align to the weekStartsOn day. The last range's end date will be
 * the provided end date.
 *
 * @param start - The start date of the period (inclusive)
 * @param end - The end date of the period (exclusive)
 * @param weekStartsOn - The day of the week that weeks start on (e.g., "monday", "sunday")
 * @returns An array of [startDate, endDate] tuples, where each tuple represents
 *          a week period aligned to the specified week start day.
 *
 * @example
 * ```typescript
 * const ranges = splitPeriodIntoWeeks({
 *   start: new Date('2025-01-01'), // Wednesday
 *   end: new Date('2025-01-15'),
 *   weekStartsOn: 'monday'
 * });
 * // Returns ranges starting from Jan 1 (Wed), then aligning to Mondays:
 * // [
 * //   [Date('2025-01-01 Wed'), Date('2025-01-06 Mon')],
 * //   [Date('2025-01-06 Mon'), Date('2025-01-13 Mon')],
 * //   [Date('2025-01-13 Mon'), Date('2025-01-15 Wed')]
 * // ]
 * ```
 */
export function splitPeriodIntoWeeks({
  start,
  end,
  weekStartsOn,
}: {
  start: Date;
  end: Date;
  weekStartsOn: DayOfWeek;
}): [Date, Date][] {
  const DAYS_OF_WEEK: DayOfWeek[] = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  const ranges: [Date, Date][] = [];

  let leftBound = new Date(start);
  let done = false;

  const startDayIndex = DAYS_OF_WEEK.indexOf(weekStartsOn);

  // Create weekly ranges
  while (!done) {
    const dayOfWeek = leftBound.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const daysToNextWeek = (7 - ((dayOfWeek - startDayIndex) % 7)) % 7;
    const daysToAdd = daysToNextWeek === 0 ? 7 : daysToNextWeek;

    let rightBound = new Date(leftBound);
    rightBound.setDate(rightBound.getDate() + daysToAdd);

    if (rightBound >= end) {
      rightBound = end;
      done = true;
    }

    ranges.push([leftBound, rightBound]);
    leftBound = rightBound;
  }
  return ranges;
}

/**
 * Checks if two DateTime ranges overlap in both date and time.
 * Ranges overlap if they share any moment in time.
 *
 * Two ranges overlap if: range1.start < range2.end AND range2.start < range1.end
 *
 * @param range1 First time range with start (inclusive) and end (exclusive)
 * @param range2 Second time range with start (inclusive) and end (exclusive)
 * @returns true if ranges overlap, false otherwise
 *
 * @example
 * ```typescript
 * // Same day, overlapping times (9-17 overlaps with 12-20)
 * dateTimeRangesOverlap(
 *   {
 *     start: { year: 2025, month: 6, day: 1, hours: 9, minutes: 0 },
 *     end: { year: 2025, month: 6, day: 1, hours: 17, minutes: 0 }
 *   },
 *   {
 *     start: { year: 2025, month: 6, day: 1, hours: 12, minutes: 0 },
 *     end: { year: 2025, month: 6, day: 1, hours: 20, minutes: 0 }
 *   }
 * ); // true
 *
 * // Different days - no overlap
 * dateTimeRangesOverlap(
 *   {
 *     start: { year: 2025, month: 6, day: 1, hours: 9, minutes: 0 },
 *     end: { year: 2025, month: 6, day: 1, hours: 17, minutes: 0 }
 *   },
 *   {
 *     start: { year: 2025, month: 6, day: 2, hours: 9, minutes: 0 },
 *     end: { year: 2025, month: 6, day: 2, hours: 17, minutes: 0 }
 *   }
 * ); // false
 *
 * // Works naturally with Shift objects
 * dateTimeRangesOverlap(
 *   { start: shift1.startDateTime, end: shift1.endDateTime },
 *   { start: shift2.startDateTime, end: shift2.endDateTime }
 * );
 * ```
 */
export function dateTimeRangesOverlap(range1: DateTimeRange, range2: DateTimeRange): boolean {
  // Use existing compareDateTimes for temporal comparison
  // Ranges overlap if: start1 < end2 AND start2 < end1
  return (
    compareDateTimes(range1.start, range2.end) < 0 && compareDateTimes(range2.start, range1.end) < 0
  );
}

/**
 * Calculates the number of complete days between two dates
 * @param start The start date
 * @param end The end date
 * @returns Number of complete days from start to end (can be negative if end < start)
 *
 * @example
 * ```typescript
 * daysBetween(new Date('2025-01-01'), new Date('2025-01-05')); // 4
 * ```
 */
export function daysBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

/**
 * Adds a number of minutes to a base date and returns a DateTime.
 * Treats the base date as a reference point (typically midnight of horizon start),
 * and the minutes parameter as absolute minutes from that point.
 *
 * @param baseDate The starting date (used as reference point)
 * @param minutes Absolute minutes from the base date
 * @returns DateTime representing the result
 *
 * @example
 * ```typescript
 * // Add 90 minutes from midnight
 * addMinutesToDate(new Date('2025-01-01'), 90);
 * // Returns: { year: 2025, month: 1, day: 1, hours: 1, minutes: 30 }
 *
 * // Add 1500 minutes (spans to next day)
 * addMinutesToDate(new Date('2025-01-01'), 1500);
 * // Returns: { year: 2025, month: 1, day: 2, hours: 1, minutes: 0 }
 * ```
 */
export function addMinutesToDate(baseDate: Date, minutes: number): DateTime {
  const days = Math.floor(minutes / 1440);
  const minutesInDay = minutes % 1440;

  const targetDate = new Date(baseDate);
  targetDate.setDate(targetDate.getDate() + days);

  return {
    year: targetDate.getFullYear(),
    month: targetDate.getMonth() + 1,
    day: targetDate.getDate(),
    hours: Math.floor(minutesInDay / 60),
    minutes: minutesInDay % 60,
  };
}

/**
 * Returns the points where a range should be split, filtered to within [start, end).
 * Always includes range start. Sorted ascending.
 */
export function splitPoints([start, end]: [number, number], splitAt: number[]): number[] {
  const points = new Set<number>([start]);

  for (const p of splitAt) {
    if (p > start && p < end) points.add(p);
  }

  return [...points].toSorted((a, b) => a - b);
}

/**
 * Computes the list of day strings (YYYY-MM-DD) from a SchedulingPeriod.
 *
 * For date ranges, generates all days between start and end (inclusive),
 * optionally filtering to specific days of the week.
 *
 * For specific dates, returns the dates as-is (sorted).
 *
 * @param period - The scheduling period specification
 * @returns Array of day strings in YYYY-MM-DD format, sorted chronologically
 *
 * @example Date range with day-of-week filter
 * ```typescript
 * const days = resolveDaysFromPeriod({
 *   dateRange: { start: '2025-02-03', end: '2025-02-09' },
 *   daysOfWeek: ['wednesday', 'friday'],
 * });
 * // Returns: ['2025-02-05', '2025-02-07'] (Wed and Fri only)
 * ```
 *
 * @example Date range without filter
 * ```typescript
 * const days = resolveDaysFromPeriod({
 *   dateRange: { start: '2025-02-03', end: '2025-02-05' },
 * });
 * // Returns: ['2025-02-03', '2025-02-04', '2025-02-05']
 * ```
 *
 * @example Specific dates
 * ```typescript
 * const days = resolveDaysFromPeriod({
 *   specificDates: ['2025-02-07', '2025-02-03', '2025-02-10'],
 * });
 * // Returns: ['2025-02-03', '2025-02-07', '2025-02-10'] (sorted)
 * ```
 */
export function resolveDaysFromPeriod(period: SchedulingPeriod): string[] {
  if ("specificDates" in period && period.specificDates) {
    return [...period.specificDates].toSorted();
  }

  const { dateRange, daysOfWeek } = period;
  const startDate = new Date(`${dateRange.start}T00:00:00Z`);
  const endDate = new Date(`${dateRange.end}T00:00:00Z`);

  const allowedDays = daysOfWeek ? new Set(daysOfWeek) : null;
  const days: string[] = [];

  const current = new Date(startDate);
  while (current <= endDate) {
    const dayOfWeek = toDayOfWeekUTC(current);

    if (!allowedDays || allowedDays.has(dayOfWeek)) {
      const year = current.getUTCFullYear();
      const month = (current.getUTCMonth() + 1).toString().padStart(2, "0");
      const day = current.getUTCDate().toString().padStart(2, "0");
      days.push(`${year}-${month}-${day}`);
    }

    current.setUTCDate(current.getUTCDate() + 1);
  }

  return days;
}
