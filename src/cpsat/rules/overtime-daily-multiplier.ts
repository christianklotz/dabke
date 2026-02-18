import * as z from "zod";
import type { CompilationRule, CostContribution } from "../model-builder.js";
import type { ShiftPattern, SchedulingEmployee, Term } from "../types.js";
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
  resolveEmployeesFromScope,
  resolveActiveDaysFromScope,
} from "./scope.types.js";

const OvertimeDailyMultiplierSchema = z
  .object({
    after: z.number().min(0),
    factor: z.number().min(1),
  })
  .and(entityScope(["employees", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/** Configuration for {@link createOvertimeDailyMultiplierRule}. */
export type OvertimeDailyMultiplierConfig = z.infer<typeof OvertimeDailyMultiplierSchema>;

function getHourlyRate(emp: SchedulingEmployee): number | undefined {
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

      const targetEmployees = resolveEmployeesFromScope(entityScopeValue, b.employees);
      const activeDays = resolveActiveDaysFromScope(timeScopeValue, b.days);

      if (targetEmployees.length === 0 || activeDays.length === 0) return;

      const hasCostContext = b.costContext?.active === true;

      for (const emp of targetEmployees) {
        const rate = getHourlyRate(emp);

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

          if (rate !== undefined && rate > 0) {
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
      employees: ReadonlyArray<SchedulingEmployee>,
      shiftPatterns: ReadonlyArray<ShiftPattern>,
    ): CostContribution {
      if (extraFactor <= 0) return { entries: [] };

      const empMap = new Map(employees.map((e) => [e.id, e]));
      const patternMap = new Map(shiftPatterns.map((p) => [p.id, p]));

      const allDays = [...new Set(assignments.map((a) => a.day))].toSorted();
      const activeDays = new Set(resolveActiveDaysFromScope(timeScopeValue, allDays));
      const targetEmpIds = new Set(
        resolveEmployeesFromScope(entityScopeValue, [...empMap.values()]).map((e) => e.id),
      );

      // Group assignments by (employee, day) and compute daily minutes
      const dayMinutes = new Map<string, number>(); // key: "empId:day"

      for (const a of assignments) {
        if (!activeDays.has(a.day)) continue;
        if (!targetEmpIds.has(a.employeeId)) continue;
        const pattern = patternMap.get(a.shiftPatternId);
        if (!pattern) continue;
        const key = `${a.employeeId}:${a.day}`;
        dayMinutes.set(key, (dayMinutes.get(key) ?? 0) + patternDurationMinutes(pattern));
      }

      const entries: CostContribution["entries"] = [];

      for (const [key, minutes] of dayMinutes) {
        const overtimeMinutes = Math.max(0, minutes - thresholdMinutes);
        if (overtimeMinutes <= 0) continue;

        const [empId, day] = key.split(":");
        if (!empId || !day) continue;

        const emp = empMap.get(empId);
        if (!emp) continue;
        const rate = getHourlyRate(emp);
        if (rate === undefined) continue;

        entries.push({
          employeeId: empId,
          day,
          category: COST_CATEGORY.OVERTIME,
          amount: (rate * extraFactor * overtimeMinutes) / 60,
        });
      }

      return { entries };
    },
  };
}
