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

export const OvertimeWeeklyMultiplierSchema = z
  .object({
    after: z.number().min(0),
    factor: z.number().min(1),
    weekStartsOn: DayOfWeekSchema.optional(),
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/** Configuration for {@link overtimeWeeklyMultiplierRuleDescriptor}. */
export type OvertimeWeeklyMultiplierConfig = z.infer<typeof OvertimeWeeklyMultiplierSchema>;

/**
 * Low-level descriptor for the `overtime-weekly-multiplier` rule.
 *
 * @remarks
 * Weekly overtime windows align to `weekStartsOn`. This artifact always
 * contributes to post-solve cost calculation and only affects optimization when
 * `minimize-cost` is active.
 *
 * @category Rules
 */
export const overtimeWeeklyMultiplierRuleDescriptor = defineRuleDescriptor({
  name: "overtime-weekly-multiplier",
  schema: OvertimeWeeklyMultiplierSchema,
  compile(config) {
    const { after, factor, weekStartsOn } = config;
    const entityScopeValue = parseEntityScope(config);
    const timeScopeValue = parseTimeScope(config);
    const thresholdMinutes = after * 60;
    const extraFactor = factor - 1;
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
        if (extraFactor <= 0) return;

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
            const maxOvertime = Math.max(0, memberWeekMaxMinutes - thresholdMinutes);
            if (maxOvertime === 0) continue;

            const overtimeVar = builder.intVar(
              `overtime:mult:${member.id}:w${weekIndex}`,
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
            const overtimeMinutes = Math.max(0, data.totalMinutes - thresholdMinutes);
            if (overtimeMinutes <= 0) continue;
            const member = memberMap.get(memberId);
            if (!member) continue;
            const rate = getHourlyRate(member);
            if (rate === undefined) continue;

            const totalOvertimeCost = (rate * extraFactor * overtimeMinutes) / 60;
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
      rule: "overtime-weekly-multiplier",
      artifacts: [costArtifact],
    };
  },
});
