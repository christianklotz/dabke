import * as z from "zod";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import type { RuleArtifact } from "../rule-descriptor.js";
import { PREFERENCE_WEIGHTS } from "../utils.js";
import {
  PrioritySchema,
  entityScope,
  parseEntityScope,
  resolveMembersFromScope,
} from "./scope.types.js";
import { assignmentVar } from "./variables.js";
import { canAssignMemberToPattern, isPatternAvailableOnDay } from "./pattern-eligibility.js";

export const RolePreferenceSchema = z
  .object({
    roleId: z.string(),
    priority: PrioritySchema,
  })
  .and(entityScope(["members", "roles", "skills"]));

/**
 * Configuration for {@link rolePreferenceRuleDescriptor}.
 */
export type RolePreferenceConfig = z.infer<typeof RolePreferenceSchema>;

/**
 * Low-level descriptor for role preference rules.
 *
 * @category Rules
 */
export const rolePreferenceRuleDescriptor = defineRuleDescriptor({
  name: "role-preference",
  schema: RolePreferenceSchema,
  compile(config, ctx) {
    const scope = parseEntityScope(config);
    const { roleId } = config;
    const weight = PREFERENCE_WEIGHTS[config.priority as keyof typeof PREFERENCE_WEIGHTS] ?? 0;
    if (weight === 0) {
      return { rule: "role-preference", artifacts: [] };
    }

    const members = resolveMembersFromScope(scope, [...ctx.members]);
    if (members.length === 0) {
      return { rule: "role-preference", artifacts: [] };
    }

    const membersWithRole = members.filter((member) => member.roleIds.includes(roleId));
    const artifacts: RuleArtifact[] = [];

    if (membersWithRole.length === 0) {
      artifacts.push({
        kind: "pre-solve-feedback",
        run(_precheckContext, reporter) {
          const ids = members.map((member) => member.id).join(", ");
          reporter.reportRuleError({
            rule: "role-preference",
            message:
              `None of the targeted members (${ids}) have role "${roleId}". ` +
              `Add "${roleId}" to their roleIds, or remove this preferRole rule.`,
            context: { memberIds: members.map((member) => member.id) },
          });
        },
      });
      return { rule: "role-preference", artifacts };
    }

    const terms = membersWithRole.flatMap((member) =>
      ctx.shiftPatterns.flatMap((pattern) => {
        if (!canAssignMemberToPattern(member, pattern)) return [];
        if (pattern.roleIds?.includes(roleId)) return [];
        return ctx.days
          .filter((day) => isPatternAvailableOnDay(pattern, day))
          .map((day) => ({ var: assignmentVar(member.id, pattern.id, day.iso), coeff: weight }));
      }),
    );

    artifacts.push({
      kind: "objective",
      terms,
      validation: {
        strategy: "skip",
        category: "no-meaningful-feedback",
        rationale:
          terms.length === 0
            ? `Role preference for "${roleId}" produced no objective terms.`
            : "Preference rules influence the objective but do not emit validation feedback.",
      },
    });

    return { rule: "role-preference", artifacts };
  },
});
