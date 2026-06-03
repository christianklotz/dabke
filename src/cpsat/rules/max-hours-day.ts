import * as z from "zod";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import { priorityToPenalty } from "../utils.js";
import {
  PrioritySchema,
  entityScope,
  parseEntityScope,
  parseTimeScope,
  resolveActiveDaysFromScope,
  resolveMembersFromScope,
  ruleGroup,
  timeScope,
} from "./scope.types.js";
import { assignmentTermsForDay } from "./assignment-terms.js";
import { patternDurationMinutes } from "./pattern-time.js";
import { hardConstraint, reportValidation, softConstraint } from "./artifacts.js";

export const MaxHoursDaySchema = z
  .object({
    hours: z.number().min(0),
    priority: PrioritySchema,
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/**
 * Configuration for {@link maxHoursDayRuleDescriptor}.
 */
export type MaxHoursDayConfig = z.infer<typeof MaxHoursDaySchema>;

/**
 * Low-level descriptor for the `max-hours-day` rule.
 *
 * @category Rules
 */
export const maxHoursDayRuleDescriptor = defineRuleDescriptor({
  name: "max-hours-day",
  schema: MaxHoursDaySchema,
  compile(config, ctx) {
    const entityScopeValue = parseEntityScope(config);
    const timeScopeValue = parseTimeScope(config);
    const { hours, priority } = config;
    const maxMinutes = hours * 60;
    const group = ruleGroup(
      `max-hours-day:${hours}`,
      `Max ${hours}h per day`,
      entityScopeValue,
      timeScopeValue,
    );
    const targetMembers = resolveMembersFromScope(entityScopeValue, [...ctx.members]);
    const activeDays = resolveActiveDaysFromScope(timeScopeValue, [...ctx.days]);

    const artifacts = targetMembers.flatMap((member) =>
      activeDays.flatMap((day) => {
        const terms = assignmentTermsForDay(member, day, ctx.shiftPatterns, patternDurationMinutes);
        if (terms.length === 0) return [];

        const description = `${member.id} max ${hours}h on ${day.iso}`;
        const context = { memberIds: [member.id], days: [day.iso] };
        const constraintId = `max-hours-day:${member.id}:${day.iso}`;

        return [
          priority === "MANDATORY"
            ? hardConstraint({
                group,
                description,
                context,
                validation: reportValidation(constraintId),
                terms,
                comparator: "<=",
                targetValue: maxMinutes,
              })
            : softConstraint({
                group,
                description,
                context,
                validation: reportValidation(),
                terms,
                comparator: "<=",
                targetValue: maxMinutes,
                penalty: priorityToPenalty(priority),
                constraintId,
              }),
        ];
      }),
    );

    return {
      rule: "max-hours-day",
      artifacts,
    };
  },
});
