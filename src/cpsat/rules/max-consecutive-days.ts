import * as z from "zod";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import { priorityToPenalty } from "../utils.js";
import {
  PrioritySchema,
  entityScope,
  parseEntityScope,
  resolveMembersFromScope,
  ruleGroup,
} from "./scope.types.js";
import { assignmentVarsForDay } from "./assignment-terms.js";
import { hardConstraint, reportValidation, softConstraint } from "./artifacts.js";
import { buildAssignedDayIndicator } from "./assigned-day.js";

export const MaxConsecutiveDaysSchema = z
  .object({
    days: z.number().min(0),
    priority: PrioritySchema,
  })
  .and(entityScope(["members", "roles", "skills"]));

/**
 * Configuration for {@link maxConsecutiveDaysRuleDescriptor}.
 */
export type MaxConsecutiveDaysConfig = z.infer<typeof MaxConsecutiveDaysSchema>;

/**
 * Low-level descriptor for the `max-consecutive-days` rule.
 *
 * @remarks
 * This rule limits the length of each assignment streak by counting assigned
 * days in every sliding window of `days + 1` days.
 *
 * @category Rules
 */
export const maxConsecutiveDaysRuleDescriptor = defineRuleDescriptor({
  name: "max-consecutive-days",
  schema: MaxConsecutiveDaysSchema,
  compile(config, ctx) {
    const scope = parseEntityScope(config);
    const { days, priority } = config;
    const windowSize = days + 1;
    const group = ruleGroup(`max-consecutive-days:${days}`, `Max ${days} consecutive days`, scope);
    const members = resolveMembersFromScope(scope, [...ctx.members]);

    const artifacts = members.flatMap((member) => {
      const supportArtifacts = ctx.days.flatMap(
        (day) =>
          buildAssignedDayIndicator({
            memberId: member.id,
            day,
            assignmentVars: assignmentVarsForDay(member, day, ctx.shiftPatterns),
            variableName: `assigned_${member.id}_${day.iso}`,
          }).artifacts,
      );

      const windowArtifacts = Array.from(
        { length: Math.max(0, ctx.days.length - windowSize + 1) },
        (_, index) => {
          const windowDays = ctx.days.slice(index, index + windowSize);
          const windowStart = windowDays[0]!;
          const terms = windowDays.map((day) => ({
            var: `assigned_${member.id}_${day.iso}`,
            coeff: 1,
          }));
          const description = `${member.id} max ${days} consecutive days from ${windowStart.iso}`;
          const context = { memberIds: [member.id], days: windowDays.map((day) => day.iso) };
          const constraintId = `max-consecutive-days:${member.id}:${windowStart.iso}`;

          return priority === "MANDATORY"
            ? hardConstraint({
                group,
                description,
                context,
                validation: reportValidation(constraintId),
                terms,
                comparator: "<=",
                targetValue: days,
              })
            : softConstraint({
                group,
                description,
                context,
                validation: reportValidation(),
                terms,
                comparator: "<=",
                targetValue: days,
                penalty: priorityToPenalty(priority),
                constraintId,
              });
        },
      );

      return supportArtifacts.concat(windowArtifacts);
    });

    return {
      rule: "max-consecutive-days",
      artifacts,
    };
  },
});
