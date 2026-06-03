import * as z from "zod";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import { PREFERENCE_WEIGHTS } from "../utils.js";
import {
  PrioritySchema,
  entityScope,
  parseEntityScope,
  resolveMembersFromScope,
} from "./scope.types.js";
import { assignmentVar } from "./variables.js";
import { canAssignMemberToPattern, isPatternAvailableOnDay } from "./pattern-eligibility.js";

export const LocationPreferenceSchema = z
  .object({
    locationId: z.string(),
    priority: PrioritySchema,
  })
  .and(entityScope(["members", "roles", "skills"]));

/**
 * Configuration for {@link locationPreferenceRuleDescriptor}.
 */
export type LocationPreferenceConfig = z.infer<typeof LocationPreferenceSchema>;

/**
 * Low-level descriptor for location preference rules.
 *
 * @category Rules
 */
export const locationPreferenceRuleDescriptor = defineRuleDescriptor({
  name: "location-preference",
  schema: LocationPreferenceSchema,
  compile(config, ctx) {
    const scope = parseEntityScope(config);
    const { locationId } = config;
    const weight = PREFERENCE_WEIGHTS[config.priority as keyof typeof PREFERENCE_WEIGHTS] ?? 0;
    if (weight === 0) {
      return { rule: "location-preference", artifacts: [] };
    }

    const members = resolveMembersFromScope(scope, [...ctx.members]);
    const terms = members.flatMap((member) =>
      ctx.shiftPatterns.flatMap((pattern) => {
        if (!canAssignMemberToPattern(member, pattern)) return [];
        if (pattern.locationId === locationId) return [];
        return ctx.days
          .filter((day) => isPatternAvailableOnDay(pattern, day))
          .map((day) => ({ var: assignmentVar(member.id, pattern.id, day.iso), coeff: weight }));
      }),
    );

    return {
      rule: "location-preference",
      artifacts: [
        {
          kind: "objective",
          terms,
          validation: {
            strategy: "skip",
            category: "no-meaningful-feedback",
            rationale:
              terms.length === 0
                ? `Location preference for "${locationId}" produced no objective terms.`
                : "Preference rules influence the objective but do not emit validation feedback.",
          },
        },
      ],
    };
  },
});
