import * as z from "zod";
import type { TimeOfDay } from "../../types.js";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import type { CostArtifact } from "../rule-descriptor.js";
import { COST_CATEGORY } from "../cost.js";
import { MINUTES_PER_DAY, normalizeEndMinutes, timeOfDayToMinutes } from "../utils.js";
import {
  entityScope,
  parseEntityScope,
  parseTimeScope,
  resolveActiveDaysFromScope,
  resolveMembersFromScope,
  timeScope,
} from "./scope.types.js";

const TimeOfDaySchema = z.object({
  hours: z.number().int().min(0).max(23),
  minutes: z.number().int().min(0).max(59),
});

export const TimeCostSurchargeSchema = z
  .object({
    amountPerHour: z.number().min(0),
    window: z.object({
      from: TimeOfDaySchema,
      until: TimeOfDaySchema,
    }),
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/** Configuration for {@link timeCostSurchargeRuleDescriptor}. */
export type TimeCostSurchargeConfig = z.infer<typeof TimeCostSurchargeSchema>;

export const timeCostSurchargeRuleDescriptor = defineRuleDescriptor({
  name: "time-cost-surcharge",
  schema: TimeCostSurchargeSchema,
  compile(config) {
    const { amountPerHour, window } = config;
    const entityScopeValue = parseEntityScope(config);
    const timeScopeValue = parseTimeScope(config);

    const validation = {
      strategy: "skip" as const,
      category: "no-meaningful-feedback" as const,
      rationale:
        amountPerHour <= 0
          ? "A zero time surcharge does not change optimization or cost accounting."
          : "Time cost surcharges only affect optimization when minimize-cost is active.",
    };

    const costArtifact: CostArtifact = {
      kind: "cost",
      validation,
      compileObjective(builder) {
        if (!builder.costContext?.active || amountPerHour <= 0) return;

        const targetMembers = resolveMembersFromScope(entityScopeValue, builder.members);
        const activeDays = resolveActiveDaysFromScope(timeScopeValue, builder.days);
        if (targetMembers.length === 0 || activeDays.length === 0) return;

        const { normalizationFactor } = builder.costContext;
        for (const member of targetMembers) {
          for (const pattern of builder.shiftPatterns) {
            if (!builder.canAssign(member, pattern)) continue;
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
              if (!builder.patternAvailableOnDay(pattern, day)) continue;
              builder.addPenalty(
                builder.assignment(member.id, pattern.id, day),
                Math.max(1, normalizedPenalty),
              );
            }
          }
        }
      },
      calculateCost(assignments, costContext) {
        if (amountPerHour <= 0) return { entries: [] };

        const patternMap = new Map(
          costContext.shiftPatterns.map((pattern) => [pattern.id, pattern]),
        );
        const activeDays = new Set(
          resolveActiveDaysFromScope(timeScopeValue, [...costContext.days]).map((day) => day.iso),
        );
        const targetMemberIds = new Set(
          resolveMembersFromScope(entityScopeValue, [...costContext.members]).map(
            (member) => member.id,
          ),
        );

        const entries = [] as Array<{
          memberId: string;
          day: string;
          category: string;
          amount: number;
        }>;
        for (const assignment of assignments) {
          if (!activeDays.has(assignment.day) || !targetMemberIds.has(assignment.memberId))
            continue;
          const pattern = patternMap.get(assignment.shiftPatternId);
          if (!pattern) continue;
          const overlapMinutes = computeOverlapMinutes(
            pattern.startTime,
            pattern.endTime,
            window.from,
            window.until,
          );
          if (overlapMinutes <= 0) continue;
          entries.push({
            memberId: assignment.memberId,
            day: assignment.day,
            category: COST_CATEGORY.PREMIUM,
            amount: (amountPerHour * overlapMinutes) / 60,
          });
        }

        return { entries };
      },
    };

    return {
      rule: "time-cost-surcharge",
      artifacts: [costArtifact],
    };
  },
});

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

  if (wFrom < wUntil) {
    return rangeOverlap(sStart, sEnd, wFrom, wUntil);
  }

  return (
    rangeOverlap(sStart, sEnd, wFrom, MINUTES_PER_DAY) +
    rangeOverlap(sStart, sEnd, MINUTES_PER_DAY, MINUTES_PER_DAY + wUntil) +
    rangeOverlap(sStart, sEnd, 0, wUntil)
  );
}

function rangeOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return Math.max(0, end - start);
}
