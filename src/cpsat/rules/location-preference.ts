import * as z from "zod";
import type { CompilationRule } from "../model-builder.js";
import type { Priority } from "../types.js";
import { OBJECTIVE_WEIGHTS } from "../utils.js";
import { withScopes } from "./scoping.js";

const LocationPreferenceSchema = withScopes(
  z.object({
    locationId: z.string(),
    priority: z.union([
      z.literal("LOW"),
      z.literal("MEDIUM"),
      z.literal("HIGH"),
      z.literal("MANDATORY"),
    ]),
  }),
  { entities: ["employees", "roles", "skills"], times: [] },
);

/**
 * Configuration for {@link createLocationPreferenceRule}.
 *
 * - `locationId` (required): the location ID to prefer for matching shift patterns
 * - `priority` (required): how strongly to prefer this location
 *
 * Also accepts all fields from {@link ScopeConfig} for entity scoping.
 */
export type LocationPreferenceConfig = z.infer<typeof LocationPreferenceSchema>;

const PRIORITY_WEIGHTS: Record<Priority, number> = {
  LOW: OBJECTIVE_WEIGHTS.FAIRNESS, // 5 - same as fairness, weak preference
  MEDIUM: OBJECTIVE_WEIGHTS.ASSIGNMENT_PREFERENCE, // 10 - standard preference
  HIGH: OBJECTIVE_WEIGHTS.ASSIGNMENT_PREFERENCE * 2.5, // 25 - strong preference
  MANDATORY: OBJECTIVE_WEIGHTS.ASSIGNMENT_PREFERENCE * 5, // 50 - very strong
};

/**
 * Prefers assigning a person to shift patterns matching a specific location.
 *
 * @param config - See {@link LocationPreferenceConfig}
 * @example
 * ```ts
 * const rule = createLocationPreferenceRule({
 *   locationId: "terrace",
 *   priority: "HIGH",
 *   employeeIds: ["alice"],
 * });
 * builder = new ModelBuilder({ ...config, rules: [rule] });
 * ```
 */
export function createLocationPreferenceRule(config: LocationPreferenceConfig): CompilationRule {
  const { locationId, priority, employeeIds } = LocationPreferenceSchema.parse(config);
  const weight = PRIORITY_WEIGHTS[priority] ?? 0;

  return {
    compile(b) {
      if (weight === 0) return;

      const employees = employeeIds
        ? b.employees.filter((e) => employeeIds.includes(e.id))
        : b.employees;

      for (const emp of employees) {
        for (const pattern of b.shiftPatterns) {
          if (!b.canAssign(emp, pattern)) continue;
          const isPreferred = pattern.locationId === locationId;
          if (isPreferred) continue;

          for (const day of b.days) {
            if (!b.patternAvailableOnDay(pattern, day)) continue;
            b.addPenalty(b.assignment(emp.id, pattern.id, day), weight);
          }
        }
      }
    },
  };
}
