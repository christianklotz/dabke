import type { SchedulingDay } from "../../types.js";
import type { SchedulingMember, ShiftPattern } from "../types.js";

export function canAssignMemberToPattern(member: SchedulingMember, pattern: ShiftPattern): boolean {
  if (!pattern.roleIds || pattern.roleIds.length === 0) {
    return true;
  }
  return pattern.roleIds.some((role) => member.roleIds.includes(role));
}

export function isPatternAvailableOnDay(pattern: ShiftPattern, day: SchedulingDay): boolean {
  if (!pattern.dayOfWeek || pattern.dayOfWeek.length === 0) {
    return true;
  }
  return pattern.dayOfWeek.includes(day.dayOfWeek);
}

export function hasAnyAssignablePattern(
  member: SchedulingMember,
  day: SchedulingDay,
  shiftPatterns: readonly ShiftPattern[],
): boolean {
  return shiftPatterns.some(
    (pattern) => canAssignMemberToPattern(member, pattern) && isPatternAvailableOnDay(pattern, day),
  );
}
