import * as z from "zod";
import type { TimeOfDay } from "../../types.js";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import type { RuleArtifact, RuleCompileContext } from "../rule-descriptor.js";
import type { ValidationReporter } from "../validation-reporter.js";
import type { ResolvedShiftAssignment } from "../response.js";
import { normalizeEndMinutes, priorityToPenalty, timeOfDayToMinutes } from "../utils.js";
import {
  PrioritySchema,
  entityScope,
  parseEntityScope,
  parseTimeScope,
  requiredTimeScope,
  resolveActiveDaysFromScope,
  resolveMembersFromScope,
  ruleGroup,
} from "./scope.types.js";
import { assignmentVar } from "./variables.js";
import { hardConstraint, reportValidation, softConstraint } from "./artifacts.js";
import { canAssignMemberToPattern, isPatternAvailableOnDay } from "./pattern-eligibility.js";

const timeOfDaySchema = z.object({
  hours: z.number().int().min(0).max(23),
  minutes: z.number().int().min(0).max(59),
});

export const TimeOffSchema = z
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
 * Configuration for {@link timeOffRuleDescriptor}.
 */
export type TimeOffConfig = z.infer<typeof TimeOffSchema>;

/**
 * Low-level descriptor for the `time-off` rule.
 *
 * @category Rules
 */
export const timeOffRuleDescriptor = defineRuleDescriptor({
  name: "time-off",
  schema: TimeOffSchema,
  compile(config, ctx) {
    const { priority, startTime, endTime } = config;
    const fullDayStart: TimeOfDay = { hours: 0, minutes: 0 };
    const fullDayEnd: TimeOfDay = { hours: 23, minutes: 59 };
    const timeWindowStart = startTime ?? fullDayStart;
    const timeWindowEnd = endTime ?? fullDayEnd;

    const entityScopeValue = parseEntityScope(config);
    const timeScopeValue = parseTimeScope(config);
    const group = ruleGroup("time-off", "Time off", entityScopeValue, timeScopeValue);
    const targetMembers = resolveMembersFromScope(entityScopeValue, [...ctx.members]);
    const activeDays = resolveActiveDaysFromScope(timeScopeValue, [...ctx.days]);
    const timeWindowKey = formatTimeWindowKey(timeWindowStart, timeWindowEnd);

    const constraintArtifacts: RuleArtifact[] = [];
    for (const member of targetMembers) {
      for (const day of activeDays) {
        const overlappingVars = ctx.shiftPatterns
          .filter(
            (pattern) =>
              canAssignMemberToPattern(member, pattern) &&
              isPatternAvailableOnDay(pattern, day) &&
              shiftOverlapsTimeWindow(pattern, timeWindowStart, timeWindowEnd),
          )
          .map((pattern) => assignmentVar(member.id, pattern.id, day.iso));

        if (overlappingVars.length === 0) continue;

        const description = buildTimeOffDescription(
          member.id,
          day.iso,
          timeWindowStart,
          timeWindowEnd,
        );
        const context = { memberIds: [member.id], days: [day.iso] };
        const constraintId = `time-off:${group.key}:${member.id}:${day.iso}:${timeWindowKey}`;
        const terms = overlappingVars.map((varName) => ({ var: varName, coeff: 1 }));

        if (priority === "MANDATORY") {
          constraintArtifacts.push({
            kind: "coverage-exclusion",
            group,
            memberId: member.id,
            day: day.iso,
            startTime: timeWindowStart,
            endTime: timeWindowEnd,
          });
          constraintArtifacts.push(
            hardConstraint({
              group,
              description,
              context,
              validation: reportValidation(constraintId),
              terms,
              comparator: "<=",
              targetValue: 0,
            }),
          );
        } else {
          constraintArtifacts.push(
            softConstraint({
              group,
              description,
              context,
              validation: reportValidation(),
              terms,
              comparator: "<=",
              targetValue: 0,
              penalty: priorityToPenalty(priority),
              constraintId,
            }),
          );
        }
      }
    }

    const postSolveValidator =
      priority === "MANDATORY"
        ? []
        : [
            {
              kind: "post-solve-feedback" as const,
              run(
                assignments: readonly ResolvedShiftAssignment[],
                reporter: ValidationReporter,
                validationContext: RuleCompileContext,
              ) {
                const validatorMembers = resolveMembersFromScope(entityScopeValue, [
                  ...validationContext.members,
                ]);
                const validatorDays = resolveActiveDaysFromScope(timeScopeValue, [
                  ...validationContext.days,
                ]);

                for (const member of validatorMembers) {
                  for (const day of validatorDays) {
                    const violated = assignments.some(
                      (assignment) =>
                        assignment.memberId === member.id &&
                        assignment.day === day.iso &&
                        assignmentOverlapsTimeWindow(assignment, timeWindowStart, timeWindowEnd),
                    );

                    if (violated) {
                      continue;
                    }

                    reporter.reportRulePassed({
                      rule: "time-off",
                      message: `Time-off honored for ${member.id} on ${day.iso}`,
                      context: { memberIds: [member.id], days: [day.iso] },
                      group,
                    });
                  }
                }
              },
            },
          ];

    return {
      rule: "time-off",
      artifacts: [...constraintArtifacts, ...postSolveValidator],
    };
  },
});

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
  assignment: { startTime: TimeOfDay; endTime: TimeOfDay },
  windowStart: TimeOfDay,
  windowEnd: TimeOfDay,
): boolean {
  const assignStart = timeOfDayToMinutes(assignment.startTime);
  const assignEnd = normalizeEndMinutes(assignStart, timeOfDayToMinutes(assignment.endTime));

  const winStart = timeOfDayToMinutes(windowStart);
  const winEnd = normalizeEndMinutes(winStart, timeOfDayToMinutes(windowEnd));

  return Math.max(assignStart, winStart) < Math.min(assignEnd, winEnd);
}

function buildTimeOffDescription(
  memberId: string,
  dayIso: string,
  windowStart: TimeOfDay,
  windowEnd: TimeOfDay,
): string {
  return `Time off for ${memberId} on ${dayIso} (${formatTimeWindowKey(windowStart, windowEnd)})`;
}

function formatTimeWindowKey(windowStart: TimeOfDay, windowEnd: TimeOfDay): string {
  return `${formatTimeOfDay(windowStart)}-${formatTimeOfDay(windowEnd)}`;
}

function formatTimeOfDay(time: TimeOfDay): string {
  return `${time.hours.toString().padStart(2, "0")}:${time.minutes.toString().padStart(2, "0")}`;
}
