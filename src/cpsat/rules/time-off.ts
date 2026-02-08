import * as z from "zod";
import type { TimeOfDay } from "../../types.js";
import type { CompilationRule, RuleValidationContext } from "../model-builder.js";
import type { ResolvedShiftAssignment } from "../response.js";
import type { SchedulingEmployee } from "../types.js";
import {
  normalizeEndMinutes,
  parseDayString,
  priorityToPenalty,
  timeOfDayToMinutes,
} from "../utils.js";
import type { ValidationReporter } from "../validation-reporter.js";
import { normalizeScope, withScopes, type RuleScope } from "./scoping.js";

const timeOfDaySchema = z.object({
  hours: z.number().int().min(0).max(23),
  minutes: z.number().int().min(0).max(59),
});

const TimeOffSchema = withScopes(
  z.object({
    priority: z.union([
      z.literal("LOW"),
      z.literal("MEDIUM"),
      z.literal("HIGH"),
      z.literal("MANDATORY"),
    ]),
    startTime: timeOfDaySchema.optional(),
    endTime: timeOfDaySchema.optional(),
  }),
  {
    entities: ["employees", "roles", "skills"],
    times: ["dateRange", "specificDates", "dayOfWeek", "recurring"],
  },
)
  .refine(
    (config) => {
      const hasStartTime = config.startTime !== undefined;
      const hasEndTime = config.endTime !== undefined;
      return hasStartTime === hasEndTime;
    },
    {
      message: "Both startTime and endTime must be provided together for partial day time-off",
    },
  )
  .refine(
    (config) => {
      return !!(
        config.dateRange ||
        (config.specificDates && config.specificDates.length > 0) ||
        (config.dayOfWeek && config.dayOfWeek.length > 0) ||
        (config.recurringPeriods && config.recurringPeriods.length > 0)
      );
    },
    {
      message:
        "Must provide time scoping (dateRange, specificDates, dayOfWeek, or recurringPeriods)",
    },
  );

export type TimeOffConfig = z.infer<typeof TimeOffSchema>;

/**
 * Blocks or penalizes assignments during specified time periods.
 *
 * Supports entity scoping (people, roles, skills) and time scoping
 * (date ranges, specific dates, days of week, recurring periods).
 * Optionally supports partial-day time-off with startTime/endTime.
 *
 * @example Full day vacation
 * ```ts
 * createTimeOffRule({
 *   employeeIds: ["alice"],
 *   dateRange: { start: "2024-02-01", end: "2024-02-05" },
 *   priority: "MANDATORY",
 * });
 * ```
 *
 * @example Every Wednesday afternoon off for students
 * ```ts
 * createTimeOffRule({
 *   roleIds: ["student"],
 *   dayOfWeek: ["wednesday"],
 *   startTime: { hours: 14, minutes: 0 },
 *   endTime: { hours: 23, minutes: 59 },
 *   priority: "MANDATORY",
 * });
 * ```
 *
 * @example Specific date, partial day
 * ```ts
 * createTimeOffRule({
 *   employeeIds: ["bob"],
 *   specificDates: ["2024-03-15"],
 *   startTime: { hours: 16, minutes: 0 },
 *   endTime: { hours: 23, minutes: 59 },
 *   priority: "MANDATORY",
 * });
 * ```
 */
export function createTimeOffRule(config: TimeOffConfig): CompilationRule {
  const parsed = TimeOffSchema.parse(config);
  const { priority, startTime, endTime } = parsed;

  const fullDayStart: TimeOfDay = { hours: 0, minutes: 0 };
  const fullDayEnd: TimeOfDay = { hours: 23, minutes: 59 };
  const timeWindowStart = startTime ?? fullDayStart;
  const timeWindowEnd = endTime ?? fullDayEnd;

  return {
    compile(builder) {
      const scope = normalizeScope(parsed, builder.employees);
      const targetEmployees = resolveEmployees(scope, builder.employees);
      if (targetEmployees.length === 0) return;

      const activeDays = resolveActiveDays(scope, builder.days);
      if (activeDays.length === 0) return;

      for (const emp of targetEmployees) {
        for (const day of activeDays) {
          // Report exclusion for coverage analysis (MANDATORY only)
          if (priority === "MANDATORY") {
            builder.reporter.excludeFromCoverage({
              employeeId: emp.id,
              day,
              startTime: timeWindowStart,
              endTime: timeWindowEnd,
            });
          }

          for (const pattern of builder.shiftPatterns) {
            if (!builder.canAssign(emp, pattern)) continue;
            if (!builder.patternAvailableOnDay(pattern, day)) continue;

            if (startTime && endTime) {
              if (!shiftOverlapsTimeWindow(pattern, startTime, endTime)) {
                continue;
              }
            }

            const assignVar = builder.assignment(emp.id, pattern.id, day);

            if (priority === "MANDATORY") {
              builder.addLinear([{ var: assignVar, coeff: 1 }], "==", 0);
            } else {
              builder.addSoftLinear(
                [{ var: assignVar, coeff: 1 }],
                "<=",
                0,
                priorityToPenalty(priority),
              );
            }
          }
        }
      }
    },

    validate(
      assignments: ResolvedShiftAssignment[],
      reporter: ValidationReporter,
      context: RuleValidationContext,
    ) {
      // MANDATORY time-off is a hard constraint - can't be violated
      if (priority === "MANDATORY") return;

      // Re-resolve scoping using context
      const scope = normalizeScope(parsed, context.employees);
      const targetEmployees = resolveEmployees(scope, context.employees);
      if (targetEmployees.length === 0) return;

      const activeDays = resolveActiveDays(scope, context.days);
      if (activeDays.length === 0) return;

      // Check each employee/day combination
      for (const emp of targetEmployees) {
        for (const day of activeDays) {
          const violated = assignments.some(
            (a) =>
              a.employeeId === emp.id &&
              a.day === day &&
              assignmentOverlapsTimeWindow(a, timeWindowStart, timeWindowEnd),
          );

          if (violated) {
            reporter.reportRuleViolation({
              rule: "time-off",
              reason: `Time-off request for ${emp.id} on ${day} could not be honored`,
              context: {
                employeeIds: [emp.id],
                days: [day],
              },
            });
          } else {
            reporter.reportRulePassed({
              rule: "time-off",
              description: `Time-off honored for ${emp.id} on ${day}`,
              context: {
                employeeIds: [emp.id],
                days: [day],
              },
            });
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

function shiftOverlapsTimeWindow(
  pattern: { startTime: TimeOfDay; endTime: TimeOfDay },
  windowStart: TimeOfDay,
  windowEnd: TimeOfDay,
): boolean {
  const shiftStart = timeOfDayToMinutes(pattern.startTime);
  const shiftEnd = normalizeEndMinutes(shiftStart, timeOfDayToMinutes(pattern.endTime));

  const winStart = timeOfDayToMinutes(windowStart);
  const winEnd = normalizeEndMinutes(winStart, timeOfDayToMinutes(windowEnd));

  return Math.max(shiftStart, winStart) < Math.min(shiftEnd, winEnd);
}

function assignmentOverlapsTimeWindow(
  assignment: ResolvedShiftAssignment,
  windowStart: TimeOfDay,
  windowEnd: TimeOfDay,
): boolean {
  const assignStart = timeOfDayToMinutes(assignment.startTime);
  const assignEnd = normalizeEndMinutes(assignStart, timeOfDayToMinutes(assignment.endTime));

  const winStart = timeOfDayToMinutes(windowStart);
  const winEnd = normalizeEndMinutes(winStart, timeOfDayToMinutes(windowEnd));

  return Math.max(assignStart, winStart) < Math.min(assignEnd, winEnd);
}
