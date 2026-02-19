import * as z from "zod";
import { DayOfWeekSchema } from "../../types.js";
import type { CompilationRule, CostContribution } from "../model-builder.js";
import type { ShiftPattern, SchedulingMember, Term } from "../types.js";
import type { ShiftAssignment } from "../response.js";
import { COST_CATEGORY } from "../cost.js";
import {
  timeOfDayToMinutes,
  normalizeEndMinutes,
  splitIntoWeeks,
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

const OvertimeWeeklyMultiplierSchema = z
  .object({
    after: z.number().min(0),
    factor: z.number().min(1),
    weekStartsOn: DayOfWeekSchema.optional(),
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/** Configuration for {@link createOvertimeWeeklyMultiplierRule}. */
export type OvertimeWeeklyMultiplierConfig = z.infer<typeof OvertimeWeeklyMultiplierSchema>;

function getHourlyRate(emp: SchedulingMember): number | undefined {
  if (!emp.pay) return undefined;
  if ("hourlyRate" in emp.pay) return emp.pay.hourlyRate;
  return undefined;
}

function patternDurationMinutes(pattern: ShiftPattern): number {
  const start = timeOfDayToMinutes(pattern.startTime);
  const end = normalizeEndMinutes(start, timeOfDayToMinutes(pattern.endTime));
  return end - start;
}

/**
 * Creates a weekly overtime rate multiplier rule.
 *
 * Hours beyond the threshold per week are paid at `factor` times the base rate.
 * The base cost for all hours (including overtime at 1x) is already counted by
 * `minimizeCost()`. This rule adds only the extra portion (`factor - 1`).
 *
 * Auxiliary variables and constraints are always emitted (they define the overtime
 * structure). The penalty terms both contribute to the objective and tighten the
 * overtime variables via minimization.
 */
export function createOvertimeWeeklyMultiplierRule(
  config: OvertimeWeeklyMultiplierConfig,
): CompilationRule {
  const parsed = OvertimeWeeklyMultiplierSchema.parse(config);
  const { after, factor, weekStartsOn } = parsed;
  const entityScopeValue = parseEntityScope(parsed);
  const timeScopeValue = parseTimeScope(parsed);
  const thresholdMinutes = after * 60;
  const extraFactor = factor - 1;
  let resolvedWeekStartsOn = weekStartsOn ?? "monday";

  return {
    compile(b) {
      resolvedWeekStartsOn = weekStartsOn ?? b.weekStartsOn;
      if (extraFactor <= 0) return;

      const targetMembers = resolveMembersFromScope(entityScopeValue, b.members);
      const activeDays = resolveActiveDaysFromScope(timeScopeValue, b.days);

      if (targetMembers.length === 0 || activeDays.length === 0) return;

      const weeks = splitIntoWeeks(activeDays, weekStartsOn ?? b.weekStartsOn);

      const hasCostContext = b.costContext?.active === true;

      for (const emp of targetMembers) {
        const rate = getHourlyRate(emp);
        if (rate === undefined) continue;

        for (const [weekIdx, weekDays] of weeks.entries()) {
          // Build total minutes expression and compute per-member week max
          // using time-range union per day (accounts for no-overlap constraints)
          let empWeekMaxMinutes = 0;
          const terms: Term[] = [];
          for (const day of weekDays) {
            const dayRanges: Array<{ start: number; end: number }> = [];
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
            empWeekMaxMinutes += unionMinutes(dayRanges);
          }

          if (terms.length === 0) continue;

          const maxOvertime = Math.max(0, empWeekMaxMinutes - thresholdMinutes);
          if (maxOvertime === 0) continue;

          // Create overtime variable: max(0, totalMinutes - threshold)
          const overtimeVar = b.intVar(`overtime:mult:${emp.id}:w${weekIdx}`, 0, maxOvertime);

          // overtimeVar >= totalMinutes - threshold
          // => overtimeVar - totalMinutes >= -threshold
          b.addLinear(
            [
              { var: overtimeVar, coeff: 1 },
              ...terms.map((t) => ({ var: t.var, coeff: -t.coeff })),
            ],
            ">=",
            -thresholdMinutes,
          );

          // Penalty tightens the variable via minimization.
          // For int vars, coeff is per unit (minute). Scale so max overtime
          // contribution is proportional to OBJECTIVE_WEIGHTS.COST.
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

      // Group assignments by member and week
      const activeDaysList = allDays.filter((d) => activeDays.has(d));
      const weeks = splitIntoWeeks(activeDaysList, resolvedWeekStartsOn);

      const entries: CostContribution["entries"] = [];

      for (const weekDays of weeks) {
        const weekDaySet = new Set(weekDays);

        // Get per-member total minutes and per-day minutes this week
        const empWeekData = new Map<
          string,
          { totalMinutes: number; dayMinutes: Map<string, number> }
        >();

        for (const a of assignments) {
          if (!weekDaySet.has(a.day)) continue;
          if (!activeDays.has(a.day)) continue;
          if (!targetEmpIds.has(a.memberId)) continue;

          const pattern = patternMap.get(a.shiftPatternId);
          if (!pattern) continue;
          const duration = patternDurationMinutes(pattern);

          let data = empWeekData.get(a.memberId);
          if (!data) {
            data = { totalMinutes: 0, dayMinutes: new Map() };
            empWeekData.set(a.memberId, data);
          }
          data.totalMinutes += duration;
          data.dayMinutes.set(a.day, (data.dayMinutes.get(a.day) ?? 0) + duration);
        }

        for (const [empId, data] of empWeekData) {
          const overtimeMinutes = Math.max(0, data.totalMinutes - thresholdMinutes);
          if (overtimeMinutes <= 0) continue;

          const emp = memberMap.get(empId);
          if (!emp) continue;
          const rate = getHourlyRate(emp);
          if (rate === undefined) continue;

          const totalOvertimeCost = (rate * extraFactor * overtimeMinutes) / 60;

          // Distribute overtime cost across the week's days proportionally
          for (const [day, dayMinutes] of data.dayMinutes) {
            const proportion = dayMinutes / data.totalMinutes;
            entries.push({
              memberId: empId,
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
}
