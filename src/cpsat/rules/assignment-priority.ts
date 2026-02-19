import * as z from "zod";
import type { CompilationRule } from "../model-builder.js";
import { OBJECTIVE_WEIGHTS } from "../utils.js";
import {
  entityScope,
  timeScope,
  parseEntityScope,
  parseTimeScope,
  resolveMembersFromScope,
  resolveActiveDaysFromScope,
} from "./scope.types.js";

const AssignmentPrioritySchema = z
  .object({
    preference: z.union([z.literal("high"), z.literal("low")]),
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/**
 * Configuration for {@link createAssignmentPriorityRule}.
 *
 * - `preference` (required): `"high"` to prefer assigning or `"low"` to avoid assigning
 *
 * Entity scoping (at most one): `memberIds`, `roleIds`, `skillIds`
 * Time scoping (at most one, optional): `dateRange`, `specificDates`, `dayOfWeek`, `recurringPeriods`
 */
export type AssignmentPriorityConfig = z.infer<typeof AssignmentPrioritySchema>;

/**
 * Adds objective weight to prefer or avoid assigning team members.
 *
 * @param config - See {@link AssignmentPriorityConfig}
 * @example Prefer specific team members
 * ```ts
 * createAssignmentPriorityRule({
 *   memberIds: ["alice", "bob"],
 *   preference: "high",
 * });
 * ```
 *
 * @example Avoid assigning students on weekdays
 * ```ts
 * createAssignmentPriorityRule({
 *   roleIds: ["student"],
 *   dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
 *   preference: "low",
 * });
 * ```
 */
export function createAssignmentPriorityRule(config: AssignmentPriorityConfig): CompilationRule {
  const parsed = AssignmentPrioritySchema.parse(config);
  const { preference } = parsed;
  const entityScopeValue = parseEntityScope(parsed);
  const timeScopeValue = parseTimeScope(parsed);

  return {
    compile(b) {
      const targetMembers = resolveMembersFromScope(entityScopeValue, b.members);
      const activeDays = resolveActiveDaysFromScope(timeScopeValue, b.days);

      if (targetMembers.length === 0 || activeDays.length === 0) return;

      const weight =
        preference === "high"
          ? -OBJECTIVE_WEIGHTS.ASSIGNMENT_PREFERENCE
          : OBJECTIVE_WEIGHTS.ASSIGNMENT_PREFERENCE;

      for (const member of targetMembers) {
        for (const pattern of b.shiftPatterns) {
          if (!b.canAssign(member, pattern)) continue;
          for (const day of activeDays) {
            if (!b.patternAvailableOnDay(pattern, day)) continue;
            b.addPenalty(b.assignment(member.id, pattern.id, day), weight);
          }
        }
      }
    },
  };
}
