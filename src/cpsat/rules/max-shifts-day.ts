import * as z from "zod";
import type { CompilationRule } from "../model-builder.js";
import type { SchedulingEmployee } from "../types.js";
import type { Term } from "../types.js";
import { parseDayString, priorityToPenalty } from "../utils.js";
import { normalizeScope, withScopes, type RuleScope } from "./scoping.js";

const MaxShiftsDaySchema = withScopes(
  z.object({
    shifts: z.number().int().min(1),
    priority: z.union([
      z.literal("LOW"),
      z.literal("MEDIUM"),
      z.literal("HIGH"),
      z.literal("MANDATORY"),
    ]),
  }),
  {
    entities: ["employees", "roles", "skills"],
    times: ["dateRange", "specificDates", "dayOfWeek", "recurring"],
  },
);

export type MaxShiftsDayConfig = z.infer<typeof MaxShiftsDaySchema>;

/**
 * Limits how many shifts a person can work in a single day.
 *
 * This rule controls the maximum number of distinct shift assignments per day,
 * regardless of shift duration. For limiting total hours worked, use `max-hours-day`.
 *
 * Supports entity scoping (people, roles, skills) and time scoping
 * (date ranges, specific dates, days of week, recurring periods).
 *
 * @example Limit to one shift per day (common for most schedules)
 * ```ts
 * createMaxShiftsDayRule({
 *   shifts: 1,
 *   priority: "MANDATORY",
 * });
 * ```
 *
 * @example Allow up to two shifts per day for part-time workers
 * ```ts
 * createMaxShiftsDayRule({
 *   roleIds: ["part-time"],
 *   shifts: 2,
 *   priority: "HIGH",
 * });
 * ```
 *
 * @example Students can work 2 shifts on weekends only
 * ```ts
 * createMaxShiftsDayRule({
 *   roleIds: ["student"],
 *   shifts: 2,
 *   dayOfWeek: ["saturday", "sunday"],
 *   priority: "MANDATORY",
 * });
 * ```
 */
export function createMaxShiftsDayRule(config: MaxShiftsDayConfig): CompilationRule {
  const parsed = MaxShiftsDaySchema.parse(config);
  const { shifts, priority } = parsed;

  return {
    compile(b) {
      const scope = normalizeScope(parsed, b.employees);
      const targetEmployees = resolveEmployees(scope, b.employees);
      const activeDays = resolveActiveDays(scope, b.days);

      if (targetEmployees.length === 0 || activeDays.length === 0) return;

      for (const emp of targetEmployees) {
        for (const day of activeDays) {
          const terms: Term[] = [];
          for (const pattern of b.shiftPatterns) {
            if (!b.canAssign(emp, pattern)) continue;
            if (!b.patternAvailableOnDay(pattern, day)) continue;
            terms.push({
              var: b.assignment(emp.id, pattern.id, day),
              coeff: 1,
            });
          }

          if (terms.length === 0) continue;

          if (priority === "MANDATORY") {
            b.addLinear(terms, "<=", shifts);
          } else {
            b.addSoftLinear(terms, "<=", shifts, priorityToPenalty(priority));
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
