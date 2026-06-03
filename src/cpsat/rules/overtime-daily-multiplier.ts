import * as z from "zod";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import type { CostArtifact } from "../rule-descriptor.js";
import { COST_CATEGORY } from "../cost.js";
import {
  OBJECTIVE_WEIGHTS,
  normalizeEndMinutes,
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

export const OvertimeDailyMultiplierSchema = z
  .object({
    after: z.number().min(0),
    factor: z.number().min(1),
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/** Configuration for {@link overtimeDailyMultiplierRuleDescriptor}. */
export type OvertimeDailyMultiplierConfig = z.infer<typeof OvertimeDailyMultiplierSchema>;

export const overtimeDailyMultiplierRuleDescriptor = defineRuleDescriptor({
  name: "overtime-daily-multiplier",
  schema: OvertimeDailyMultiplierSchema,
  compile(config) {
    const { after, factor } = config;
    const entityScopeValue = parseEntityScope(config);
    const timeScopeValue = parseTimeScope(config);
    const thresholdMinutes = after * 60;
    const extraFactor = factor - 1;

    const costArtifact: CostArtifact = {
      kind: "cost",
      validation: {
        strategy: "skip",
        category: "no-meaningful-feedback",
        rationale:
          "Overtime cost artifacts influence optimization and post-solve accounting, not validation feedback.",
      },
      compileObjective(builder) {
        if (extraFactor <= 0) return;

        const targetMembers = resolveMembersFromScope(entityScopeValue, builder.members);
        const activeDays = resolveActiveDaysFromScope(timeScopeValue, builder.days);
        if (targetMembers.length === 0 || activeDays.length === 0) return;

        const hasCostContext = builder.costContext?.active === true;
        for (const member of targetMembers) {
          const rate = getHourlyRate(member);
          if (rate === undefined) continue;

          for (const day of activeDays) {
            const dayRanges: Array<{ start: number; end: number }> = [];
            const terms = [] as Array<{ var: string; coeff: number }>;
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

            if (terms.length === 0) continue;
            const maxOvertime = Math.max(0, unionMinutes(dayRanges) - thresholdMinutes);
            if (maxOvertime === 0) continue;

            const overtimeVar = builder.intVar(
              `overtime:daily-mult:${member.id}:${day.iso}`,
              0,
              maxOvertime,
            );
            builder.addLinear(
              [
                { var: overtimeVar, coeff: 1 },
                ...terms.map((term) => ({ var: term.var, coeff: -term.coeff })),
              ],
              ">=",
              -thresholdMinutes,
            );

            if (rate > 0) {
              const totalOvertimeCost = (rate * extraFactor * maxOvertime) / 60;
              if (hasCostContext) {
                const normalizedMax = totalOvertimeCost / builder.costContext!.normalizationFactor;
                builder.addPenalty(
                  overtimeVar,
                  Math.max(1, Math.round(normalizedMax / maxOvertime)),
                );
              } else {
                builder.addPenalty(
                  overtimeVar,
                  Math.max(1, Math.round(OBJECTIVE_WEIGHTS.COST / maxOvertime)),
                );
              }
            } else {
              builder.addPenalty(overtimeVar, 1);
            }
          }
        }
      },
      calculateCost(assignments, costContext) {
        if (extraFactor <= 0) return { entries: [] };

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
        const memberDayMinutes = new Map<string, Map<string, number>>();

        for (const assignment of assignments) {
          if (!activeDays.has(assignment.day) || !targetMemberIds.has(assignment.memberId))
            continue;
          const pattern = patternMap.get(assignment.shiftPatternId);
          if (!pattern) continue;
          let dayMap = memberDayMinutes.get(assignment.memberId);
          if (!dayMap) {
            dayMap = new Map();
            memberDayMinutes.set(assignment.memberId, dayMap);
          }
          dayMap.set(
            assignment.day,
            (dayMap.get(assignment.day) ?? 0) + patternDurationMinutes(pattern),
          );
        }

        const entries = [] as Array<{
          memberId: string;
          day: string;
          category: string;
          amount: number;
        }>;
        for (const [memberId, dayMap] of memberDayMinutes) {
          const member = memberMap.get(memberId);
          if (!member) continue;
          const rate = getHourlyRate(member);
          if (rate === undefined) continue;

          for (const [day, minutes] of dayMap) {
            const overtimeMinutes = Math.max(0, minutes - thresholdMinutes);
            if (overtimeMinutes <= 0) continue;
            entries.push({
              memberId,
              day,
              category: COST_CATEGORY.OVERTIME,
              amount: (rate * extraFactor * overtimeMinutes) / 60,
            });
          }
        }

        return { entries };
      },
    };

    return {
      rule: "overtime-daily-multiplier",
      artifacts: [costArtifact],
    };
  },
});
