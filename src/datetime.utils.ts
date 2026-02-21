import type { DayOfWeek, SchedulingPeriod } from "./types.js";

export const DAY_OF_WEEK_MAP: Record<DayOfWeek, number> = {
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
 * Helper to get the day of week name from a Date (UTC).
 * Use this when working with date strings like "2026-01-10" that are timezone-agnostic.
 */
export function toDayOfWeekUTC(date: Date): DayOfWeek {
  // getUTCDay() always returns 0-6
  return DAY_NAMES[date.getUTCDay()] as DayOfWeek;
}

/**
 * Computes the list of day strings (YYYY-MM-DD) from a SchedulingPeriod.
 *
 * Generates all days between start and end (inclusive), applying optional
 * dayOfWeek and dates filters. Filters compose: a day must pass all
 * specified filters to be included.
 *
 * @param period - The scheduling period specification
 * @returns Array of day strings in YYYY-MM-DD format, sorted chronologically
 *
 * @example All days in range
 * ```typescript
 * const days = resolveDaysFromPeriod({
 *   dateRange: { start: '2025-02-03', end: '2025-02-05' },
 * });
 * // Returns: ['2025-02-03', '2025-02-04', '2025-02-05']
 * ```
 *
 * @example Day-of-week filter
 * ```typescript
 * const days = resolveDaysFromPeriod({
 *   dateRange: { start: '2025-02-03', end: '2025-02-09' },
 *   dayOfWeek: ['wednesday', 'friday'],
 * });
 * // Returns: ['2025-02-05', '2025-02-07']
 * ```
 *
 * @example Specific dates filter
 * ```typescript
 * const days = resolveDaysFromPeriod({
 *   dateRange: { start: '2025-02-03', end: '2025-02-10' },
 *   dates: ['2025-02-05', '2025-02-07'],
 * });
 * // Returns: ['2025-02-05', '2025-02-07']
 * ```
 */
export function resolveDaysFromPeriod(period: SchedulingPeriod): string[] {
  const { dateRange, dayOfWeek, dates } = period;
  const allowedDays = dayOfWeek ? new Set(dayOfWeek) : null;
  const allowedDates = dates ? new Set(dates) : null;

  const startDate = new Date(`${dateRange.start}T00:00:00Z`);
  const endDate = new Date(`${dateRange.end}T00:00:00Z`);
  const result: string[] = [];

  const current = new Date(startDate);
  while (current <= endDate) {
    const year = current.getUTCFullYear();
    const month = (current.getUTCMonth() + 1).toString().padStart(2, "0");
    const day = current.getUTCDate().toString().padStart(2, "0");
    const iso = `${year}-${month}-${day}`;
    const dow = toDayOfWeekUTC(current);

    if ((!allowedDays || allowedDays.has(dow)) && (!allowedDates || allowedDates.has(iso))) {
      result.push(iso);
    }

    current.setUTCDate(current.getUTCDate() + 1);
  }

  return result;
}
