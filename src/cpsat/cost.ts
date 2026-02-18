import type { ShiftAssignment } from "./response.js";
import type { SchedulingEmployee, ShiftPattern } from "./types.js";
import type { CompilationRule, CostEntry } from "./model-builder.js";
import { timeOfDayToMinutes, normalizeEndMinutes } from "./utils.js";

/**
 * Well-known cost categories used by built-in rules.
 *
 * Custom rules can use any string as a category. These constants
 * are provided for convenience and consistency.
 *
 * @category Cost
 */
export const COST_CATEGORY = {
  /** Base pay cost (from {@link minimizeCost}). */
  BASE: "base",
  /** Overtime cost (from overtime rules). */
  OVERTIME: "overtime",
  /** Premium cost (from day/time multipliers and surcharges). */
  PREMIUM: "premium",
} as const;

/**
 * Per-employee cost breakdown.
 *
 * Categories are open-ended strings. Built-in rules use categories
 * from {@link COST_CATEGORY}. Custom rules can introduce their own.
 *
 * @category Cost
 */
export interface EmployeeCostDetail {
  /** Sum of all category costs. */
  totalCost: number;
  /** Total hours worked (computed from assignments, not from rules). */
  totalHours: number;
  /** Cost per category. Only categories with nonzero cost appear. */
  categories: ReadonlyMap<string, number>;
}

/**
 * Full cost breakdown for a solved schedule.
 *
 * @category Cost
 */
export interface CostBreakdown {
  /** Total cost in the caller's currency unit. */
  total: number;
  /** Cost per employee. */
  byEmployee: ReadonlyMap<string, EmployeeCostDetail>;
  /** Cost per day. */
  byDay: ReadonlyMap<string, number>;
}

/**
 * Configuration accepted by {@link calculateScheduleCost}.
 *
 * In practice, callers pass the `ModelBuilderConfig` (which satisfies this)
 * or the relevant subset.
 */
export interface CostCalculationConfig {
  employees: ReadonlyArray<SchedulingEmployee>;
  shiftPatterns: ReadonlyArray<ShiftPattern>;
  rules: ReadonlyArray<CompilationRule>;
}

/**
 * Computes the actual cost of a solved schedule using the same cost model
 * as the solver rules.
 *
 * Collects `CostEntry` values from all rules' `cost()` methods and
 * aggregates them into a {@link CostBreakdown}.
 *
 * @param assignments - Shift assignments from {@link parseSolverResponse}
 * @param config - Employees, shift patterns, and compiled rules
 */
export function calculateScheduleCost(
  assignments: ShiftAssignment[],
  config: CostCalculationConfig,
): CostBreakdown {
  const { employees, shiftPatterns, rules } = config;

  // Collect all cost entries from rules
  const allEntries: CostEntry[] = [];
  for (const rule of rules) {
    if (!rule.cost) continue;
    const contribution = rule.cost(assignments, employees, shiftPatterns);
    allEntries.push(...contribution.entries);
  }

  // Compute total hours per employee from assignments
  const patternMap = new Map(shiftPatterns.map((p) => [p.id, p]));
  const empHours = new Map<string, number>();
  for (const a of assignments) {
    const pattern = patternMap.get(a.shiftPatternId);
    if (!pattern) continue;
    const start = timeOfDayToMinutes(pattern.startTime);
    const end = normalizeEndMinutes(start, timeOfDayToMinutes(pattern.endTime));
    const hours = (end - start) / 60;
    empHours.set(a.employeeId, (empHours.get(a.employeeId) ?? 0) + hours);
  }

  // Build per-employee category maps
  const empCategories = new Map<string, Map<string, number>>();
  const dayTotals = new Map<string, number>();

  for (const entry of allEntries) {
    // Per-employee category accumulation
    let categories = empCategories.get(entry.employeeId);
    if (!categories) {
      categories = new Map();
      empCategories.set(entry.employeeId, categories);
    }
    categories.set(entry.category, (categories.get(entry.category) ?? 0) + entry.amount);

    // Per-day accumulation
    dayTotals.set(entry.day, (dayTotals.get(entry.day) ?? 0) + entry.amount);
  }

  let total = 0;
  const byEmployee = new Map<string, EmployeeCostDetail>();
  for (const [empId, categories] of empCategories) {
    let totalCost = 0;
    for (const amount of categories.values()) {
      totalCost += amount;
    }
    total += totalCost;
    byEmployee.set(empId, {
      totalCost,
      totalHours: empHours.get(empId) ?? 0,
      categories,
    });
  }

  return { total, byEmployee, byDay: dayTotals };
}
