import * as z from "zod";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import type { CostArtifact } from "../rule-descriptor.js";
import { COST_CATEGORY } from "../cost.js";
import {
  entityScope,
  parseEntityScope,
  parseTimeScope,
  resolveActiveDaysFromScope,
  resolveMembersFromScope,
  timeScope,
} from "./scope.types.js";
import { patternDurationMinutes } from "./pattern-time.js";

export const DayCostSurchargeSchema = z
  .object({
    amountPerHour: z.number().min(0),
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/** Configuration for {@link dayCostSurchargeRuleDescriptor}. */
export type DayCostSurchargeConfig = z.infer<typeof DayCostSurchargeSchema>;

/**
 * Low-level descriptor for the `day-cost-surcharge` rule.
 *
 * @remarks
 * This artifact always contributes to post-solve cost calculation. It only adds
 * solver objective terms when `minimize-cost` is active.
 *
 * @category Rules
 */
export const dayCostSurchargeRuleDescriptor = defineRuleDescriptor({
  name: "day-cost-surcharge",
  schema: DayCostSurchargeSchema,
  compile(config) {
    const { amountPerHour } = config;
    const entityScopeValue = parseEntityScope(config);
    const timeScopeValue = parseTimeScope(config);

    const validation = {
      strategy: "skip" as const,
      category: "no-meaningful-feedback" as const,
      rationale:
        amountPerHour <= 0
          ? "A zero surcharge does not change optimization or cost accounting."
          : "Day cost surcharges only affect optimization when minimize-cost is active.",
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
            for (const day of activeDays) {
              if (!builder.patternAvailableOnDay(pattern, day)) continue;
              const duration = patternDurationMinutes(pattern);
              const surcharge = (amountPerHour * duration) / 60;
              const normalizedPenalty = surcharge / normalizationFactor;
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
          const duration = patternDurationMinutes(pattern);
          entries.push({
            memberId: assignment.memberId,
            day: assignment.day,
            category: COST_CATEGORY.PREMIUM,
            amount: (amountPerHour * duration) / 60,
          });
        }

        return { entries };
      },
    };

    return {
      rule: "day-cost-surcharge",
      artifacts: [costArtifact],
    };
  },
});
