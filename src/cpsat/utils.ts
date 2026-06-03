import { DAY_OF_WEEK_INDEX, type DayOfWeek, type SchedulingDay, type TimeOfDay } from "../types.js";
import type { Priority, SoftPriority } from "./types.js";

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
 * Maps {@link Priority} levels to penalty weights for preference rules.
 *
 * Used by `assignment-priority`, `location-preference`, and `role-preference`
 * to scale the strength of their soft constraints.
 */
export const PREFERENCE_WEIGHTS: Record<Priority, number> = {
  LOW: OBJECTIVE_WEIGHTS.FAIRNESS,
  MEDIUM: OBJECTIVE_WEIGHTS.ASSIGNMENT_PREFERENCE,
  HIGH: OBJECTIVE_WEIGHTS.ASSIGNMENT_PREFERENCE * 2.5,
  MANDATORY: OBJECTIVE_WEIGHTS.ASSIGNMENT_PREFERENCE * 5,
};

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

const TARGET_PEAK_PRIORITY_PENALTIES = {
  LOW: OBJECTIVE_WEIGHTS.COST,
  MEDIUM: OBJECTIVE_WEIGHTS.SHIFT_ACTIVE,
  HIGH: OBJECTIVE_WEIGHTS.SHIFT_ACTIVE * 2.5,
} as const satisfies Record<SoftPriority, number>;

export function targetPeakPriorityToPenalty(priority: SoftPriority): number {
  return TARGET_PEAK_PRIORITY_PENALTIES[priority];
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
  const first = sorted[0];
  if (!first) return 0;
  let total = 0;
  let currentEnd = first.start;
  for (const r of sorted) {
    const effectiveStart = Math.max(r.start, currentEnd);
    if (effectiveStart < r.end) {
      total += r.end - effectiveStart;
      currentEnd = r.end;
    }
  }
  return total;
}

/**
 * Splits scheduling days into non-overlapping chunks of N calendar months.
 *
 * Days are grouped by their {@link SchedulingDay.yearMonth}, then consecutive
 * months are merged into chunks of the requested size.
 */
export function splitIntoMonths(days: SchedulingDay[], monthsPerChunk: number): SchedulingDay[][] {
  if (days.length === 0) return [];

  const monthGroups = new Map<string, SchedulingDay[]>();
  for (const day of days) {
    let group = monthGroups.get(day.yearMonth);
    if (!group) {
      group = [];
      monthGroups.set(day.yearMonth, group);
    }
    group.push(day);
  }

  const sortedKeys = [...monthGroups.keys()].toSorted();
  const chunks: SchedulingDay[][] = [];

  for (let i = 0; i < sortedKeys.length; i += monthsPerChunk) {
    const chunkKeys = sortedKeys.slice(i, i + monthsPerChunk);
    const chunk = chunkKeys.flatMap((key) => monthGroups.get(key)!);
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
  }

  return chunks;
}

/**
 * Groups days into chunks of N weeks, aligned to weekStartsOn.
 *
 * Uses {@link splitIntoWeeks} internally, then merges consecutive weeks
 * into larger chunks.
 */
export function groupWeekChunks(
  days: SchedulingDay[],
  weeksPerChunk: number,
  weekStartsOn: DayOfWeek,
): SchedulingDay[][] {
  const weeks = splitIntoWeeks(days, weekStartsOn);
  const chunks: SchedulingDay[][] = [];

  for (let i = 0; i < weeks.length; i += weeksPerChunk) {
    const chunk = weeks.slice(i, i + weeksPerChunk).flat();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
  }

  return chunks;
}

export function splitIntoWeeks(days: SchedulingDay[], weekStartsOn: DayOfWeek): SchedulingDay[][] {
  if (days.length === 0) return [];

  const weekStartIndex = DAY_OF_WEEK_INDEX[weekStartsOn];
  const result: SchedulingDay[][] = [];
  let currentWeek: SchedulingDay[] = [];
  let currentWeekStartEpoch: number | null = null;

  for (const day of days) {
    const isWeekStartDay = DAY_OF_WEEK_INDEX[day.dayOfWeek] === weekStartIndex;
    const isNewWeek =
      isWeekStartDay && currentWeekStartEpoch !== null && day.epochDay !== currentWeekStartEpoch;

    if (isNewWeek) {
      result.push(currentWeek);
      currentWeek = [];
      currentWeekStartEpoch = null;
    }

    if (currentWeekStartEpoch === null) {
      currentWeekStartEpoch = day.epochDay;
    }
    currentWeek.push(day);
  }

  if (currentWeek.length > 0) {
    result.push(currentWeek);
  }

  return result;
}
