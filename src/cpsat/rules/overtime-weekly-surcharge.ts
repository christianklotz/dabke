import * as z from "zod";
import { DayOfWeekSchema } from "../../types.js";
import type { CompilationRule, CostContribution } from "../model-builder.js";
import type { ShiftPattern, SchedulingEmployee, Term } from "../types.js";
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
  resolveEmployeesFromScope,
  resolveActiveDaysFromScope,
} from "./scope.types.js";

const OvertimeWeeklySurchargeSchema = z
  .object({
    after: z.number().min(0),
    amount: z.number().min(0),
    weekStartsOn: DayOfWeekSchema.optional(),
  })
  .and(entityScope(["employees", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/** Configuration for {@link createOvertimeWeeklySurchargeRule}. */
export type OvertimeWeeklySurchargeConfig = z.infer<typeof OvertimeWeeklySurchargeSchema>;

function patternDurationMinutes(pattern: ShiftPattern): number {
  const start = timeOfDayToMinutes(pattern.startTime);
  const end = normalizeEndMinutes(start, timeOfDayToMinutes(pattern.endTime));
  return end - start;
}

/**
 * Creates a weekly overtime flat surcharge rule.
 *
 * Hours beyond the threshold per week get a flat surcharge per hour,
 * independent of the employee's base rate.
 */
export function createOvertimeWeeklySurchargeRule(
  config: OvertimeWeeklySurchargeConfig,
): CompilationRule {
  const parsed = OvertimeWeeklySurchargeSchema.parse(config);
  const { after, amount, weekStartsOn } = parsed;
  const entityScopeValue = parseEntityScope(parsed);
  const timeScopeValue = parseTimeScope(parsed);
  const thresholdMinutes = after * 60;
  let resolvedWeekStartsOn = weekStartsOn ?? "monday";

  return {
    compile(b) {
      resolvedWeekStartsOn = weekStartsOn ?? b.weekStartsOn;
      if (amount <= 0) return;

      const targetEmployees = resolveEmployeesFromScope(entityScopeValue, b.employees);
      const activeDays = resolveActiveDaysFromScope(timeScopeValue, b.days);

      if (targetEmployees.length === 0 || activeDays.length === 0) return;

      const weeks = splitIntoWeeks(activeDays, weekStartsOn ?? b.weekStartsOn);

      const hasCostContext = b.costContext?.active === true;
      const surchargePerMinute = amount / 60;

      for (const emp of targetEmployees) {
        for (const [weekIdx, weekDays] of weeks.entries()) {
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

          const overtimeVar = b.intVar(`overtime:surcharge:${emp.id}:w${weekIdx}`, 0, maxOvertime);

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
      employees: ReadonlyArray<SchedulingEmployee>,
      shiftPatterns: ReadonlyArray<ShiftPattern>,
    ): CostContribution {
      if (amount <= 0) return { entries: [] };

      const patternMap = new Map(shiftPatterns.map((p) => [p.id, p]));
      const allDays = [...new Set(assignments.map((a) => a.day))].toSorted();
      const activeDays = new Set(resolveActiveDaysFromScope(timeScopeValue, allDays));
      const targetEmpIds = new Set(
        resolveEmployeesFromScope(entityScopeValue, [...employees]).map((e) => e.id),
      );

      const activeDaysList = allDays.filter((d) => activeDays.has(d));
      const weeks = splitIntoWeeks(activeDaysList, resolvedWeekStartsOn);

      const entries: CostContribution["entries"] = [];

      for (const weekDays of weeks) {
        const weekDaySet = new Set(weekDays);

        const empWeekData = new Map<
          string,
          { totalMinutes: number; dayMinutes: Map<string, number> }
        >();

        for (const a of assignments) {
          if (!weekDaySet.has(a.day)) continue;
          if (!activeDays.has(a.day)) continue;
          if (!targetEmpIds.has(a.employeeId)) continue;

          const pattern = patternMap.get(a.shiftPatternId);
          if (!pattern) continue;
          const duration = patternDurationMinutes(pattern);

          let data = empWeekData.get(a.employeeId);
          if (!data) {
            data = { totalMinutes: 0, dayMinutes: new Map() };
            empWeekData.set(a.employeeId, data);
          }
          data.totalMinutes += duration;
          data.dayMinutes.set(a.day, (data.dayMinutes.get(a.day) ?? 0) + duration);
        }

        for (const [empId, data] of empWeekData) {
          const overtimeMinutes = Math.max(0, data.totalMinutes - thresholdMinutes);
          if (overtimeMinutes <= 0) continue;

          const totalOvertimeCost = (amount * overtimeMinutes) / 60;

          for (const [day, dayMinutes] of data.dayMinutes) {
            const proportion = dayMinutes / data.totalMinutes;
            entries.push({
              employeeId: empId,
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
