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
import { patternDurationMinutes } from "./pattern-time.js";

export const OvertimeDailySurchargeSchema = z
  .object({
    after: z.number().min(0),
    amount: z.number().min(0),
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/** Configuration for {@link overtimeDailySurchargeRuleDescriptor}. */
export type OvertimeDailySurchargeConfig = z.infer<typeof OvertimeDailySurchargeSchema>;

export const overtimeDailySurchargeRuleDescriptor = defineRuleDescriptor({
  name: "overtime-daily-surcharge",
  schema: OvertimeDailySurchargeSchema,
  compile(config) {
    const { after, amount } = config;
    const entityScopeValue = parseEntityScope(config);
    const timeScopeValue = parseTimeScope(config);
    const thresholdMinutes = after * 60;

    const costArtifact: CostArtifact = {
      kind: "cost",
      validation: {
        strategy: "skip",
        category: "no-meaningful-feedback",
        rationale:
          "Overtime cost artifacts influence optimization and post-solve accounting, not validation feedback.",
      },
      compileObjective(builder) {
        if (amount <= 0) return;

        const targetMembers = resolveMembersFromScope(entityScopeValue, builder.members);
        const activeDays = resolveActiveDaysFromScope(timeScopeValue, builder.days);
        if (targetMembers.length === 0 || activeDays.length === 0) return;

        const hasCostContext = builder.costContext?.active === true;
        const surchargePerMinute = amount / 60;
        for (const member of targetMembers) {
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
              `overtime:daily-surcharge:${member.id}:${day.iso}`,
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

            if (hasCostContext) {
              const totalOvertimeCost = surchargePerMinute * maxOvertime;
              const normalizedMax = totalOvertimeCost / builder.costContext!.normalizationFactor;
              builder.addPenalty(overtimeVar, Math.max(1, Math.round(normalizedMax / maxOvertime)));
            } else {
              builder.addPenalty(
                overtimeVar,
                Math.max(1, Math.round(OBJECTIVE_WEIGHTS.COST / maxOvertime)),
              );
            }
          }
        }
      },
      calculateCost(assignments, costContext) {
        if (amount <= 0) return { entries: [] };

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
          for (const [day, minutes] of dayMap) {
            const overtimeMinutes = Math.max(0, minutes - thresholdMinutes);
            if (overtimeMinutes <= 0) continue;
            entries.push({
              memberId,
              day,
              category: COST_CATEGORY.OVERTIME,
              amount: (amount * overtimeMinutes) / 60,
            });
          }
        }

        return { entries };
      },
    };

    return {
      rule: "overtime-daily-surcharge",
      artifacts: [costArtifact],
    };
  },
});
