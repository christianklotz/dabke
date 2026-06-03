import * as z from "zod";
import { schedulingDay, type DateString, type SchedulingDay } from "../../types.js";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import type { RuleArtifact, RuleCompileContext } from "../rule-descriptor.js";
import type { ValidationReporter } from "../validation-reporter.js";
import type { ResolvedShiftAssignment } from "../response.js";
import { normalizeEndMinutes, priorityToPenalty, timeOfDayToMinutes } from "../utils.js";
import {
  PrioritySchema,
  entityScope,
  parseEntityScope,
  resolveMembersFromScope,
  ruleGroup,
} from "./scope.types.js";
import { assignmentVar } from "./variables.js";
import { hardConstraint, reportValidation, softConstraint } from "./artifacts.js";
import { canAssignMemberToPattern, isPatternAvailableOnDay } from "./pattern-eligibility.js";

export const MinRestBetweenShiftsSchema = z
  .object({
    hours: z.number().min(0),
    priority: PrioritySchema,
  })
  .and(entityScope(["members", "roles", "skills"]));

/**
 * Configuration for {@link minRestBetweenShiftsRuleDescriptor}.
 */
export type MinRestBetweenShiftsConfig = z.infer<typeof MinRestBetweenShiftsSchema>;

/**
 * Low-level descriptor for the `min-rest-between-shifts` rule.
 *
 * @category Rules
 */
export const minRestBetweenShiftsRuleDescriptor = defineRuleDescriptor({
  name: "min-rest-between-shifts",
  schema: MinRestBetweenShiftsSchema,
  compile(config, ctx) {
    const scope = parseEntityScope(config);
    const { hours, priority } = config;
    const minMinutes = hours * 60;
    const group = ruleGroup(
      `min-rest-between-shifts:${hours}`,
      `Min ${hours}h rest between shifts`,
      scope,
    );
    const members = resolveMembersFromScope(scope, [...ctx.members]);

    const artifacts = members.flatMap((member) => {
      const memberArtifacts: RuleArtifact[] = [];

      for (let dayIndex = 0; dayIndex < ctx.days.length; dayIndex++) {
        const day1 = ctx.days[dayIndex];
        if (!day1) continue;

        const checkDays = [day1];
        const nextDay = ctx.days[dayIndex + 1];
        if (nextDay) checkDays.push(nextDay);

        for (const pattern1 of ctx.shiftPatterns) {
          if (
            !canAssignMemberToPattern(member, pattern1) ||
            !isPatternAvailableOnDay(pattern1, day1)
          ) {
            continue;
          }
          const end1 = patternEndMinutes(pattern1);

          for (const day2 of checkDays) {
            for (const pattern2 of ctx.shiftPatterns) {
              if (
                !canAssignMemberToPattern(member, pattern2) ||
                !isPatternAvailableOnDay(pattern2, day2) ||
                (day1.iso === day2.iso && pattern1.id === pattern2.id)
              ) {
                continue;
              }

              const start2 = dayGapMinutes(day1, day2) + timeOfDayToMinutes(pattern2.startTime);
              const gap = start2 - end1;
              if (gap < 0 || gap >= minMinutes) continue;

              const description = `${member.id} needs ${hours}h rest between ${pattern1.id} on ${day1.iso} and ${pattern2.id} on ${day2.iso}`;
              const context = { memberIds: [member.id], days: [day1.iso, day2.iso] };
              const constraintId = `min-rest-between-shifts:${member.id}:${pattern1.id}:${day1.iso}:${pattern2.id}:${day2.iso}`;
              const terms = [
                { var: assignmentVar(member.id, pattern1.id, day1.iso), coeff: 1 },
                { var: assignmentVar(member.id, pattern2.id, day2.iso), coeff: 1 },
              ];

              if (priority === "MANDATORY") {
                memberArtifacts.push(
                  hardConstraint({
                    group,
                    description,
                    context,
                    validation: reportValidation(constraintId),
                    terms,
                    comparator: "<=",
                    targetValue: 1,
                  }),
                );
              } else {
                memberArtifacts.push(
                  softConstraint({
                    group,
                    description,
                    context,
                    validation: reportValidation(),
                    terms,
                    comparator: "<=",
                    targetValue: 1,
                    penalty: priorityToPenalty(priority),
                    constraintId,
                  }),
                );
              }
            }
          }
        }
      }

      return memberArtifacts;
    });

    const validatorArtifacts =
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
                const validatorMembers = resolveMembersFromScope(scope, [
                  ...validationContext.members,
                ]);
                if (validatorMembers.length === 0) return;

                const dayLookup = new Map<SchedulingDay["iso"], SchedulingDay>(
                  validationContext.days.map((day: SchedulingDay) => [day.iso, day] as const),
                );
                const memberIds = new Set(validatorMembers.map((member) => member.id));
                const byMember = new Map<string, ResolvedShiftAssignment[]>();

                for (const assignment of assignments) {
                  if (!memberIds.has(assignment.memberId)) continue;
                  const list = byMember.get(assignment.memberId) ?? [];
                  list.push(assignment);
                  byMember.set(assignment.memberId, list);
                }

                for (const [memberId, memberAssignments] of byMember) {
                  const sorted = [...memberAssignments].toSorted((left, right) => {
                    if (left.day !== right.day) return left.day < right.day ? -1 : 1;
                    return timeOfDayToMinutes(left.startTime) - timeOfDayToMinutes(right.startTime);
                  });

                  let violated = false;
                  for (let index = 0; index < sorted.length - 1; index++) {
                    const current = sorted[index]!;
                    const next = sorted[index + 1]!;
                    const currentEnd = normalizeEndMinutes(
                      timeOfDayToMinutes(current.startTime),
                      timeOfDayToMinutes(current.endTime),
                    );
                    const nextStart = timeOfDayToMinutes(next.startTime);
                    const gap =
                      current.day === next.day
                        ? nextStart - currentEnd
                        : daysBetween(current.day, next.day, dayLookup) * 24 * 60 -
                          currentEnd +
                          nextStart;

                    if (gap < 0 || gap >= minMinutes) continue;
                    violated = true;
                  }

                  if (!violated && sorted.length > 1) {
                    reporter.reportRulePassed({
                      rule: "min-rest-between-shifts",
                      message: `${memberId} has ${hours}h+ rest between all shifts`,
                      context: {
                        memberIds: [memberId],
                        days: [...new Set(sorted.map((assignment) => assignment.day))],
                      },
                      group,
                    });
                  }
                }
              },
            },
          ];

    return {
      rule: "min-rest-between-shifts",
      artifacts: [...artifacts, ...validatorArtifacts],
    };
  },
});

function patternEndMinutes(pattern: {
  startTime: { hours: number; minutes: number };
  endTime: { hours: number; minutes: number };
}): number {
  return normalizeEndMinutes(
    timeOfDayToMinutes(pattern.startTime),
    timeOfDayToMinutes(pattern.endTime),
  );
}

function dayGapMinutes(day1: SchedulingDay, day2: SchedulingDay): number {
  return (day2.epochDay - day1.epochDay) * 24 * 60;
}

function daysBetween(
  day1: DateString,
  day2: DateString,
  lookup: ReadonlyMap<DateString, SchedulingDay>,
): number {
  const left = lookup.get(day1);
  const right = lookup.get(day2);
  if (left && right) return right.epochDay - left.epochDay;
  return schedulingDay(day2).epochDay - schedulingDay(day1).epochDay;
}
