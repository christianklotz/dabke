import * as z from "zod";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import { priorityToPenalty } from "../utils.js";
import { PrioritySchema } from "./scope.types.js";
import { assignmentVar } from "./variables.js";
import { boolVariable, hardConstraint, reportValidation, skipValidation } from "./artifacts.js";
import { canAssignMemberToPattern, isPatternAvailableOnDay } from "./pattern-eligibility.js";

export const AssignTogetherSchema = z.object({
  groupMemberIds: z
    .tuple([z.string(), z.string()])
    .rest(z.string())
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "IDs must be unique",
    }),
  priority: PrioritySchema,
});

/**
 * Configuration for {@link assignTogetherRuleDescriptor}.
 */
export type AssignTogetherConfig = z.infer<typeof AssignTogetherSchema>;

/**
 * Low-level descriptor for the `assign-together` rule.
 *
 * @remarks
 * Register this in a custom rule registry when you need the descriptor API
 * directly instead of the high-level {@link assignTogether} helper.
 *
 * @category Rules
 */
export const assignTogetherRuleDescriptor = defineRuleDescriptor({
  name: "assign-together",
  schema: AssignTogetherSchema,
  compile(config, ctx) {
    const { groupMemberIds, priority } = config;
    const targetMembers = groupMemberIds
      .map((id: string) => ctx.members.find((member) => member.id === id))
      .filter((member): member is NonNullable<typeof member> => member !== undefined);

    if (targetMembers.length < 2) {
      return { rule: "assign-together", artifacts: [] };
    }

    const artifacts = targetMembers.flatMap((member, index) => {
      const next = targetMembers[index + 1];
      if (!next) return [];

      return ctx.shiftPatterns.flatMap((pattern) => {
        if (
          !canAssignMemberToPattern(member, pattern) ||
          !canAssignMemberToPattern(next, pattern)
        ) {
          return [];
        }

        return ctx.days.flatMap((day) => {
          if (!isPatternAvailableOnDay(pattern, day)) return [];

          const var1 = assignmentVar(member.id, pattern.id, day.iso);
          const var2 = assignmentVar(next.id, pattern.id, day.iso);
          const description = `${member.id} and ${next.id} stay together on ${pattern.id} for ${day.iso}`;
          const context = { memberIds: [member.id, next.id], days: [day.iso] };
          const constraintId = `assign-together:${member.id}:${next.id}:${pattern.id}:${day.iso}`;

          if (priority === "MANDATORY") {
            return [
              hardConstraint({
                description,
                context,
                validation: reportValidation(constraintId),
                terms: [
                  { var: var1, coeff: 1 },
                  { var: var2, coeff: -1 },
                ],
                comparator: "==",
                targetValue: 0,
              }),
            ];
          }

          const diffVar = `together_diff_${member.id}_${next.id}_${pattern.id}_${day.iso}`;
          return [
            boolVariable(diffVar),
            hardConstraint({
              description: `${diffVar} captures ${var1} without ${var2}`,
              validation: skipValidation(
                "scaffolding",
                "This helper variable measures pair mismatch so a soft pairing preference can be optimized without surfacing helper-level feedback.",
              ),
              context,
              terms: [
                { var: diffVar, coeff: 1 },
                { var: var1, coeff: -1 },
                { var: var2, coeff: 1 },
              ],
              comparator: ">=",
              targetValue: 0,
            }),
            hardConstraint({
              description: `${diffVar} captures ${var2} without ${var1}`,
              validation: skipValidation(
                "scaffolding",
                "This helper variable measures pair mismatch symmetrically so the objective can penalize either member being assigned alone.",
              ),
              context,
              terms: [
                { var: diffVar, coeff: 1 },
                { var: var1, coeff: 1 },
                { var: var2, coeff: -1 },
              ],
              comparator: ">=",
              targetValue: 0,
            }),
            {
              kind: "objective" as const,
              terms: [{ var: diffVar, coeff: Math.max(1, priorityToPenalty(priority) * 5) }],
              validation: skipValidation(
                "no-meaningful-feedback",
                "Pairing preferences influence the objective but do not emit validation feedback.",
              ),
            },
          ];
        });
      });
    });

    return {
      rule: "assign-together",
      artifacts,
    };
  },
});
