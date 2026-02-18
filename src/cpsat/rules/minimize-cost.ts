import type * as z from "zod";
import type { DayOfWeek } from "../../types.js";
import type { CompilationRule, CostContribution } from "../model-builder.js";
import type { ShiftPattern, SchedulingEmployee } from "../types.js";
import type { ShiftAssignment } from "../response.js";
import { COST_CATEGORY } from "../cost.js";
import {
  OBJECTIVE_WEIGHTS,
  timeOfDayToMinutes,
  normalizeEndMinutes,
  splitIntoWeeks,
} from "../utils.js";
import {
  entityScope,
  timeScope,
  parseEntityScope,
  parseTimeScope,
  resolveEmployeesFromScope,
  resolveActiveDaysFromScope,
} from "./scope.types.js";

const MinimizeCostSchema = entityScope(["employees", "roles", "skills"]).and(
  timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]),
);

/** Configuration for {@link createMinimizeCostRule}. */
export type MinimizeCostConfig = z.infer<typeof MinimizeCostSchema>;

/** Returns the hourly rate for an employee, or undefined if not hourly. */
function getHourlyRate(emp: SchedulingEmployee): number | undefined {
  if (!emp.pay) return undefined;
  if ("hourlyRate" in emp.pay) return emp.pay.hourlyRate;
  return undefined;
}

/** Returns salaried pay info, or undefined if not salaried. */
function getSalariedPay(
  emp: SchedulingEmployee,
): { annual: number; hoursPerWeek: number } | undefined {
  if (!emp.pay) return undefined;
  if ("annual" in emp.pay) return emp.pay;
  return undefined;
}

/** Computes shift duration in minutes from a pattern. */
function patternDurationMinutes(pattern: ShiftPattern): number {
  const start = timeOfDayToMinutes(pattern.startTime);
  const end = normalizeEndMinutes(start, timeOfDayToMinutes(pattern.endTime));
  return end - start;
}

/**
 * Creates the minimize-cost rule.
 *
 * **Hourly employees:** adds a penalty proportional to
 * `hourlyRate * shiftDurationMinutes / 60` for each assignment.
 *
 * **Salaried employees:** zero marginal cost up to their contracted hours.
 * A boolean variable tracks whether the employee has any assignment in a
 * given week. When active, their full weekly salary (`annual / 52`) is
 * added as a penalty. This causes the solver to load work onto salaried
 * employees (who are "free" once activated) before hourly workers.
 *
 * Computes a normalization factor and stores it on the model builder's
 * `costContext` so modifier rules can use the same scale.
 */
export function createMinimizeCostRule(config: MinimizeCostConfig): CompilationRule {
  const parsed = MinimizeCostSchema.parse(config);
  const entityScopeValue = parseEntityScope(parsed);
  const timeScopeValue = parseTimeScope(parsed);

  let resolvedWeekStartsOn: DayOfWeek = "monday";

  return {
    compile(b) {
      resolvedWeekStartsOn = b.weekStartsOn;

      const targetEmployees = resolveEmployeesFromScope(entityScopeValue, b.employees);
      const activeDays = resolveActiveDaysFromScope(timeScopeValue, b.days);

      if (targetEmployees.length === 0 || activeDays.length === 0) return;

      // Compute normalization factor: max raw cost of any single assignment
      // (hourly) or weekly salary (salaried)
      let maxRawCost = 0;
      for (const emp of targetEmployees) {
        const rate = getHourlyRate(emp);
        if (rate !== undefined) {
          for (const pattern of b.shiftPatterns) {
            if (!b.canAssign(emp, pattern)) continue;
            const duration = patternDurationMinutes(pattern);
            const rawCost = (rate * duration) / 60;
            if (rawCost > maxRawCost) maxRawCost = rawCost;
          }
        }
        const salaried = getSalariedPay(emp);
        if (salaried !== undefined) {
          const weeklyCost = salaried.annual / 52;
          if (weeklyCost > maxRawCost) maxRawCost = weeklyCost;
        }
      }

      if (maxRawCost === 0) return;

      const normalizationFactor = maxRawCost / OBJECTIVE_WEIGHTS.COST;

      b.costContext = {
        normalizationFactor,
        active: true,
      };

      // Add penalty terms for hourly employees
      for (const emp of targetEmployees) {
        const rate = getHourlyRate(emp);
        if (rate !== undefined) {
          for (const pattern of b.shiftPatterns) {
            if (!b.canAssign(emp, pattern)) continue;
            for (const day of activeDays) {
              if (!b.patternAvailableOnDay(pattern, day)) continue;
              const duration = patternDurationMinutes(pattern);
              const rawCost = (rate * duration) / 60;
              const normalizedPenalty = rawCost / normalizationFactor;
              b.addPenalty(b.assignment(emp.id, pattern.id, day), Math.max(1, normalizedPenalty));
            }
          }
          continue;
        }

        // Salaried employees: weekly fixed cost when active
        const salaried = getSalariedPay(emp);
        if (salaried === undefined) continue;

        const weeklyCost = salaried.annual / 52;
        const normalizedWeeklyCost = weeklyCost / normalizationFactor;

        const weeks = splitIntoWeeks(activeDays, b.weekStartsOn);

        for (const [weekIdx, weekDays] of weeks.entries()) {
          // Collect all assignment vars for this employee this week
          const weekAssignmentVars: string[] = [];
          for (const day of weekDays) {
            for (const pattern of b.shiftPatterns) {
              if (!b.canAssign(emp, pattern)) continue;
              if (!b.patternAvailableOnDay(pattern, day)) continue;
              weekAssignmentVars.push(b.assignment(emp.id, pattern.id, day));
            }
          }

          if (weekAssignmentVars.length === 0) continue;

          // Bool var: true if this salaried employee works any shift this week
          const activeVar = b.boolVar(`active:cost:${emp.id}:w${weekIdx}`);

          // If any assignment is true, activeVar must be true
          // activeVar OR NOT(assignment_1) OR NOT(assignment_2) OR ...
          // This is equivalent to: for each assignment, assignment => activeVar
          for (const assignVar of weekAssignmentVars) {
            b.addImplication(assignVar, activeVar);
          }

          b.addPenalty(activeVar, Math.max(1, normalizedWeeklyCost));
        }
      }
    },

    cost(
      assignments: ShiftAssignment[],
      employees: ReadonlyArray<SchedulingEmployee>,
      shiftPatterns: ReadonlyArray<ShiftPattern>,
    ): CostContribution {
      const empMap = new Map(employees.map((e) => [e.id, e]));
      const patternMap = new Map(shiftPatterns.map((p) => [p.id, p]));

      const allDays = [...new Set(assignments.map((a) => a.day))].toSorted();
      const activeDays = new Set(resolveActiveDaysFromScope(timeScopeValue, allDays));
      const targetEmpIds = new Set(
        resolveEmployeesFromScope(entityScopeValue, [...employees]).map((e) => e.id),
      );

      const entries: CostContribution["entries"] = [];

      // Track which salaried employees are active per week for weekly cost
      const salariedWeekActive = new Map<string, Set<string>>(); // empId -> set of days

      for (const a of assignments) {
        if (!activeDays.has(a.day)) continue;
        if (!targetEmpIds.has(a.employeeId)) continue;
        const emp = empMap.get(a.employeeId);
        if (!emp) continue;

        const pattern = patternMap.get(a.shiftPatternId);
        if (!pattern) continue;
        const duration = patternDurationMinutes(pattern);

        const rate = getHourlyRate(emp);
        if (rate !== undefined) {
          // Hourly: cost per assignment
          entries.push({
            employeeId: a.employeeId,
            day: a.day,
            category: COST_CATEGORY.BASE,
            amount: (rate * duration) / 60,
          });
          continue;
        }

        // Salaried: track weeks with assignments
        const salaried = getSalariedPay(emp);
        if (salaried === undefined) continue;

        // Group by week (we'll compute the actual cost after collecting all assignments)
        const key = a.employeeId;
        let days = salariedWeekActive.get(key);
        if (!days) {
          days = new Set();
          salariedWeekActive.set(key, days);
        }
        days.add(a.day);
      }

      // Compute salaried costs: weekly salary distributed across active days
      for (const [empId, activeDaysSet] of salariedWeekActive) {
        const emp = empMap.get(empId);
        if (!emp) continue;
        const salaried = getSalariedPay(emp);
        if (!salaried) continue;

        const activeList = [...activeDaysSet].toSorted();
        const weeks = splitIntoWeeks(activeList, resolvedWeekStartsOn);

        for (const weekDays of weeks) {
          if (weekDays.length === 0) continue;
          const weeklyCost = salaried.annual / 52;
          // Distribute evenly across days worked that week
          const perDay = weeklyCost / weekDays.length;
          for (const day of weekDays) {
            entries.push({
              employeeId: empId,
              day,
              category: COST_CATEGORY.BASE,
              amount: perDay,
            });
          }
        }
      }

      return { entries };
    },
  };
}
