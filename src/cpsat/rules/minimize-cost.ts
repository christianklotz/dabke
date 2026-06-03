import type * as z from "zod";
import type { DateString, DayOfWeek } from "../../types.js";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import type { CostArtifact } from "../rule-descriptor.js";
import { COST_CATEGORY } from "../cost.js";
import { OBJECTIVE_WEIGHTS, splitIntoWeeks } from "../utils.js";
import {
  entityScope,
  parseEntityScope,
  parseTimeScope,
  resolveActiveDaysFromScope,
  resolveMembersFromScope,
  timeScope,
} from "./scope.types.js";
import { getHourlyRate, getSalariedPay } from "./cost-utils.js";
import { patternDurationMinutes } from "./pattern-time.js";

const MinimizeCostSchema = entityScope(["members", "roles", "skills"]).and(
  timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]),
);

/** Configuration for {@link minimizeCostRuleDescriptor}. */
export type MinimizeCostConfig = z.infer<typeof MinimizeCostSchema>;

export const minimizeCostRuleDescriptor = defineRuleDescriptor({
  name: "minimize-cost",
  schema: MinimizeCostSchema,
  compile(config) {
    const entityScopeValue = parseEntityScope(config);
    const timeScopeValue = parseTimeScope(config);
    let resolvedWeekStartsOn: DayOfWeek = "monday";

    const costArtifact: CostArtifact = {
      kind: "cost",
      validation: {
        strategy: "skip",
        category: "no-meaningful-feedback",
        rationale:
          "Cost optimization influences the objective and contributes post-solve accounting, not validation feedback.",
      },
      compileObjective(builder) {
        resolvedWeekStartsOn = builder.weekStartsOn;

        const targetMembers = resolveMembersFromScope(entityScopeValue, builder.members);
        const activeDays = resolveActiveDaysFromScope(timeScopeValue, builder.days);
        if (targetMembers.length === 0 || activeDays.length === 0) return;

        let maxRawCost = 0;
        for (const member of targetMembers) {
          const rate = getHourlyRate(member);
          if (rate !== undefined) {
            for (const pattern of builder.shiftPatterns) {
              if (!builder.canAssign(member, pattern)) continue;
              const duration = patternDurationMinutes(pattern);
              const rawCost = (rate * duration) / 60;
              if (rawCost > maxRawCost) maxRawCost = rawCost;
            }
          }
          const salaried = getSalariedPay(member);
          if (salaried !== undefined) {
            const weeklyCost = salaried.annual / 52;
            if (weeklyCost > maxRawCost) maxRawCost = weeklyCost;
          }
        }

        if (maxRawCost === 0) return;

        const normalizationFactor = maxRawCost / OBJECTIVE_WEIGHTS.COST;
        builder.costContext = {
          normalizationFactor,
          active: true,
        };

        for (const member of targetMembers) {
          const rate = getHourlyRate(member);
          if (rate !== undefined) {
            for (const pattern of builder.shiftPatterns) {
              if (!builder.canAssign(member, pattern)) continue;
              for (const day of activeDays) {
                if (!builder.patternAvailableOnDay(pattern, day)) continue;
                const duration = patternDurationMinutes(pattern);
                const rawCost = (rate * duration) / 60;
                const normalizedPenalty = rawCost / normalizationFactor;
                builder.addPenalty(
                  builder.assignment(member.id, pattern.id, day),
                  Math.max(1, normalizedPenalty),
                );
              }
            }
            continue;
          }

          const salaried = getSalariedPay(member);
          if (salaried === undefined) continue;

          const weeklyCost = salaried.annual / 52;
          const normalizedWeeklyCost = weeklyCost / normalizationFactor;
          const weeks = splitIntoWeeks(activeDays, builder.weekStartsOn);

          for (const [weekIndex, weekDays] of weeks.entries()) {
            const weekAssignmentVars: string[] = [];
            for (const day of weekDays) {
              for (const pattern of builder.shiftPatterns) {
                if (!builder.canAssign(member, pattern)) continue;
                if (!builder.patternAvailableOnDay(pattern, day)) continue;
                weekAssignmentVars.push(builder.assignment(member.id, pattern.id, day));
              }
            }

            if (weekAssignmentVars.length === 0) continue;

            const activeVar = builder.boolVar(`active:cost:${member.id}:w${weekIndex}`);
            for (const assignVar of weekAssignmentVars) {
              builder.addLinear(
                [
                  { var: activeVar, coeff: 1 },
                  { var: assignVar, coeff: -1 },
                ],
                ">=",
                0,
              );
            }

            builder.addPenalty(activeVar, Math.max(1, Math.round(normalizedWeeklyCost)));
          }
        }
      },
      calculateCost(assignments, costContext) {
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

        const entries: Array<{ memberId: string; day: string; category: string; amount: number }> =
          [];
        const salariedWeekActive = new Map<string, Set<DateString>>();

        for (const assignment of assignments) {
          if (!activeDays.has(assignment.day) || !targetMemberIds.has(assignment.memberId))
            continue;
          const member = memberMap.get(assignment.memberId);
          if (!member) continue;
          const pattern = patternMap.get(assignment.shiftPatternId);
          if (!pattern) continue;
          const duration = patternDurationMinutes(pattern);

          const rate = getHourlyRate(member);
          if (rate !== undefined) {
            entries.push({
              memberId: assignment.memberId,
              day: assignment.day,
              category: COST_CATEGORY.BASE,
              amount: (rate * duration) / 60,
            });
            continue;
          }

          const salaried = getSalariedPay(member);
          if (salaried === undefined) continue;
          let memberDays = salariedWeekActive.get(assignment.memberId);
          if (!memberDays) {
            memberDays = new Set();
            salariedWeekActive.set(assignment.memberId, memberDays);
          }
          memberDays.add(assignment.day);
        }

        for (const [memberId, activeDaysSet] of salariedWeekActive) {
          const member = memberMap.get(memberId);
          if (!member) continue;
          const salaried = getSalariedPay(member);
          if (!salaried) continue;

          const activeDateSet = new Set(activeDaysSet);
          const activeList = costContext.days.filter((day) => activeDateSet.has(day.iso));
          const weeks = splitIntoWeeks(activeList, resolvedWeekStartsOn);

          for (const weekDays of weeks) {
            if (weekDays.length === 0) continue;
            const weeklyCost = salaried.annual / 52;
            const perDay = weeklyCost / weekDays.length;
            for (const day of weekDays) {
              entries.push({
                memberId,
                day: day.iso,
                category: COST_CATEGORY.BASE,
                amount: perDay,
              });
            }
          }
        }

        return { entries };
      },
    };

    return {
      rule: "minimize-cost",
      artifacts: [costArtifact],
    };
  },
});
