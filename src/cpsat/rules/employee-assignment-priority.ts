import * as z from "zod";
import type { CompilationRule } from "../model-builder.js";
import type { SchedulingEmployee } from "../types.js";
import { OBJECTIVE_WEIGHTS, parseDayString } from "../utils.js";
import { normalizeScope, withScopes, type RuleScope } from "./scoping.js";

const EmployeeAssignmentPrioritySchema = withScopes(
  z.object({
    preference: z.union([z.literal("high"), z.literal("low")]),
  }),
  {
    entities: ["employees", "roles", "skills"],
    times: ["dateRange", "specificDates", "dayOfWeek", "recurring"],
  },
);

export type EmployeeAssignmentPriorityConfig = z.infer<typeof EmployeeAssignmentPrioritySchema>;

/**
 * Adds objective weight to prefer or avoid assigning team members.
 *
 * Supports entity scoping (people, roles, skills) and time scoping
 * (date ranges, specific dates, days of week, recurring periods).
 *
 * @example Prefer specific team members
 * ```ts
 * createEmployeeAssignmentPriorityRule({
 *   employeeIds: ["alice", "bob"],
 *   preference: "high",
 * });
 * ```
 *
 * @example Avoid assigning students on weekdays
 * ```ts
 * createEmployeeAssignmentPriorityRule({
 *   roleIds: ["student"],
 *   dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
 *   preference: "low",
 * });
 * ```
 *
 * @example Prefer experienced staff on weekends
 * ```ts
 * createEmployeeAssignmentPriorityRule({
 *   skillIds: ["senior"],
 *   dayOfWeek: ["saturday", "sunday"],
 *   preference: "high",
 * });
 * ```
 */
export function createEmployeeAssignmentPriorityRule(
  config: EmployeeAssignmentPriorityConfig,
): CompilationRule {
  const parsed = EmployeeAssignmentPrioritySchema.parse(config);
  const { preference } = parsed;

  return {
    compile(b) {
      const scope = normalizeScope(parsed, b.employees);
      const targetEmployees = resolveEmployees(scope, b.employees);
      const activeDays = resolveActiveDays(scope, b.days);

      if (targetEmployees.length === 0 || activeDays.length === 0) return;

      const weight =
        preference === "high"
          ? -OBJECTIVE_WEIGHTS.ASSIGNMENT_PREFERENCE
          : OBJECTIVE_WEIGHTS.ASSIGNMENT_PREFERENCE;

      for (const emp of targetEmployees) {
        for (const pattern of b.shiftPatterns) {
          if (!b.canAssign(emp, pattern)) continue;
          for (const day of activeDays) {
            if (!b.patternAvailableOnDay(pattern, day)) continue;
            b.addPenalty(b.assignment(emp.id, pattern.id, day), weight);
          }
        }
      }
    },
  };
}

function resolveEmployees(scope: RuleScope, employees: SchedulingEmployee[]): SchedulingEmployee[] {
  const entity = scope.entity;
  switch (entity.type) {
    case "employees":
      return employees.filter((e) => entity.employeeIds.includes(e.id));
    case "roles":
      return employees.filter((e) => e.roleIds.some((r) => entity.roleIds.includes(r)));
    case "skills":
      return employees.filter((e) => e.skillIds?.some((s) => entity.skillIds.includes(s)));
    case "global":
    default:
      return employees;
  }
}

type DayName = "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";

function getDayOfWeekName(dayIndex: number): DayName {
  const names: Record<number, DayName> = {
    0: "sunday",
    1: "monday",
    2: "tuesday",
    3: "wednesday",
    4: "thursday",
    5: "friday",
    6: "saturday",
  };
  return names[dayIndex % 7] ?? "sunday";
}

function resolveActiveDays(scope: RuleScope, allDays: string[]): string[] {
  const timeScope = scope.time;

  if (!timeScope) {
    return allDays;
  }

  switch (timeScope.type) {
    case "always":
      return allDays;

    case "dateRange": {
      const start = timeScope.start;
      const end = timeScope.end;
      return allDays.filter((day) => day >= start && day <= end);
    }

    case "specificDates":
      return allDays.filter((day) => timeScope.dates.includes(day));

    case "dayOfWeek": {
      const targetDays = new Set(timeScope.days);
      return allDays.filter((day) => {
        const date = parseDayString(day);
        const dayName = getDayOfWeekName(date.getUTCDay());
        return targetDays.has(dayName);
      });
    }

    case "recurring": {
      return allDays.filter((day) => {
        const date = parseDayString(day);
        const month = date.getUTCMonth() + 1;
        const dayOfMonth = date.getUTCDate();

        return timeScope.periods.some((period) =>
          isDateInRecurringPeriod(month, dayOfMonth, period),
        );
      });
    }

    default:
      return allDays;
  }
}

function isDateInRecurringPeriod(
  month: number,
  dayOfMonth: number,
  period: {
    startMonth: number;
    startDay: number;
    endMonth: number;
    endDay: number;
  },
): boolean {
  const { startMonth, startDay, endMonth, endDay } = period;

  if (startMonth <= endMonth) {
    if (month < startMonth || month > endMonth) return false;
    if (month === startMonth && dayOfMonth < startDay) return false;
    if (month === endMonth && dayOfMonth > endDay) return false;
    return true;
  } else {
    if (month > endMonth && month < startMonth) return false;
    if (month === startMonth && dayOfMonth < startDay) return false;
    if (month === endMonth && dayOfMonth > endDay) return false;
    return true;
  }
}
