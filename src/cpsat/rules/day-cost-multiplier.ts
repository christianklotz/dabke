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
import { getHourlyRate } from "./cost-utils.js";
import { patternDurationMinutes } from "./pattern-time.js";

export const DayCostMultiplierSchema = z
  .object({
    factor: z.number().min(1),
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/** Configuration for {@link dayCostMultiplierRuleDescriptor}. */
export type DayCostMultiplierConfig = z.infer<typeof DayCostMultiplierSchema>;

/**
 * Low-level descriptor for the `day-cost-multiplier` rule.
 *
 * @remarks
 * This artifact always contributes to post-solve cost calculation. It only adds
 * solver objective terms when `minimize-cost` is active.
 *
 * @category Rules
 */
export const dayCostMultiplierRuleDescriptor = defineRuleDescriptor({
  name: "day-cost-multiplier",
  schema: DayCostMultiplierSchema,
  compile(config) {
    const { factor } = config;
    const entityScopeValue = parseEntityScope(config);
    const timeScopeValue = parseTimeScope(config);

    const validation = {
      strategy: "skip" as const,
      category: "no-meaningful-feedback" as const,
      rationale:
        factor <= 1
          ? "A 1x multiplier does not change optimization or cost accounting."
          : "Day cost multipliers only affect optimization when minimize-cost is active.",
    };

    const costArtifact: CostArtifact = {
      kind: "cost",
      validation,
      compileObjective(builder) {
        if (!builder.costContext?.active || factor <= 1) return;

        const targetMembers = resolveMembersFromScope(entityScopeValue, builder.members);
        const activeDays = resolveActiveDaysFromScope(timeScopeValue, builder.days);
        if (targetMembers.length === 0 || activeDays.length === 0) return;

        const { normalizationFactor } = builder.costContext;
        const extraFactor = factor - 1;

        for (const member of targetMembers) {
          const rate = getHourlyRate(member);
          if (rate === undefined) continue;
          for (const pattern of builder.shiftPatterns) {
            if (!builder.canAssign(member, pattern)) continue;
            for (const day of activeDays) {
              if (!builder.patternAvailableOnDay(pattern, day)) continue;
              const duration = patternDurationMinutes(pattern);
              const extraCost = (rate * extraFactor * duration) / 60;
              const normalizedPenalty = extraCost / normalizationFactor;
              builder.addPenalty(
                builder.assignment(member.id, pattern.id, day),
                Math.max(1, normalizedPenalty),
              );
            }
          }
        }
      },
      calculateCost(assignments, costContext) {
        if (factor <= 1) return { entries: [] };

        const memberMap = new Map(costContext.members.map((member) => [member.id, member]));
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
        const extraFactor = factor - 1;

        const entries = [] as Array<{
          memberId: string;
          day: string;
          category: string;
          amount: number;
        }>;
        for (const assignment of assignments) {
          if (!activeDays.has(assignment.day) || !targetMemberIds.has(assignment.memberId))
            continue;
          const member = memberMap.get(assignment.memberId);
          if (!member) continue;
          const rate = getHourlyRate(member);
          if (rate === undefined) continue;
          const pattern = patternMap.get(assignment.shiftPatternId);
          if (!pattern) continue;
          const duration = patternDurationMinutes(pattern);
          entries.push({
            memberId: assignment.memberId,
            day: assignment.day,
            category: COST_CATEGORY.PREMIUM,
            amount: (rate * extraFactor * duration) / 60,
          });
        }

        return { entries };
      },
    };

    return {
      rule: "day-cost-multiplier",
      artifacts: [costArtifact],
    };
  },
});
