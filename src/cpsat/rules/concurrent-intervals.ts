import type { SchedulingDay } from "../../types.js";
import type { SchedulingMember, ShiftPattern } from "../types.js";
import { MINUTES_PER_DAY, normalizeEndMinutes, timeOfDayToMinutes } from "../utils.js";
import { canAssignMemberToPattern, isPatternAvailableOnDay } from "./pattern-eligibility.js";
import { assignmentVar } from "./variables.js";

export interface ConcurrentAssignmentInterval {
  readonly start: number;
  readonly end: number;
  readonly varName: string;
}

export interface ConcurrentAssignmentSegment {
  readonly start: number;
  readonly end: number;
  readonly varNames: readonly string[];
}

export function collectConcurrentAssignmentIntervals(
  day: SchedulingDay,
  targetMembers: readonly SchedulingMember[],
  shiftPatterns: readonly ShiftPattern[],
): ConcurrentAssignmentInterval[] {
  const intervals: ConcurrentAssignmentInterval[] = [];

  for (const pattern of shiftPatterns) {
    if (!isPatternAvailableOnDay(pattern, day)) continue;

    const start = timeOfDayToMinutes(pattern.startTime);
    const end = normalizeEndMinutes(start, timeOfDayToMinutes(pattern.endTime));

    for (const member of targetMembers) {
      if (!canAssignMemberToPattern(member, pattern)) continue;
      intervals.push({
        start,
        end,
        varName: assignmentVar(member.id, pattern.id, day.iso),
      });
    }
  }

  return intervals;
}

export function resolveConcurrentWindow(
  intervals: readonly ConcurrentAssignmentInterval[],
  startMinutes?: number,
  endMinutes?: number,
): { start: number; end: number } {
  const start = startMinutes ?? 0;
  if (endMinutes !== undefined) {
    return { start, end: endMinutes };
  }

  const latestEnd = intervals.reduce((maxEnd, interval) => Math.max(maxEnd, interval.end), 0);
  return { start, end: Math.max(MINUTES_PER_DAY, latestEnd) };
}

export function buildConcurrentAssignmentSegments(
  intervals: readonly ConcurrentAssignmentInterval[],
  windowStart: number,
  windowEnd: number,
): ConcurrentAssignmentSegment[] {
  const boundaries = new Set<number>([windowStart, windowEnd]);

  for (const interval of intervals) {
    const start = Math.max(interval.start, windowStart);
    const end = Math.min(interval.end, windowEnd);
    if (start >= end) continue;

    boundaries.add(start);
    boundaries.add(end);
  }

  const sortedBoundaries = [...boundaries].toSorted((left, right) => left - right);
  const segments: ConcurrentAssignmentSegment[] = [];

  for (let index = 0; index < sortedBoundaries.length - 1; index++) {
    const start = sortedBoundaries[index];
    const end = sortedBoundaries[index + 1];
    if (start === undefined || end === undefined || start >= end) continue;

    const varNames = intervals
      .filter((interval) => interval.start < end && interval.end > start)
      .map((interval) => interval.varName);

    if (varNames.length === 0) continue;

    segments.push({ start, end, varNames });
  }

  return segments;
}
