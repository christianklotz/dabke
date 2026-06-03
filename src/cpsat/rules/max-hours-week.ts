import * as z from "zod";
import { DayOfWeekSchema } from "../../types.js";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import { priorityToPenalty, splitIntoWeeks } from "../utils.js";
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
import { assignmentTermsForDays } from "./assignment-terms.js";
import { patternDurationMinutes } from "./pattern-time.js";
import { hardConstraint, reportValidation, softConstraint } from "./artifacts.js";

const MaxHoursWeekBase = z.object({
  hours: z.number().min(0),
  priority: PrioritySchema,
  weekStartsOn: DayOfWeekSchema.optional(),
});

export const MaxHoursWeekSchema = MaxHoursWeekBase.and(
  entityScope(["members", "roles", "skills"]),
).and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/**
 * Configuration for {@link maxHoursWeekRuleDescriptor}.
 */
export type MaxHoursWeekConfig = z.infer<typeof MaxHoursWeekSchema>;

/**
 * Low-level descriptor for the `max-hours-week` rule.
 *
 * @category Rules
 */
export const maxHoursWeekRuleDescriptor = defineRuleDescriptor({
  name: "max-hours-week",
  schema: MaxHoursWeekSchema,
  compile(config, ctx) {
    const entityScopeValue = parseEntityScope(config);
    const timeScopeValue = parseTimeScope(config);
    const { hours, priority, weekStartsOn } = config;
    const maxMinutes = hours * 60;
    const group = ruleGroup(
      `max-hours-week:${hours}`,
      `Max ${hours}h per week`,
      entityScopeValue,
      timeScopeValue,
    );
    const targetMembers = resolveMembersFromScope(entityScopeValue, [...ctx.members]);
    const activeDays = resolveActiveDaysFromScope(timeScopeValue, [...ctx.days]);
    const weeks = splitIntoWeeks(activeDays, weekStartsOn ?? ctx.weekStartsOn);

    const artifacts = targetMembers.flatMap((member) =>
      weeks.flatMap((weekDays) => {
        const weekStart = weekDays[0];
        if (!weekStart) return [];

        const terms = assignmentTermsForDays(
          member,
          weekDays,
          ctx.shiftPatterns,
          patternDurationMinutes,
        );
        if (terms.length === 0) return [];

        const description = `${member.id} max ${hours}h in week starting ${weekStart.iso}`;
        const context = { memberIds: [member.id], days: weekDays.map((day) => day.iso) };
        const constraintId = `max-hours-week:${member.id}:${weekStart.iso}`;

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
      rule: "max-hours-week",
      artifacts,
    };
  },
});
