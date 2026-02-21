import * as z from "zod";
import type { TimeOfDay } from "../../types.js";
import type { CompilationRule, RuleValidationContext } from "../model-builder.js";
import type { ResolvedShiftAssignment } from "../response.js";
import { normalizeEndMinutes, priorityToPenalty, timeOfDayToMinutes } from "../utils.js";
import type { ValidationReporter } from "../validation-reporter.js";
import {
  PrioritySchema,
  entityScope,
  requiredTimeScope,
  parseEntityScope,
  parseTimeScope,
  resolveMembersFromScope,
  resolveActiveDaysFromScope,
  ruleGroup,
} from "./scope.types.js";

const timeOfDaySchema = z.object({
  hours: z.number().int().min(0).max(23),
  minutes: z.number().int().min(0).max(59),
});

const TimeOffSchema = z
  .object({
    priority: PrioritySchema,
    startTime: timeOfDaySchema.optional(),
    endTime: timeOfDaySchema.optional(),
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(requiredTimeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]))
  .refine(
    (config) => {
      const hasStartTime = config.startTime !== undefined;
      const hasEndTime = config.endTime !== undefined;
      return hasStartTime === hasEndTime;
    },
    {
      message: "Both startTime and endTime must be provided together for partial day time-off",
    },
  );

/**
 * Configuration for {@link createTimeOffRule}.
 *
 * - `priority` (required): how strictly the solver enforces this rule
 * - `startTime` (optional): start of the time-off window within each day; must be paired with `endTime`
 * - `endTime` (optional): end of the time-off window within each day; must be paired with `startTime`
 *
 * Entity scoping (at most one):
 * - `memberIds`: restrict to specific members
 * - `roleIds`: restrict to members with matching roles
 * - `skillIds`: restrict to members with matching skills
 *
 * Time scoping (exactly one required):
 * - `dateRange`: contiguous date range
 * - `specificDates`: specific dates
 * - `dayOfWeek`: days of the week
 * - `recurringPeriods`: recurring calendar periods
 */
export type TimeOffConfig = z.infer<typeof TimeOffSchema>;

/**
 * Blocks or penalizes assignments during specified time periods.
 *
 * Supports entity scoping (people, roles, skills) and time scoping
 * (date ranges, specific dates, days of week, recurring periods).
 * Optionally supports partial-day time-off with startTime/endTime.
 *
 * @param config - See {@link TimeOffConfig}
 * @example Full day vacation
 * ```ts
 * createTimeOffRule({
 *   memberIds: ["alice"],
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
 *   memberIds: ["bob"],
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

  const entityScopeValue = parseEntityScope(parsed);
  const timeScopeValue = parseTimeScope(parsed);
  const group = ruleGroup("time-off", "Time off", entityScopeValue, timeScopeValue);

  return {
    compile(builder) {
      const targetMembers = resolveMembersFromScope(entityScopeValue, builder.members);
      if (targetMembers.length === 0) return;

      const activeDays = resolveActiveDaysFromScope(timeScopeValue, builder.days);
      if (activeDays.length === 0) return;

      for (const emp of targetMembers) {
        for (const day of activeDays) {
          // Report exclusion for coverage analysis (MANDATORY only)
          if (priority === "MANDATORY") {
            builder.reporter.excludeFromCoverage({
              memberId: emp.id,
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

      const targetMembers = resolveMembersFromScope(entityScopeValue, context.members);
      if (targetMembers.length === 0) return;

      const activeDays = resolveActiveDaysFromScope(timeScopeValue, context.days);
      if (activeDays.length === 0) return;

      for (const emp of targetMembers) {
        for (const day of activeDays) {
          const violated = assignments.some(
            (a) =>
              a.memberId === emp.id &&
              a.day === day &&
              assignmentOverlapsTimeWindow(a, timeWindowStart, timeWindowEnd),
          );

          if (violated) {
            reporter.reportRuleViolation({
              rule: "time-off",
              message: `Time-off request for ${emp.id} on ${day} could not be honored`,
              context: {
                memberIds: [emp.id],
                days: [day],
              },
              group,
            });
          } else {
            reporter.reportRulePassed({
              rule: "time-off",
              message: `Time-off honored for ${emp.id} on ${day}`,
              context: {
                memberIds: [emp.id],
                days: [day],
              },
              group,
            });
          }
        }
      }
    },
  };
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
