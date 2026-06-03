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
import { hardConstraint, reportValidation, softConstraint } from "./artifacts.js";

export const MaxShiftsDaySchema = z
  .object({
    shifts: z.number().int().min(1),
    priority: PrioritySchema,
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/**
 * Configuration for {@link maxShiftsDayRuleDescriptor}.
 */
export type MaxShiftsDayConfig = z.infer<typeof MaxShiftsDaySchema>;

/**
 * Low-level descriptor for the `max-shifts-day` rule.
 *
 * @remarks
 * This rule limits distinct assignments per day, regardless of their duration.
 * Use {@link maxHoursDayRuleDescriptor} to limit assigned time instead.
 *
 * @category Rules
 */
export const maxShiftsDayRuleDescriptor = defineRuleDescriptor({
  name: "max-shifts-day",
  schema: MaxShiftsDaySchema,
  compile(config, ctx) {
    const entityScopeValue = parseEntityScope(config);
    const timeScopeValue = parseTimeScope(config);
    const { shifts, priority } = config;
    const group = ruleGroup(
      `max-shifts-day:${shifts}`,
      `Max ${shifts} shift${shifts === 1 ? "" : "s"} per day`,
      entityScopeValue,
      timeScopeValue,
    );
    const targetMembers = resolveMembersFromScope(entityScopeValue, [...ctx.members]);
    const activeDays = resolveActiveDaysFromScope(timeScopeValue, [...ctx.days]);

    const artifacts = targetMembers.flatMap((member) =>
      activeDays.flatMap((day) => {
        const terms = assignmentTermsForDay(member, day, ctx.shiftPatterns, () => 1);
        if (terms.length === 0) return [];

        const description = `${member.id} max ${shifts} shift${shifts === 1 ? "" : "s"} on ${day.iso}`;
        const context = { memberIds: [member.id], days: [day.iso] };
        const constraintId = `max-shifts-day:${member.id}:${day.iso}`;

        return [
          priority === "MANDATORY"
            ? hardConstraint({
                group,
                description,
                context,
                validation: reportValidation(constraintId),
                terms,
                comparator: "<=",
                targetValue: shifts,
              })
            : softConstraint({
                group,
                description,
                context,
                validation: reportValidation(),
                terms,
                comparator: "<=",
                targetValue: shifts,
                penalty: priorityToPenalty(priority),
                constraintId,
              }),
        ];
      }),
    );

    return {
      rule: "max-shifts-day",
      artifacts,
    };
  },
});
