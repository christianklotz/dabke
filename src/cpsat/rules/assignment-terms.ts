import type { SchedulingDay } from "../../types.js";
import type { SchedulingMember, ShiftPattern, Term } from "../types.js";
import { canAssignMemberToPattern, isPatternAvailableOnDay } from "./pattern-eligibility.js";
import { assignmentVar } from "./variables.js";

export function assignmentVarsForDay(
  member: SchedulingMember,
  day: SchedulingDay,
  shiftPatterns: readonly ShiftPattern[],
): string[] {
  return shiftPatterns
    .filter(
      (pattern) =>
        canAssignMemberToPattern(member, pattern) && isPatternAvailableOnDay(pattern, day),
    )
    .map((pattern) => assignmentVar(member.id, pattern.id, day.iso));
}

export function assignmentTermsForDay(
  member: SchedulingMember,
  day: SchedulingDay,
  shiftPatterns: readonly ShiftPattern[],
  coeffForPattern: (pattern: ShiftPattern) => number,
): Term[] {
  return shiftPatterns
    .filter(
      (pattern) =>
        canAssignMemberToPattern(member, pattern) && isPatternAvailableOnDay(pattern, day),
    )
    .map((pattern) => ({
      var: assignmentVar(member.id, pattern.id, day.iso),
      coeff: coeffForPattern(pattern),
    }));
}

export function assignmentTermsForDays(
  member: SchedulingMember,
  days: readonly SchedulingDay[],
  shiftPatterns: readonly ShiftPattern[],
  coeffForPattern: (pattern: ShiftPattern) => number,
): Term[] {
  return days.flatMap((day) => assignmentTermsForDay(member, day, shiftPatterns, coeffForPattern));
}
