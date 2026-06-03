import {
  DAY_NAMES,
  type DateString,
  type DayOfWeek,
  type SchedulingDay,
  type SchedulingPeriod,
} from "./types.js";

/**
 * Builds a {@link SchedulingDay} from an existing UTC `Date`, avoiding a
 * redundant `new Date()` call. Used internally by {@link resolveDaysFromPeriod}
 * where the loop already maintains a `Date` cursor.
 */
function schedulingDayFromDate(date: Date, iso: DateString): SchedulingDay {
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
 * Computes the list of {@link SchedulingDay} values from a {@link SchedulingPeriod}.
 *
 * Generates all days between start and end (inclusive), applying optional
 * dayOfWeek and dates filters. Filters compose: a day must pass all
 * specified filters to be included.
 *
 * @param period - The scheduling period specification
 * @returns Array of scheduling days, sorted chronologically
 *
 * @example All days in range
 * ```typescript
 * const days = resolveDaysFromPeriod({
 *   dateRange: { start: '2025-02-03', end: '2025-02-05' },
 * });
 * // Returns days for 2025-02-03, 2025-02-04, 2025-02-05
 * ```
 *
 * @example Day-of-week filter
 * ```typescript
 * const days = resolveDaysFromPeriod({
 *   dateRange: { start: '2025-02-03', end: '2025-02-09' },
 *   dayOfWeek: ['wednesday', 'friday'],
 * });
 * // Returns days for 2025-02-05, 2025-02-07
 * ```
 *
 * @example Specific dates filter
 * ```typescript
 * const days = resolveDaysFromPeriod({
 *   dateRange: { start: '2025-02-03', end: '2025-02-10' },
 *   dates: ['2025-02-05', '2025-02-07'],
 * });
 * // Returns days for 2025-02-05, 2025-02-07
 * ```
 */
export function resolveDaysFromPeriod(period: SchedulingPeriod): SchedulingDay[] {
  const { dateRange, dayOfWeek, dates } = period;
  const allowedDays: Set<DayOfWeek> | null = dayOfWeek ? new Set(dayOfWeek) : null;
  const allowedDates: Set<string> | null = dates ? new Set(dates) : null;

  const startDate = new Date(`${dateRange.start}T00:00:00Z`);
  const endDate = new Date(`${dateRange.end}T00:00:00Z`);
  const result: SchedulingDay[] = [];

  for (
    let currentTime = startDate.getTime(), endTime = endDate.getTime();
    currentTime <= endTime;
    currentTime += 24 * 60 * 60 * 1000
  ) {
    const current = new Date(currentTime);
    const year = current.getUTCFullYear();
    const month = (current.getUTCMonth() + 1).toString().padStart(2, "0");
    const d = current.getUTCDate().toString().padStart(2, "0");
    const iso = `${year}-${month}-${d}` as DateString;
    const day = schedulingDayFromDate(current, iso);

    if (
      (!allowedDays || allowedDays.has(day.dayOfWeek)) &&
      (!allowedDates || allowedDates.has(iso))
    ) {
      result.push(day);
    }
  }

  return result;
}
