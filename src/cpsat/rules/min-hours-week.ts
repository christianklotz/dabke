import * as z from "zod";
import { DayOfWeekSchema } from "../../types.js";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import type { RuleArtifact } from "../rule-descriptor.js";
import { priorityToPenalty, splitIntoWeeks } from "../utils.js";
import {
  PrioritySchema,
  entityScope,
  parseEntityScope,
  resolveMembersFromScope,
  ruleGroup,
} from "./scope.types.js";
import { assignmentTermsForDays } from "./assignment-terms.js";
import { maxAssignableMinutesForDay, patternDurationMinutes } from "./pattern-time.js";
import { hardConstraint, reportValidation, softConstraint } from "./artifacts.js";

const MinHoursWeekBase = z.object({
  hours: z.number().min(0),
  priority: PrioritySchema,
  weekStartsOn: DayOfWeekSchema.optional(),
});

export const MinHoursWeekSchema = MinHoursWeekBase.and(entityScope(["members", "roles", "skills"]));

/**
 * Configuration for {@link minHoursWeekRuleDescriptor}.
 */
export type MinHoursWeekConfig = z.infer<typeof MinHoursWeekSchema>;

/**
 * Low-level descriptor for the `min-hours-week` rule.
 *
 * @category Rules
 */
export const minHoursWeekRuleDescriptor = defineRuleDescriptor({
  name: "min-hours-week",
  schema: MinHoursWeekSchema,
  compile(config, ctx) {
    const scope = parseEntityScope(config);
    const { hours, priority, weekStartsOn } = config;
    const minMinutes = hours * 60;
    const group = ruleGroup(`min-hours-week:${hours}`, `Min ${hours}h per week`, scope);
    const members = resolveMembersFromScope(scope, [...ctx.members]);
    const weeks = splitIntoWeeks([...ctx.days], weekStartsOn ?? ctx.weekStartsOn);

    const artifacts: RuleArtifact[] = [];
    for (const member of members) {
      for (const weekDays of weeks) {
        const weekStart = weekDays[0];
        if (!weekStart) continue;

        const terms = assignmentTermsForDays(
          member,
          weekDays,
          ctx.shiftPatterns,
          patternDurationMinutes,
        );
        if (terms.length === 0) continue;

        const description = `${member.id} min ${hours}h in week starting ${weekStart.iso}`;
        const context = { memberIds: [member.id], days: weekDays.map((day) => day.iso) };
        const constraintId = `min-hours-week:${member.id}:${weekStart.iso}`;

        if (priority === "MANDATORY") {
          artifacts.push(
            hardConstraint({
              group,
              description,
              context,
              validation: reportValidation(constraintId),
              terms,
              comparator: ">=",
              targetValue: minMinutes,
            }),
            {
              kind: "pre-solve-feedback",
              run(preSolveContext, reporter) {
                const maxMinutes = weekDays.reduce(
                  (total, day) =>
                    total + maxAssignableMinutesForDay(member, day, preSolveContext.shiftPatterns),
                  0,
                );
                if (maxMinutes >= minMinutes) return;
                reporter.reportRuleError({
                  rule: "min-hours-week",
                  message: `${member.id} cannot reach ${hours}h in week starting ${weekStart.iso}; maximum possible is ${Math.round((maxMinutes / 60) * 10) / 10}h.`,
                  context,
                  suggestions: [
                    `Reduce the weekly minimum for ${member.id}`,
                    `Add longer or additional shifts in the week starting ${weekStart.iso}`,
                  ],
                  group,
                });
              },
            },
          );
        } else {
          artifacts.push(
            softConstraint({
              group,
              description,
              context,
              validation: reportValidation(),
              terms,
              comparator: ">=",
              targetValue: minMinutes,
              penalty: priorityToPenalty(priority),
              constraintId,
            }),
          );
        }
      }
    }

    return {
      rule: "min-hours-week",
      artifacts,
    };
  },
});
