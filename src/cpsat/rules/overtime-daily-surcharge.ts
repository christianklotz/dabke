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
import { patternDurationMinutes } from "./cost-utils.js";

const OvertimeDailySurchargeSchema = z
  .object({
    after: z.number().min(0),
    amount: z.number().min(0),
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/** Configuration for {@link createOvertimeDailySurchargeRule}. */
export type OvertimeDailySurchargeConfig = z.infer<typeof OvertimeDailySurchargeSchema>;

/**
 * Creates a daily overtime flat surcharge rule.
 *
 * Hours beyond the threshold per day get a flat surcharge per hour,
 * independent of the member's base rate.
 */
export function createOvertimeDailySurchargeRule(
  config: OvertimeDailySurchargeConfig,
): CompilationRule {
  const parsed = OvertimeDailySurchargeSchema.parse(config);
  const { after, amount } = parsed;
  const entityScopeValue = parseEntityScope(parsed);
  const timeScopeValue = parseTimeScope(parsed);
  const thresholdMinutes = after * 60;

  return {
    compile(b) {
      if (amount <= 0) return;

      const targetMembers = resolveMembersFromScope(entityScopeValue, b.members);
      const activeDays = resolveActiveDaysFromScope(timeScopeValue, b.days);

      if (targetMembers.length === 0 || activeDays.length === 0) return;

      const hasCostContext = b.costContext?.active === true;
      const surchargePerMinute = amount / 60;

      for (const emp of targetMembers) {
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

          const overtimeVar = b.intVar(`overtime:daily-surcharge:${emp.id}:${day}`, 0, maxOvertime);

          b.addLinear(
            [
              { var: overtimeVar, coeff: 1 },
              ...terms.map((t) => ({ var: t.var, coeff: -t.coeff })),
            ],
            ">=",
            -thresholdMinutes,
          );

          if (hasCostContext) {
            const totalOvertimeCost = surchargePerMinute * maxOvertime;
            const normalizedMax = totalOvertimeCost / b.costContext!.normalizationFactor;
            b.addPenalty(overtimeVar, Math.max(1, Math.round(normalizedMax / maxOvertime)));
          } else {
            b.addPenalty(
              overtimeVar,
              Math.max(1, Math.round(OBJECTIVE_WEIGHTS.COST / maxOvertime)),
            );
          }
        }
      }
    },

    cost(
      assignments: ShiftAssignment[],
      members: ReadonlyArray<SchedulingMember>,
      shiftPatterns: ReadonlyArray<ShiftPattern>,
    ): CostContribution {
      if (amount <= 0) return { entries: [] };

      const patternMap = new Map(shiftPatterns.map((p) => [p.id, p]));
      const allDays = [...new Set(assignments.map((a) => a.day))].toSorted();
      const activeDays = new Set(resolveActiveDaysFromScope(timeScopeValue, allDays));
      const targetEmpIds = new Set(
        resolveMembersFromScope(entityScopeValue, [...members]).map((e) => e.id),
      );

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
        for (const [day, minutes] of dayMap) {
          const overtimeMinutes = Math.max(0, minutes - thresholdMinutes);
          if (overtimeMinutes <= 0) continue;

          entries.push({
            memberId: empId,
            day,
            category: COST_CATEGORY.OVERTIME,
            amount: (amount * overtimeMinutes) / 60,
          });
        }
      }

      return { entries };
    },
  };
}
