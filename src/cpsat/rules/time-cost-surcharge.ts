import * as z from "zod";
import type { CompilationRule, CostContribution } from "../model-builder.js";
import type { ShiftPattern, SchedulingMember } from "../types.js";
import type { TimeOfDay } from "../../types.js";
import type { ShiftAssignment } from "../response.js";
import { COST_CATEGORY } from "../cost.js";
import { timeOfDayToMinutes, normalizeEndMinutes, MINUTES_PER_DAY } from "../utils.js";
import {
  entityScope,
  timeScope,
  parseEntityScope,
  parseTimeScope,
  resolveMembersFromScope,
  resolveActiveDaysFromScope,
} from "./scope.types.js";

const TimeOfDaySchema = z.object({
  hours: z.number().int().min(0).max(23),
  minutes: z.number().int().min(0).max(59),
});

const TimeCostSurchargeSchema = z
  .object({
    amountPerHour: z.number().min(0),
    window: z.object({
      from: TimeOfDaySchema,
      until: TimeOfDaySchema,
    }),
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/** Configuration for {@link createTimeCostSurchargeRule}. */
export type TimeCostSurchargeConfig = z.infer<typeof TimeCostSurchargeSchema>;

/**
 * Computes the overlap in minutes between a shift and a time-of-day window.
 *
 * Handles overnight windows (e.g., 22:00-06:00) and overnight shifts.
 */
function computeOverlapMinutes(
  shiftStart: TimeOfDay,
  shiftEnd: TimeOfDay,
  windowFrom: TimeOfDay,
  windowUntil: TimeOfDay,
): number {
  const sStart = timeOfDayToMinutes(shiftStart);
  const sEnd = normalizeEndMinutes(sStart, timeOfDayToMinutes(shiftEnd));
  const wFrom = timeOfDayToMinutes(windowFrom);
  const wUntil = timeOfDayToMinutes(windowUntil);

  // Expand window: if overnight (e.g., 22:00-06:00), wUntil < wFrom
  // Represent as two intervals or one extended interval
  let totalOverlap = 0;

  if (wFrom < wUntil) {
    // Normal window (e.g., 14:00-18:00)
    totalOverlap = rangeOverlap(sStart, sEnd, wFrom, wUntil);
  } else {
    // Overnight window (e.g., 22:00-06:00)
    // Split into [wFrom, MINUTES_PER_DAY) and [0, wUntil)
    // But shift may also span overnight, so use extended ranges
    totalOverlap += rangeOverlap(sStart, sEnd, wFrom, MINUTES_PER_DAY);
    totalOverlap += rangeOverlap(sStart, sEnd, MINUTES_PER_DAY, MINUTES_PER_DAY + wUntil);
    // Also check if shift overlaps [0, wUntil) in the same day
    totalOverlap += rangeOverlap(sStart, sEnd, 0, wUntil);
  }

  return totalOverlap;
}

function rangeOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return Math.max(0, end - start);
}

/**
 * Creates a time-of-day surcharge rule (e.g., night differential).
 *
 * Adds a flat surcharge per hour for the portion of a shift that overlaps
 * a time-of-day window. Independent of the member's base rate.
 *
 * When `minimizeCost()` is not present, no solver terms are emitted,
 * but the `cost()` method still contributes to post-solve calculation.
 */
export function createTimeCostSurchargeRule(config: TimeCostSurchargeConfig): CompilationRule {
  const parsed = TimeCostSurchargeSchema.parse(config);
  const { amountPerHour, window } = parsed;
  const entityScopeValue = parseEntityScope(parsed);
  const timeScopeValue = parseTimeScope(parsed);

  return {
    compile(b) {
      if (!b.costContext?.active) return;
      if (amountPerHour <= 0) return;

      const targetMembers = resolveMembersFromScope(entityScopeValue, b.members);
      const activeDays = resolveActiveDaysFromScope(timeScopeValue, b.days);

      if (targetMembers.length === 0 || activeDays.length === 0) return;

      const { normalizationFactor } = b.costContext;

      for (const emp of targetMembers) {
        for (const pattern of b.shiftPatterns) {
          if (!b.canAssign(emp, pattern)) continue;

          const overlapMinutes = computeOverlapMinutes(
            pattern.startTime,
            pattern.endTime,
            window.from,
            window.until,
          );
          if (overlapMinutes <= 0) continue;

          const surcharge = (amountPerHour * overlapMinutes) / 60;
          const normalizedPenalty = surcharge / normalizationFactor;

          for (const day of activeDays) {
            if (!b.patternAvailableOnDay(pattern, day)) continue;
            b.addPenalty(b.assignment(emp.id, pattern.id, day), Math.max(1, normalizedPenalty));
          }
        }
      }
    },

    cost(
      assignments: ShiftAssignment[],
      members: ReadonlyArray<SchedulingMember>,
      shiftPatterns: ReadonlyArray<ShiftPattern>,
    ): CostContribution {
      if (amountPerHour <= 0) return { entries: [] };

      const patternMap = new Map(shiftPatterns.map((p) => [p.id, p]));
      const allDays = [...new Set(assignments.map((a) => a.day))].toSorted();
      const activeDays = new Set(resolveActiveDaysFromScope(timeScopeValue, allDays));
      const targetEmpIds = new Set(
        resolveMembersFromScope(entityScopeValue, [...members]).map((e) => e.id),
      );

      const entries: CostContribution["entries"] = [];

      for (const a of assignments) {
        if (!activeDays.has(a.day)) continue;
        if (!targetEmpIds.has(a.memberId)) continue;
        const pattern = patternMap.get(a.shiftPatternId);
        if (!pattern) continue;

        const overlapMinutes = computeOverlapMinutes(
          pattern.startTime,
          pattern.endTime,
          window.from,
          window.until,
        );
        if (overlapMinutes <= 0) continue;

        const amount = (amountPerHour * overlapMinutes) / 60;
        entries.push({
          memberId: a.memberId,
          day: a.day,
          category: COST_CATEGORY.PREMIUM,
          amount,
        });
      }

      return { entries };
    },
  };
}
