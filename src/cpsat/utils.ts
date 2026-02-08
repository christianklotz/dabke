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
 * - ASSIGNMENT_PREFERENCE (10): Per-assignment preference (e.g., prefer permanent staff)
 * - FAIRNESS (5): Fair distribution of shifts across team members
 * - ASSIGNMENT_BASE (1): Tiebreaker - minimize total assignments
 *
 * @example Using weights in a custom rule
 * ```ts
 * import { OBJECTIVE_WEIGHTS } from "feasible";
 *
 * // Prefer senior staff with same weight as employee-assignment-priority
 * b.addPenalty(assignment, -OBJECTIVE_WEIGHTS.ASSIGNMENT_PREFERENCE);
 *
 * // Strong preference (2x normal)
 * b.addPenalty(assignment, -2 * OBJECTIVE_WEIGHTS.ASSIGNMENT_PREFERENCE);
 * ```
 */
export const OBJECTIVE_WEIGHTS = {
  /** Weight for minimizing active shift patterns (reduces fragmentation) */
  SHIFT_ACTIVE: 1000,
  /** Weight for per-assignment preferences (e.g., prefer/avoid certain team members) */
  ASSIGNMENT_PREFERENCE: 10,
  /** Weight for fair distribution objective (minimizes max shifts per employee) */
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

export function priorityToPenalty(priority: Priority): number {
  switch (priority) {
    case "HIGH":
      return 25;
    case "MEDIUM":
      return 10;
    case "LOW":
      return 1;
    case "MANDATORY":
      return 0;
    default:
      return 0;
  }
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
