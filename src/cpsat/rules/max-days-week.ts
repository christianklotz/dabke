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
import { assignmentVarsForDay } from "./assignment-terms.js";
import { assignedDayVariableName } from "./variables.js";
import { hardConstraint, reportValidation, softConstraint } from "./artifacts.js";
import { buildAssignedDayIndicator } from "./assigned-day.js";

const MaxDaysWeekBase = z.object({
  days: z.number().int().min(0),
  priority: PrioritySchema,
  weekStartsOn: DayOfWeekSchema.optional(),
});

export const MaxDaysWeekSchema = MaxDaysWeekBase.and(
  entityScope(["members", "roles", "skills"]),
).and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/**
 * Configuration for {@link maxDaysWeekRuleDescriptor}.
 */
export type MaxDaysWeekConfig = z.infer<typeof MaxDaysWeekSchema>;

/**
 * Low-level descriptor for the `max-days-week` rule.
 *
 * @remarks
 * This rule counts assigned days, not assigned shifts. Multiple assignments on
 * the same day still count as one assigned day.
 *
 * @category Rules
 */
export const maxDaysWeekRuleDescriptor = defineRuleDescriptor({
  name: "max-days-week",
  schema: MaxDaysWeekSchema,
  compile(config, ctx) {
    const entityScopeValue = parseEntityScope(config);
    const timeScopeValue = parseTimeScope(config);
    const { days, priority, weekStartsOn } = config;
    const group = ruleGroup(
      `max-days-week:${days}`,
      `Max ${days}d per week`,
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

        const description = `${member.id} max ${days}d in week starting ${weekStart.iso}`;
        const context = { memberIds: [member.id], days: weekDays.map((day) => day.iso) };
        const constraintId = `max-days-week:${member.id}:${weekStart.iso}`;
        const terms = assignedDayVars.map((varName) => ({ var: varName, coeff: 1 }));

        const finalArtifact =
          priority === "MANDATORY"
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

        return supportArtifacts.concat(finalArtifact);
      }),
    );

    return {
      rule: "max-days-week",
      artifacts,
    };
  },
});
