import * as z from "zod";
import type { CompilationRule, CostContribution } from "../model-builder.js";
import type { ShiftPattern, SchedulingMember, Term } from "../types.js";
import type { ShiftAssignment } from "../response.js";
import { COST_CATEGORY } from "../cost.js";
import {
  timeOfDayToMinutes,
  normalizeEndMinutes,
  unionMinutes,
  OBJECTIVE_WEIGHTS,
} from "../utils.js";
import {
  entityScope,
  timeScope,
  parseEntityScope,
  parseTimeScope,
  resolveMembersFromScope,
  resolveActiveDaysFromScope,
} from "./scope.types.js";
import { getHourlyRate, patternDurationMinutes } from "./cost-utils.js";

const OvertimeDailyMultiplierSchema = z
  .object({
    after: z.number().min(0),
    factor: z.number().min(1),
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/** Configuration for {@link createOvertimeDailyMultiplierRule}. */
export type OvertimeDailyMultiplierConfig = z.infer<typeof OvertimeDailyMultiplierSchema>;

/**
 * Creates a daily overtime rate multiplier rule.
 *
 * Same as the weekly variant but the threshold is per day instead of per week.
 */
export function createOvertimeDailyMultiplierRule(
  config: OvertimeDailyMultiplierConfig,
): CompilationRule {
  const parsed = OvertimeDailyMultiplierSchema.parse(config);
  const { after, factor } = parsed;
  const entityScopeValue = parseEntityScope(parsed);
  const timeScopeValue = parseTimeScope(parsed);
  const thresholdMinutes = after * 60;
  const extraFactor = factor - 1;

  return {
    compile(b) {
      if (extraFactor <= 0) return;

      const targetMembers = resolveMembersFromScope(entityScopeValue, b.members);
      const activeDays = resolveActiveDaysFromScope(timeScopeValue, b.days);

      if (targetMembers.length === 0 || activeDays.length === 0) return;

      const hasCostContext = b.costContext?.active === true;

      for (const emp of targetMembers) {
        const rate = getHourlyRate(emp);
        if (rate === undefined) continue;

        for (const day of activeDays) {
          const dayRanges: Array<{ start: number; end: number }> = [];
          const terms: Term[] = [];
          for (const pattern of b.shiftPatterns) {
            if (!b.canAssign(emp, pattern)) continue;
            if (!b.patternAvailableOnDay(pattern, day)) continue;
            const start = timeOfDayToMinutes(pattern.startTime);
            dayRanges.push({
              start,
              end: normalizeEndMinutes(start, timeOfDayToMinutes(pattern.endTime)),
            });
            terms.push({
              var: b.assignment(emp.id, pattern.id, day),
              coeff: patternDurationMinutes(pattern),
            });
          }

          if (terms.length === 0) continue;

          const maxOvertime = Math.max(0, unionMinutes(dayRanges) - thresholdMinutes);
          if (maxOvertime === 0) continue;

          const overtimeVar = b.intVar(`overtime:daily-mult:${emp.id}:${day}`, 0, maxOvertime);

          b.addLinear(
            [
              { var: overtimeVar, coeff: 1 },
              ...terms.map((t) => ({ var: t.var, coeff: -t.coeff })),
            ],
            ">=",
            -thresholdMinutes,
          );

          if (rate > 0) {
            const totalOvertimeCost = (rate * extraFactor * maxOvertime) / 60;
            if (hasCostContext) {
              const normalizedMax = totalOvertimeCost / b.costContext!.normalizationFactor;
              b.addPenalty(overtimeVar, Math.max(1, Math.round(normalizedMax / maxOvertime)));
            } else {
              b.addPenalty(
                overtimeVar,
                Math.max(1, Math.round(OBJECTIVE_WEIGHTS.COST / maxOvertime)),
              );
            }
          } else {
            b.addPenalty(overtimeVar, 1);
          }
        }
      }
    },

    cost(
      assignments: ShiftAssignment[],
      members: ReadonlyArray<SchedulingMember>,
      shiftPatterns: ReadonlyArray<ShiftPattern>,
    ): CostContribution {
      if (extraFactor <= 0) return { entries: [] };

      const memberMap = new Map(members.map((e) => [e.id, e]));
      const patternMap = new Map(shiftPatterns.map((p) => [p.id, p]));

      const allDays = [...new Set(assignments.map((a) => a.day))].toSorted();
      const activeDays = new Set(resolveActiveDaysFromScope(timeScopeValue, allDays));
      const targetEmpIds = new Set(
        resolveMembersFromScope(entityScopeValue, [...memberMap.values()]).map((e) => e.id),
      );

      // Group assignments by member then day, computing daily minutes
      const memberDayMinutes = new Map<string, Map<string, number>>();

      for (const a of assignments) {
        if (!activeDays.has(a.day)) continue;
        if (!targetEmpIds.has(a.memberId)) continue;
        const pattern = patternMap.get(a.shiftPatternId);
        if (!pattern) continue;
        let dayMap = memberDayMinutes.get(a.memberId);
        if (!dayMap) {
          dayMap = new Map();
          memberDayMinutes.set(a.memberId, dayMap);
        }
        dayMap.set(a.day, (dayMap.get(a.day) ?? 0) + patternDurationMinutes(pattern));
      }

      const entries: CostContribution["entries"] = [];

      for (const [empId, dayMap] of memberDayMinutes) {
        const emp = memberMap.get(empId);
        if (!emp) continue;
        const rate = getHourlyRate(emp);
        if (rate === undefined) continue;

        for (const [day, minutes] of dayMap) {
          const overtimeMinutes = Math.max(0, minutes - thresholdMinutes);
          if (overtimeMinutes <= 0) continue;

          entries.push({
            memberId: empId,
            day,
            category: COST_CATEGORY.OVERTIME,
            amount: (rate * extraFactor * overtimeMinutes) / 60,
          });
        }
      }

      return { entries };
    },
  };
}
