import * as z from "zod";
import { DayOfWeekSchema } from "../../types.js";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import { priorityToPenalty, splitIntoWeeks } from "../utils.js";
import {
  entityScope,
  parseEntityScope,
  resolveMembersFromScope,
  ruleGroup,
} from "./scope.types.js";
import { assignmentTermsForDays } from "./assignment-terms.js";
import { reportValidation, softConstraint } from "./artifacts.js";

/** Internally always HIGH. Not user-configurable. */
const MUST_ASSIGN_PENALTY = priorityToPenalty("HIGH");

export const MustAssignSchema = z
  .object({
    weekStartsOn: DayOfWeekSchema.optional(),
  })
  .and(entityScope(["members", "roles", "skills"]));

/**
 * Configuration for {@link mustAssignRuleDescriptor}.
 */
export type MustAssignConfig = z.infer<typeof MustAssignSchema>;

export const mustAssignRuleDescriptor = defineRuleDescriptor({
  name: "must-assign",
  schema: MustAssignSchema,
  compile(config, ctx) {
    const scope = parseEntityScope(config);
    const { weekStartsOn } = config;
    const group = ruleGroup("must-assign", "Must assign", scope);
    const members = resolveMembersFromScope(scope, [...ctx.members]);
    const weeks = splitIntoWeeks([...ctx.days], weekStartsOn ?? ctx.weekStartsOn);

    const artifacts = members.flatMap((member) =>
      weeks.flatMap((weekDays) => {
        const weekStart = weekDays[0];
        if (!weekStart) return [];

        const terms = assignmentTermsForDays(member, weekDays, ctx.shiftPatterns, () => 1);
        if (terms.length === 0) return [];

        const description = `${member.id} not assigned in week starting ${weekStart.iso} (staffing obligation)`;
        const context = { memberIds: [member.id], days: weekDays.map((day) => day.iso) };
        const constraintId = `must-assign:${member.id}:${weekStart.iso}`;

        return [
          softConstraint({
            group,
            description,
            context,
            validation: reportValidation(),
            terms,
            comparator: ">=",
            targetValue: 1,
            penalty: MUST_ASSIGN_PENALTY,
            constraintId,
          }),
        ];
      }),
    );

    return {
      rule: "must-assign",
      artifacts,
    };
  },
});
