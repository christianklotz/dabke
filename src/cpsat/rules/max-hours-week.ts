import * as z from "zod";
import { DayOfWeekSchema } from "../../types.js";
import type { CompilationRule } from "../model-builder.js";
import type { SchedulingEmployee, Term } from "../types.js";
import { parseDayString, priorityToPenalty, splitIntoWeeks } from "../utils.js";
import { normalizeScope, withScopes, type RuleScope } from "./scoping.js";

const MaxHoursWeekSchema = withScopes(
  z.object({
    hours: z.number().min(0),
    priority: z.union([
      z.literal("LOW"),
      z.literal("MEDIUM"),
      z.literal("HIGH"),
      z.literal("MANDATORY"),
    ]),
    // Optional override; defaults to ModelBuilder.weekStartsOn
    weekStartsOn: DayOfWeekSchema.optional(),
  }),
  {
    entities: ["employees", "roles", "skills"],
    times: ["dateRange", "specificDates", "dayOfWeek", "recurring"],
  },
);

/**
 * Configuration for {@link createMaxHoursWeekRule}.
 *
 * - `hours` (required): maximum hours allowed per scheduling week
 * - `priority` (required): how strictly the solver enforces this rule
 * - `weekStartsOn` (optional): which day starts the week; defaults to {@link ModelBuilder.weekStartsOn}
 *
 * Also accepts all fields from {@link ScopeConfig} for entity and time scoping.
 */
export type MaxHoursWeekConfig = z.infer<typeof MaxHoursWeekSchema>;

/**
 * Caps total hours a person can work within each scheduling week.
 *
 * Supports entity scoping (people, roles, skills) and time scoping
 * (date ranges, specific dates, days of week, recurring periods).
 * Time scoping filters which days within each week count toward the limit.
 *
 * @param config - See {@link MaxHoursWeekConfig}
 * @example Limit everyone to 40 hours per week
 * ```ts
 * createMaxHoursWeekRule({
 *   hours: 40,
 *   priority: "HIGH",
 * });
 * ```
 *
 * @example Students limited to 20 hours during term time
 * ```ts
 * createMaxHoursWeekRule({
 *   roleIds: ["student"],
 *   hours: 20,
 *   recurringPeriods: [
 *     { name: "fall-term", startMonth: 9, startDay: 1, endMonth: 12, endDay: 15 },
 *     { name: "spring-term", startMonth: 1, startDay: 15, endMonth: 5, endDay: 31 },
 *   ],
 *   priority: "MANDATORY",
 * });
 * ```
 */
export function createMaxHoursWeekRule(config: MaxHoursWeekConfig): CompilationRule {
  const parsed = MaxHoursWeekSchema.parse(config);
  const { hours, priority } = parsed;
  const maxMinutes = hours * 60;

  return {
    compile(b) {
      const scope = normalizeScope(parsed, b.employees);
      const targetEmployees = resolveEmployees(scope, b.employees);
      const activeDays = resolveActiveDays(scope, b.days);

      if (targetEmployees.length === 0 || activeDays.length === 0) return;

      const weeks = splitIntoWeeks(activeDays, parsed.weekStartsOn ?? b.weekStartsOn);

      for (const emp of targetEmployees) {
        for (const weekDays of weeks) {
          const terms: Term[] = [];
          for (const day of weekDays) {
            for (const pattern of b.shiftPatterns) {
              if (!b.canAssign(emp, pattern)) continue;
              if (!b.patternAvailableOnDay(pattern, day)) continue;
              terms.push({
                var: b.assignment(emp.id, pattern.id, day),
                coeff: b.patternDuration(pattern.id),
              });
            }
          }

          if (terms.length === 0) continue;

          if (priority === "MANDATORY") {
            b.addLinear(terms, "<=", maxMinutes);
          } else {
            b.addSoftLinear(terms, "<=", maxMinutes, priorityToPenalty(priority));
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
