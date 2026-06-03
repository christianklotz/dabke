import * as z from "zod";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import { PREFERENCE_WEIGHTS } from "../utils.js";
import {
  PrioritySchema,
  entityScope,
  parseEntityScope,
  parseTimeScope,
  resolveActiveDaysFromScope,
  resolveMembersFromScope,
  timeScope,
} from "./scope.types.js";
import { skipValidation } from "./artifacts.js";
import { assignmentVar } from "./variables.js";
import { canAssignMemberToPattern, isPatternAvailableOnDay } from "./pattern-eligibility.js";

export const AssignmentPrioritySchema = z
  .object({
    preference: z.union([z.literal("prefer"), z.literal("avoid")]),
    priority: PrioritySchema.optional(),
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/**
 * Configuration for {@link assignmentPriorityRuleDescriptor}.
 */
export type AssignmentPriorityConfig = z.infer<typeof AssignmentPrioritySchema>;

/**
 * Low-level descriptor for assignment priority rules.
 *
 * @category Rules
 */
export const assignmentPriorityRuleDescriptor = defineRuleDescriptor({
  name: "assignment-priority",
  schema: AssignmentPrioritySchema,
  compile(config, ctx) {
    const { preference } = config;
    const priority = config.priority ?? "MANDATORY";
    const entityScopeValue = parseEntityScope(config);
    const timeScopeValue = parseTimeScope(config);
    const targetMembers = resolveMembersFromScope(entityScopeValue, [...ctx.members]);
    const activeDays = resolveActiveDaysFromScope(timeScopeValue, [...ctx.days]);
    const baseWeight = PREFERENCE_WEIGHTS[priority as keyof typeof PREFERENCE_WEIGHTS] ?? 0;
    if (targetMembers.length === 0 || activeDays.length === 0 || baseWeight === 0) {
      return { rule: "assignment-priority", artifacts: [] };
    }

    const weight = preference === "prefer" ? -baseWeight : baseWeight;
    const terms = targetMembers.flatMap((member) =>
      ctx.shiftPatterns.flatMap((pattern) => {
        if (!canAssignMemberToPattern(member, pattern)) return [];
        return activeDays
          .filter((day) => isPatternAvailableOnDay(pattern, day))
          .map((day) => ({ var: assignmentVar(member.id, pattern.id, day.iso), coeff: weight }));
      }),
    );

    return {
      rule: "assignment-priority",
      artifacts: [
        {
          kind: "objective",
          terms,
          validation: skipValidation(
            "no-meaningful-feedback",
            terms.length === 0
              ? "Assignment priority produced no objective terms for the selected scope."
              : "Preference rules influence the objective but do not emit validation feedback.",
          ),
        },
      ],
    };
  },
});
