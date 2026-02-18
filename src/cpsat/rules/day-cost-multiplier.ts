import * as z from "zod";
import type { CompilationRule, CostContribution } from "../model-builder.js";
import type { ShiftPattern, SchedulingEmployee } from "../types.js";
import type { ShiftAssignment } from "../response.js";
import { timeOfDayToMinutes, normalizeEndMinutes } from "../utils.js";
import {
  entityScope,
  timeScope,
  parseEntityScope,
  parseTimeScope,
  resolveEmployeesFromScope,
  resolveActiveDaysFromScope,
} from "./scope.types.js";

const DayCostMultiplierSchema = z
  .object({
    factor: z.number().min(1),
  })
  .and(entityScope(["employees", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/** Configuration for {@link createDayCostMultiplierRule}. */
export type DayCostMultiplierConfig = z.infer<typeof DayCostMultiplierSchema>;

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
 * Creates a day-based rate multiplier rule.
 *
 * Multiplies the base rate for assignments on matching days. The extra cost
 * above 1x is added as a penalty term (the base 1x is handled by `minimizeCost()`).
 *
 * When `minimizeCost()` is not present, no solver terms are emitted,
 * but the `cost()` method still contributes to post-solve calculation.
 */
export function createDayCostMultiplierRule(config: DayCostMultiplierConfig): CompilationRule {
  const parsed = DayCostMultiplierSchema.parse(config);
  const { factor } = parsed;
  const entityScopeValue = parseEntityScope(parsed);
  const timeScopeValue = parseTimeScope(parsed);

  return {
    compile(b) {
      if (!b.costContext?.active) return;
      if (factor <= 1) return;

      const targetEmployees = resolveEmployeesFromScope(entityScopeValue, b.employees);
      const activeDays = resolveActiveDaysFromScope(timeScopeValue, b.days);

      if (targetEmployees.length === 0 || activeDays.length === 0) return;

      const { normalizationFactor } = b.costContext;
      const extraFactor = factor - 1;

      for (const emp of targetEmployees) {
        const rate = getHourlyRate(emp);
        if (rate === undefined) continue;

        for (const pattern of b.shiftPatterns) {
          if (!b.canAssign(emp, pattern)) continue;
          for (const day of activeDays) {
            if (!b.patternAvailableOnDay(pattern, day)) continue;
            const duration = patternDurationMinutes(pattern);
            const extraCost = (rate * extraFactor * duration) / 60;
            const normalizedPenalty = extraCost / normalizationFactor;
            b.addPenalty(b.assignment(emp.id, pattern.id, day), Math.max(1, normalizedPenalty));
          }
        }
      }
    },

    cost(
      assignments: ShiftAssignment[],
      employees: ReadonlyArray<SchedulingEmployee>,
      shiftPatterns: ReadonlyArray<ShiftPattern>,
    ): CostContribution {
      if (factor <= 1) return { entries: [] };

      const empMap = new Map(employees.map((e) => [e.id, e]));
      const patternMap = new Map(shiftPatterns.map((p) => [p.id, p]));

      // Resolve which days this rule applies to from assignments
      const allDays = [...new Set(assignments.map((a) => a.day))].toSorted();
      const activeDays = new Set(resolveActiveDaysFromScope(timeScopeValue, allDays));
      const targetEmpIds = new Set(
        resolveEmployeesFromScope(entityScopeValue, [...empMap.values()]).map((e) => e.id),
      );

      const entries: CostContribution["entries"] = [];
      const extraFactor = factor - 1;

      for (const a of assignments) {
        if (!activeDays.has(a.day)) continue;
        if (!targetEmpIds.has(a.employeeId)) continue;
        const emp = empMap.get(a.employeeId);
        if (!emp) continue;
        const rate = getHourlyRate(emp);
        if (rate === undefined) continue;
        const pattern = patternMap.get(a.shiftPatternId);
        if (!pattern) continue;
        const duration = patternDurationMinutes(pattern);
        const amount = (rate * extraFactor * duration) / 60;
        entries.push({
          employeeId: a.employeeId,
          day: a.day,
          category: "premium",
          amount,
        });
      }

      return { entries };
    },
  };
}
