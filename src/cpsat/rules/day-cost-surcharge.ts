import * as z from "zod";
import type { CompilationRule, CostContribution } from "../model-builder.js";
import type { ShiftPattern, SchedulingMember } from "../types.js";
import type { ShiftAssignment } from "../response.js";
import { COST_CATEGORY } from "../cost.js";
import {
  entityScope,
  timeScope,
  parseEntityScope,
  parseTimeScope,
  resolveMembersFromScope,
  resolveActiveDaysFromScope,
} from "./scope.types.js";
import { patternDurationMinutes } from "./cost-utils.js";

const DayCostSurchargeSchema = z
  .object({
    amountPerHour: z.number().min(0),
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/** Configuration for {@link createDayCostSurchargeRule}. */
export type DayCostSurchargeConfig = z.infer<typeof DayCostSurchargeSchema>;

/**
 * Creates a day-based flat surcharge rule.
 *
 * Adds a flat extra amount per hour for assignments on matching days,
 * independent of the member's base rate.
 *
 * When `minimizeCost()` is not present, no solver terms are emitted,
 * but the `cost()` method still contributes to post-solve calculation.
 */
export function createDayCostSurchargeRule(config: DayCostSurchargeConfig): CompilationRule {
  const parsed = DayCostSurchargeSchema.parse(config);
  const { amountPerHour } = parsed;
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
          for (const day of activeDays) {
            if (!b.patternAvailableOnDay(pattern, day)) continue;
            const duration = patternDurationMinutes(pattern);
            const surcharge = (amountPerHour * duration) / 60;
            const normalizedPenalty = surcharge / normalizationFactor;
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
        const duration = patternDurationMinutes(pattern);
        const amount = (amountPerHour * duration) / 60;
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
