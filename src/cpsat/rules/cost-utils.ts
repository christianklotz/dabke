import type { SchedulingMember, ShiftPattern } from "../types.js";
import { timeOfDayToMinutes, normalizeEndMinutes } from "../utils.js";

/** Returns the hourly rate for a member, or undefined if not hourly. */
export function getHourlyRate(member: SchedulingMember): number | undefined {
  if (!member.pay) return undefined;
  if ("hourlyRate" in member.pay) return member.pay.hourlyRate;
  return undefined;
}

/** Returns salaried pay info, or undefined if not salaried. */
export function getSalariedPay(
  member: SchedulingMember,
): { annual: number; hoursPerWeek: number } | undefined {
  if (!member.pay) return undefined;
  if ("annual" in member.pay) return member.pay;
  return undefined;
}

/** Computes shift duration in minutes from a pattern. */
export function patternDurationMinutes(pattern: ShiftPattern): number {
  const start = timeOfDayToMinutes(pattern.startTime);
  const end = normalizeEndMinutes(start, timeOfDayToMinutes(pattern.endTime));
  return end - start;
}
