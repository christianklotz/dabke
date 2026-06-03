import type { SchedulingDay } from "../../types.js";
import type { SchedulingMember, ShiftPattern } from "../types.js";
import { normalizeEndMinutes, timeOfDayToMinutes, unionMinutes } from "../utils.js";
import { canAssignMemberToPattern, isPatternAvailableOnDay } from "./pattern-eligibility.js";

export function patternDurationMinutes(pattern: ShiftPattern): number {
  const start = timeOfDayToMinutes(pattern.startTime);
  const end = normalizeEndMinutes(start, timeOfDayToMinutes(pattern.endTime));
  return end - start;
}

export function maxAssignableMinutesForDay(
  member: SchedulingMember,
  day: SchedulingDay,
  shiftPatterns: readonly ShiftPattern[],
): number {
  const ranges = shiftPatterns
    .filter(
      (pattern) =>
        canAssignMemberToPattern(member, pattern) && isPatternAvailableOnDay(pattern, day),
    )
    .map((pattern) => {
      const start = timeOfDayToMinutes(pattern.startTime);
      return {
        start,
        end: normalizeEndMinutes(start, timeOfDayToMinutes(pattern.endTime)),
      };
    });
  return unionMinutes(ranges);
}
