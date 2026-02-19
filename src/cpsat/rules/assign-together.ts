import * as z from "zod";
import type { CompilationRule } from "../model-builder.js";
import { priorityToPenalty } from "../utils.js";

const AssignTogetherSchema = z.object({
  groupMemberIds: z
    .tuple([z.string(), z.string()])
    .rest(z.string())
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "IDs must be unique",
    }),
  priority: z.union([
    z.literal("LOW"),
    z.literal("MEDIUM"),
    z.literal("HIGH"),
    z.literal("MANDATORY"),
  ]),
});

/**
 * Configuration for {@link createAssignTogetherRule}.
 *
 * - `groupMemberIds` (required): member IDs to assign together (at least two, must be unique)
 * - `priority` (required): how strictly the solver enforces this rule
 */
export type AssignTogetherConfig = z.infer<typeof AssignTogetherSchema>;

/**
 * Encourages or enforces that team members in the group work the same shift patterns on a day.
 * For each pair of team members in the group, ensures they are assigned to the same shifts.
 *
 * @param config - See {@link AssignTogetherConfig}
 * @example
 * ```ts
 * const rule = createAssignTogetherRule({
 *   groupMemberIds: ["alice", "bob", "charlie"],
 *   priority: "HIGH",
 * });
 * builder = new ModelBuilder({ ...config, rules: [rule] });
 * ```
 */
export function createAssignTogetherRule(config: AssignTogetherConfig): CompilationRule {
  const { groupMemberIds, priority } = AssignTogetherSchema.parse(config);

  return {
    compile(b) {
      const targetMembers = groupMemberIds
        .map((id) => b.members.find((m) => m.id === id))
        .filter((m): m is NonNullable<typeof m> => m !== undefined);

      if (targetMembers.length < 2) return;

      for (let i = 0; i < targetMembers.length - 1; i++) {
        const m1 = targetMembers[i]!;
        const m2 = targetMembers[i + 1]!;

        for (const pattern of b.shiftPatterns) {
          const canAssign1 = b.canAssign(m1, pattern);
          const canAssign2 = b.canAssign(m2, pattern);
          if (!canAssign1 || !canAssign2) continue;

          for (const day of b.days) {
            if (!b.patternAvailableOnDay(pattern, day)) continue;
            const var1 = b.assignment(m1.id, pattern.id, day);
            const var2 = b.assignment(m2.id, pattern.id, day);

            if (priority === "MANDATORY") {
              b.addLinear(
                [
                  { var: var1, coeff: 1 },
                  { var: var2, coeff: -1 },
                ],
                "==",
                0,
              );
            } else {
              const diffVar = b.boolVar(`together_diff_${m1.id}_${m2.id}_${pattern.id}_${day}`);
              b.addLinear(
                [
                  { var: diffVar, coeff: 1 },
                  { var: var1, coeff: -1 },
                  { var: var2, coeff: 1 },
                ],
                ">=",
                0,
              );
              b.addLinear(
                [
                  { var: diffVar, coeff: 1 },
                  { var: var1, coeff: 1 },
                  { var: var2, coeff: -1 },
                ],
                ">=",
                0,
              );
              b.addPenalty(diffVar, priorityToPenalty(priority));
            }
          }
        }
      }
    },
  };
}
