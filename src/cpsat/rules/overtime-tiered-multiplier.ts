import * as z from "zod";
import { DayOfWeekSchema } from "../../types.js";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import type { CostArtifact } from "../rule-descriptor.js";
import { COST_CATEGORY } from "../cost.js";
import {
  OBJECTIVE_WEIGHTS,
  normalizeEndMinutes,
  splitIntoWeeks,
  timeOfDayToMinutes,
  unionMinutes,
} from "../utils.js";
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

const OvertimeTierSchema = z.object({
  after: z.number().min(0),
  factor: z.number().min(1),
});

/**
 * A single tier in a tiered overtime configuration.
 *
 * @category Cost Optimization
 */
export type OvertimeTier = z.infer<typeof OvertimeTierSchema>;

export const OvertimeTieredMultiplierSchema = z
  .object({
    tiers: z.array(OvertimeTierSchema).nonempty(),
    weekStartsOn: DayOfWeekSchema.optional(),
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/** Configuration for {@link overtimeTieredMultiplierRuleDescriptor}. */
export type OvertimeTieredMultiplierConfig = z.infer<typeof OvertimeTieredMultiplierSchema>;

export const overtimeTieredMultiplierRuleDescriptor = defineRuleDescriptor({
  name: "overtime-tiered-multiplier",
  schema: OvertimeTieredMultiplierSchema,
  compile(config) {
    const { weekStartsOn } = config;
    const entityScopeValue = parseEntityScope(config);
    const timeScopeValue = parseTimeScope(config);
    const tiers = config.tiers.toSorted((left, right) => left.after - right.after);
    const effectiveTiers = tiers.filter((tier) => tier.factor > 1);
    let resolvedWeekStartsOn = weekStartsOn ?? "monday";

    const costArtifact: CostArtifact = {
      kind: "cost",
      validation: {
        strategy: "skip",
        category: "no-meaningful-feedback",
        rationale:
          "Overtime cost artifacts influence optimization and post-solve accounting, not validation feedback.",
      },
      compileObjective(builder) {
        resolvedWeekStartsOn = weekStartsOn ?? builder.weekStartsOn;
        if (effectiveTiers.length === 0) return;

        const targetMembers = resolveMembersFromScope(entityScopeValue, builder.members);
        const activeDays = resolveActiveDaysFromScope(timeScopeValue, builder.days);
        if (targetMembers.length === 0 || activeDays.length === 0) return;

        const weeks = splitIntoWeeks(activeDays, weekStartsOn ?? builder.weekStartsOn);
        const hasCostContext = builder.costContext?.active === true;

        for (const member of targetMembers) {
          const rate = getHourlyRate(member);
          if (rate === undefined) continue;

          for (const [weekIndex, weekDays] of weeks.entries()) {
            let memberWeekMaxMinutes = 0;
            const terms = [] as Array<{ var: string; coeff: number }>;
            for (const day of weekDays) {
              const dayRanges: Array<{ start: number; end: number }> = [];
              for (const pattern of builder.shiftPatterns) {
                if (
                  !builder.canAssign(member, pattern) ||
                  !builder.patternAvailableOnDay(pattern, day)
                ) {
                  continue;
                }
                const start = timeOfDayToMinutes(pattern.startTime);
                dayRanges.push({
                  start,
                  end: normalizeEndMinutes(start, timeOfDayToMinutes(pattern.endTime)),
                });
                terms.push({
                  var: builder.assignment(member.id, pattern.id, day),
                  coeff: patternDurationMinutes(pattern),
                });
              }
              memberWeekMaxMinutes += unionMinutes(dayRanges);
            }

            if (terms.length === 0) continue;

            const tierVars: string[] = [];
            for (const [tierIndex, tier] of effectiveTiers.entries()) {
              const thresholdMinutes = tier.after * 60;
              const maxOvertime = Math.max(0, memberWeekMaxMinutes - thresholdMinutes);
              if (maxOvertime === 0) {
                tierVars.push("");
                continue;
              }

              const tierVar = builder.intVar(
                `overtime:tiered:${member.id}:w${weekIndex}:t${tierIndex}`,
                0,
                maxOvertime,
              );
              tierVars.push(tierVar);
              builder.addLinear(
                [
                  { var: tierVar, coeff: 1 },
                  ...terms.map((term) => ({ var: term.var, coeff: -term.coeff })),
                ],
                ">=",
                -thresholdMinutes,
              );
            }

            for (let index = 0; index < effectiveTiers.length; index++) {
              const tierVar = tierVars[index];
              if (!tierVar) continue;

              const tier = effectiveTiers[index]!;
              const extraFactor = tier.factor - 1;
              const nextTierVar =
                index + 1 < effectiveTiers.length ? tierVars[index + 1] : undefined;

              if (nextTierVar) {
                const maxTierOnly = (effectiveTiers[index + 1]!.after - tier.after) * 60;
                const tierOnlyVar = builder.intVar(
                  `overtime:tiered-only:${member.id}:w${weekIndex}:t${index}`,
                  0,
                  Math.max(0, maxTierOnly),
                );
                builder.addLinear(
                  [
                    { var: tierOnlyVar, coeff: 1 },
                    { var: tierVar, coeff: -1 },
                    { var: nextTierVar, coeff: 1 },
                  ],
                  "==",
                  0,
                );

                if (rate > 0) {
                  const totalTierCost = (rate * extraFactor * Math.max(1, maxTierOnly)) / 60;
                  if (hasCostContext) {
                    const normalizedMax = totalTierCost / builder.costContext!.normalizationFactor;
                    builder.addPenalty(
                      tierOnlyVar,
                      Math.max(1, Math.round(normalizedMax / Math.max(1, maxTierOnly))),
                    );
                  } else {
                    builder.addPenalty(
                      tierOnlyVar,
                      Math.max(1, Math.round(OBJECTIVE_WEIGHTS.COST / Math.max(1, maxTierOnly))),
                    );
                  }
                } else {
                  builder.addPenalty(tierOnlyVar, 1);
                }
              } else {
                const maxOvertimeLast = Math.max(1, memberWeekMaxMinutes - tier.after * 60);
                if (rate > 0) {
                  const totalTierCost = (rate * extraFactor * maxOvertimeLast) / 60;
                  if (hasCostContext) {
                    const normalizedMax = totalTierCost / builder.costContext!.normalizationFactor;
                    builder.addPenalty(
                      tierVar,
                      Math.max(1, Math.round(normalizedMax / maxOvertimeLast)),
                    );
                  } else {
                    builder.addPenalty(
                      tierVar,
                      Math.max(1, Math.round(OBJECTIVE_WEIGHTS.COST / maxOvertimeLast)),
                    );
                  }
                } else {
                  builder.addPenalty(tierVar, 1);
                }
              }
            }
          }
        }
      },
      calculateCost(assignments, costContext) {
        if (effectiveTiers.length === 0) return { entries: [] };

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
        const activeDaysList = costContext.days.filter((day) => activeDays.has(day.iso));
        const weeks = splitIntoWeeks(activeDaysList, resolvedWeekStartsOn);

        const entries = [] as Array<{
          memberId: string;
          day: string;
          category: string;
          amount: number;
        }>;
        for (const weekDays of weeks) {
          const weekDaySet = new Set(weekDays.map((day) => day.iso));
          const memberWeekData = new Map<
            string,
            { totalMinutes: number; dayMinutes: Map<string, number> }
          >();

          for (const assignment of assignments) {
            if (!weekDaySet.has(assignment.day) || !activeDays.has(assignment.day)) continue;
            if (!targetMemberIds.has(assignment.memberId)) continue;
            const pattern = patternMap.get(assignment.shiftPatternId);
            if (!pattern) continue;
            const duration = patternDurationMinutes(pattern);
            let data = memberWeekData.get(assignment.memberId);
            if (!data) {
              data = { totalMinutes: 0, dayMinutes: new Map() };
              memberWeekData.set(assignment.memberId, data);
            }
            data.totalMinutes += duration;
            data.dayMinutes.set(
              assignment.day,
              (data.dayMinutes.get(assignment.day) ?? 0) + duration,
            );
          }

          for (const [memberId, data] of memberWeekData) {
            const member = memberMap.get(memberId);
            if (!member) continue;
            const rate = getHourlyRate(member);
            if (rate === undefined) continue;

            let totalOvertimeCost = 0;
            for (let index = 0; index < effectiveTiers.length; index++) {
              const tier = effectiveTiers[index]!;
              const thresholdMinutes = tier.after * 60;
              const extraFactor = tier.factor - 1;
              const overtimeAboveThreshold = Math.max(0, data.totalMinutes - thresholdMinutes);
              if (overtimeAboveThreshold <= 0) continue;

              const nextThreshold = effectiveTiers[index + 1]
                ? effectiveTiers[index + 1]!.after * 60
                : Infinity;
              const tierMinutes = Math.min(
                overtimeAboveThreshold,
                nextThreshold === Infinity
                  ? overtimeAboveThreshold
                  : nextThreshold - thresholdMinutes,
              );
              totalOvertimeCost += (rate * extraFactor * tierMinutes) / 60;
            }

            if (totalOvertimeCost <= 0) continue;
            for (const [day, dayMinutes] of data.dayMinutes) {
              const proportion = dayMinutes / data.totalMinutes;
              entries.push({
                memberId,
                day,
                category: COST_CATEGORY.OVERTIME,
                amount: totalOvertimeCost * proportion,
              });
            }
          }
        }

        return { entries };
      },
    };

    return {
      rule: "overtime-tiered-multiplier",
      artifacts: [costArtifact],
    };
  },
});
