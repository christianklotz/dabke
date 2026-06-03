import * as z from "zod";
import { DayOfWeekSchema } from "../../types.js";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import type { RuleCompileContext } from "../rule-descriptor.js";
import type { ValidationReporter } from "../validation-reporter.js";
import { priorityToPenalty, splitIntoWeeks } from "../utils.js";
import {
  PrioritySchema,
  entityScope,
  parseEntityScope,
  resolveMembersFromScope,
  ruleGroup,
} from "./scope.types.js";
import { assignmentVarsForDay } from "./assignment-terms.js";
import { hasAnyAssignablePattern } from "./pattern-eligibility.js";
import { assignedDayVariableName } from "./variables.js";
import { hardConstraint, reportValidation, softConstraint } from "./artifacts.js";
import { buildAssignedDayIndicator } from "./assigned-day.js";

const MinDaysWeekBase = z.object({
  days: z.number().int().min(0),
  priority: PrioritySchema,
  weekStartsOn: DayOfWeekSchema.optional(),
});

export const MinDaysWeekSchema = MinDaysWeekBase.and(entityScope(["members", "roles", "skills"]));

/**
 * Configuration for {@link minDaysWeekRuleDescriptor}.
 */
export type MinDaysWeekConfig = z.infer<typeof MinDaysWeekSchema>;

export const minDaysWeekRuleDescriptor = defineRuleDescriptor({
  name: "min-days-week",
  schema: MinDaysWeekSchema,
  compile(config, ctx) {
    const scope = parseEntityScope(config);
    const { days, priority, weekStartsOn } = config;
    const group = ruleGroup(`min-days-week:${days}`, `Min ${days}d per week`, scope);
    const members = resolveMembersFromScope(scope, [...ctx.members]);
    const weeks = splitIntoWeeks([...ctx.days], weekStartsOn ?? ctx.weekStartsOn);

    const artifacts = members.flatMap((member) =>
      weeks.flatMap((weekDays) => {
        const weekStart = weekDays[0];
        if (!weekStart) return [];

        const supportArtifacts = weekDays.flatMap(
          (day) =>
            buildAssignedDayIndicator({
              memberId: member.id,
              day,
              assignmentVars: assignmentVarsForDay(member, day, ctx.shiftPatterns),
            }).artifacts,
        );

        const assignedDayVars = weekDays
          .filter((day) => assignmentVarsForDay(member, day, ctx.shiftPatterns).length > 0)
          .map((day) => assignedDayVariableName(member.id, day.iso));
        if (assignedDayVars.length === 0) return supportArtifacts;

        const description = `${member.id} min ${days}d in week starting ${weekStart.iso}`;
        const context = { memberIds: [member.id], days: weekDays.map((day) => day.iso) };
        const constraintId = `min-days-week:${member.id}:${weekStart.iso}`;
        const terms = assignedDayVars.map((varName) => ({ var: varName, coeff: 1 }));

        const finalArtifacts =
          priority === "MANDATORY"
            ? [
                hardConstraint({
                  group,
                  description,
                  context,
                  validation: reportValidation(constraintId),
                  terms,
                  comparator: ">=",
                  targetValue: days,
                }),
                {
                  kind: "pre-solve-feedback" as const,
                  run(_preSolveContext: RuleCompileContext, reporter: ValidationReporter) {
                    const possibleDays = weekDays.filter((day) =>
                      hasAnyAssignablePattern(member, day, ctx.shiftPatterns),
                    ).length;
                    if (possibleDays >= days) return;
                    reporter.reportRuleError({
                      rule: "min-days-week",
                      message: `${member.id} cannot reach ${days} assigned days in week starting ${weekStart.iso}; only ${possibleDays} day${possibleDays === 1 ? " is" : "s are"} assignable.`,
                      context,
                      suggestions: [
                        `Reduce the weekly day minimum for ${member.id}`,
                        `Add more assignable days in the week starting ${weekStart.iso}`,
                      ],
                      group,
                    });
                  },
                },
              ]
            : [
                softConstraint({
                  group,
                  description,
                  context,
                  validation: reportValidation(),
                  terms,
                  comparator: ">=",
                  targetValue: days,
                  penalty: priorityToPenalty(priority),
                  constraintId,
                }),
              ];

        return supportArtifacts.concat(finalArtifacts);
      }),
    );

    return {
      rule: "min-days-week",
      artifacts,
    };
  },
});
