import * as z from "zod";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import type { RuleArtifact } from "../rule-descriptor.js";
import { priorityToPenalty } from "../utils.js";
import {
  PrioritySchema,
  entityScope,
  parseEntityScope,
  resolveMembersFromScope,
  ruleGroup,
} from "./scope.types.js";
import { assignmentTermsForDay } from "./assignment-terms.js";
import { maxAssignableMinutesForDay, patternDurationMinutes } from "./pattern-time.js";
import { hardConstraint, reportValidation, softConstraint } from "./artifacts.js";

export const MinHoursDaySchema = z
  .object({
    hours: z.number().min(0),
    priority: PrioritySchema,
  })
  .and(entityScope(["members", "roles", "skills"]));

/**
 * Configuration for {@link minHoursDayRuleDescriptor}.
 */
export type MinHoursDayConfig = z.infer<typeof MinHoursDaySchema>;

/**
 * Low-level descriptor for the `min-hours-day` rule.
 *
 * @category Rules
 */
export const minHoursDayRuleDescriptor = defineRuleDescriptor({
  name: "min-hours-day",
  schema: MinHoursDaySchema,
  compile(config, ctx) {
    const scope = parseEntityScope(config);
    const { hours, priority } = config;
    const minMinutes = hours * 60;
    const group = ruleGroup(`min-hours-day:${hours}`, `Min ${hours}h per day`, scope);
    const members = resolveMembersFromScope(scope, [...ctx.members]);

    const artifacts: RuleArtifact[] = [];
    for (const member of members) {
      for (const day of ctx.days) {
        const terms = assignmentTermsForDay(member, day, ctx.shiftPatterns, patternDurationMinutes);
        if (terms.length === 0) continue;

        const context = { memberIds: [member.id], days: [day.iso] };
        const constraintId = `min-hours-day:${member.id}:${day.iso}`;
        const description = `${member.id} min ${hours}h on ${day.iso}`;

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
                const maxMinutes = maxAssignableMinutesForDay(
                  member,
                  day,
                  preSolveContext.shiftPatterns,
                );
                if (maxMinutes >= minMinutes) return;
                reporter.reportRuleError({
                  rule: "min-hours-day",
                  message: `${member.id} cannot reach ${hours}h on ${day.iso}; maximum possible is ${Math.round((maxMinutes / 60) * 10) / 10}h.`,
                  context,
                  suggestions: [
                    `Reduce the daily minimum for ${member.id}`,
                    `Add a longer shift on ${day.iso}`,
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
      rule: "min-hours-day",
      artifacts,
    };
  },
});
