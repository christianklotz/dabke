import { DAY_OF_WEEK_MAP } from "../datetime.utils.js";
import type { DayOfWeek, TimeOfDay } from "../types.js";
import type { Priority } from "./types.js";

export const MINUTES_PER_DAY = 24 * 60;

/**
 * Standard objective weights for the scheduling solver.
 *
 * These weights define the relative importance of different objectives.
 * Higher weights mean stronger preference. Rules can use these as reference
 * points when adding their own penalties.
 *
 * Weight hierarchy (highest to lowest priority):
 * - SHIFT_ACTIVE (1000): Minimize number of active shift patterns
 * - COST (100): Labor cost optimization (base pay + modifiers)
 * - ASSIGNMENT_PREFERENCE (10): Per-assignment preference (e.g., prefer permanent staff)
 * - FAIRNESS (5): Fair distribution of shifts across team members
 * - ASSIGNMENT_BASE (1): Tiebreaker - minimize total assignments
 *
 * @example Using weights in a custom rule
 * ```ts
 * import { OBJECTIVE_WEIGHTS } from "dabke";
 *
 * // Prefer senior staff with same weight as assignment-priority
 * b.addPenalty(assignment, -OBJECTIVE_WEIGHTS.ASSIGNMENT_PREFERENCE);
 *
 * // Strong preference (2x normal)
 * b.addPenalty(assignment, -2 * OBJECTIVE_WEIGHTS.ASSIGNMENT_PREFERENCE);
 * ```
 */
export const OBJECTIVE_WEIGHTS = {
  /** Weight for minimizing active shift patterns (reduces fragmentation) */
  SHIFT_ACTIVE: 1000,
  /** Weight for cost optimization (labor cost minimization) */
  COST: 100,
  /** Weight for per-assignment preferences (e.g., prefer/avoid certain team members) */
  ASSIGNMENT_PREFERENCE: 10,
  /** Weight for fair distribution objective (minimizes max shifts per member) */
  FAIRNESS: 5,
  /** Base weight per assignment (tiebreaker) */
  ASSIGNMENT_BASE: 1,
} as const;

/**
 * Parse a day string (YYYY-MM-DD) to a UTC Date.
 * Used internally for day-of-week calculations and date comparisons.
 */
export function parseDayString(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

export function timeOfDayToMinutes(time: TimeOfDay): number {
  return time.hours * 60 + (time.minutes ?? 0);
}

export function normalizeEndMinutes(startMinutes: number, endMinutes: number): number {
  if (endMinutes === startMinutes) return endMinutes + MINUTES_PER_DAY;
  return endMinutes < startMinutes ? endMinutes + MINUTES_PER_DAY : endMinutes;
}

const PRIORITY_PENALTIES = {
  LOW: 1,
  MEDIUM: 10,
  HIGH: 25,
  MANDATORY: 0,
} as const satisfies Record<Priority, number>;

export function priorityToPenalty(priority: Priority): number {
  return PRIORITY_PENALTIES[priority];
}

/**
 * Computes the total duration of the union of time ranges.
 *
 * Merges overlapping ranges and sums the merged durations.
 * Used to bound the maximum working minutes per day when
 * no-overlap constraints are enforced.
 */
export function unionMinutes(ranges: ReadonlyArray<{ start: number; end: number }>): number {
  if (ranges.length === 0) return 0;
  const sorted = ranges.toSorted((a, b) => a.start - b.start);
  let total = 0;
  let currentEnd = sorted[0]!.start;
  for (const r of sorted) {
    const effectiveStart = Math.max(r.start, currentEnd);
    if (effectiveStart < r.end) {
      total += r.end - effectiveStart;
      currentEnd = r.end;
    }
  }
  return total;
}

export function splitIntoWeeks(days: string[], weekStartsOn: DayOfWeek): string[][] {
  if (days.length === 0) return [];

  const weekStartIndex = DAY_OF_WEEK_MAP[weekStartsOn];
  const result: string[][] = [];
  let currentWeek: string[] = [];
  let currentWeekStart: Date | null = null;

  for (const day of days) {
    const date = parseDayString(day);
    const isWeekStartDay = date.getUTCDay() === weekStartIndex;
    const isNewWeek =
      isWeekStartDay && currentWeekStart !== null && date.getTime() !== currentWeekStart.getTime();

    if (isNewWeek) {
      result.push(currentWeek);
      currentWeek = [];
      currentWeekStart = null;
    }

    if (currentWeekStart === null) {
      currentWeekStart = date;
    }
    currentWeek.push(day);
  }

  if (currentWeek.length > 0) {
    result.push(currentWeek);
  }

  return result;
}
