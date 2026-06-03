import * as z from "zod";
import { DayOfWeekSchema } from "../../types.js";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import { priorityToPenalty, splitIntoWeeks } from "../utils.js";
import {
  entityScope,
  parseEntityScope,
  resolveMembersFromScope,
  ruleGroup,
  SoftPrioritySchema,
} from "./scope.types.js";
import { assignmentVarsForDay } from "./assignment-terms.js";
import { assignedDayVariableName } from "./variables.js";
import { reportValidation, softConstraint } from "./artifacts.js";
import { buildAssignedDayIndicator } from "./assigned-day.js";

const TargetDaysWeekBase = z.object({
  days: z.number().int().min(0),
  priority: SoftPrioritySchema.default("HIGH"),
  weekStartsOn: DayOfWeekSchema.optional(),
});

export const TargetDaysWeekSchema = TargetDaysWeekBase.and(
  entityScope(["members", "roles", "skills"]),
);

/**
 * Configuration for {@link targetDaysWeekRuleDescriptor}.
 */
export type TargetDaysWeekConfig = z.infer<typeof TargetDaysWeekSchema>;

/**
 * Low-level descriptor for the `target-days-week` rule.
 *
 * @remarks
 * Softly targets assigned days per scheduling week. Deviations in either
 * direction are penalized, so working fewer than the target or more than the
 * target both count as misses. Use this for stated weekly patterns like
 * "works a 4-day week" when that pattern should remain flexible.
 *
 * @category Rules
 */
export const targetDaysWeekRuleDescriptor = defineRuleDescriptor({
  name: "target-days-week",
  schema: TargetDaysWeekSchema,
  compile(config, ctx) {
    const scope = parseEntityScope(config);
    const { days, priority, weekStartsOn } = config;
    const group = ruleGroup(`target-days-week:${days}`, `Target ${days}d per week`, scope);
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

        const assignedDayVars = weekDays.map((day) => assignedDayVariableName(member.id, day.iso));

        const context = { memberIds: [member.id], days: weekDays.map((day) => day.iso) };
        const terms = assignedDayVars.map((varName) => ({ var: varName, coeff: 1 }));
        const penalty = priorityToPenalty(priority);

        return supportArtifacts.concat([
          softConstraint({
            group,
            description: `${member.id} target ${days}d per week starting ${weekStart.iso} (under)`,
            context,
            validation: reportValidation(),
            terms,
            comparator: ">=",
            targetValue: days,
            penalty,
            constraintId: `target-days-week:under:${member.id}:${weekStart.iso}`,
          }),
          softConstraint({
            group,
            description: `${member.id} target ${days}d per week starting ${weekStart.iso} (over)`,
            context,
            validation: reportValidation(),
            terms,
            comparator: "<=",
            targetValue: days,
            penalty,
            constraintId: `target-days-week:over:${member.id}:${weekStart.iso}`,
          }),
        ]);
      }),
    );

    return {
      rule: "target-days-week",
      artifacts,
    };
  },
});
