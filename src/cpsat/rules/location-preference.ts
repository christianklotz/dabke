import * as z from "zod";
import type { CompilationRule } from "../model-builder.js";
import type { Priority } from "../types.js";
import { OBJECTIVE_WEIGHTS } from "../utils.js";
import { entityScope, parseEntityScope, resolveEmployeesFromScope } from "./scope.types.js";

const LocationPreferenceSchema = z
  .object({
    locationId: z.string(),
    priority: z.union([
      z.literal("LOW"),
      z.literal("MEDIUM"),
      z.literal("HIGH"),
      z.literal("MANDATORY"),
    ]),
  })
  .and(entityScope(["employees", "roles", "skills"]));

/**
 * Configuration for {@link createLocationPreferenceRule}.
 *
 * - `locationId` (required): the location ID to prefer for matching shift patterns
 * - `priority` (required): how strongly to prefer this location
 *
 * Entity scoping (at most one): `employeeIds`, `roleIds`, `skillIds`
 */
export type LocationPreferenceConfig = z.infer<typeof LocationPreferenceSchema>;

const PRIORITY_WEIGHTS: Record<Priority, number> = {
  LOW: OBJECTIVE_WEIGHTS.FAIRNESS,
  MEDIUM: OBJECTIVE_WEIGHTS.ASSIGNMENT_PREFERENCE,
  HIGH: OBJECTIVE_WEIGHTS.ASSIGNMENT_PREFERENCE * 2.5,
  MANDATORY: OBJECTIVE_WEIGHTS.ASSIGNMENT_PREFERENCE * 5,
};

/**
 * Prefers assigning a person to shift patterns matching a specific location.
 *
 * @param config - See {@link LocationPreferenceConfig}
 * @example
 * ```ts
 * createLocationPreferenceRule({
 *   locationId: "terrace",
 *   priority: "HIGH",
 *   employeeIds: ["alice"],
 * });
 * ```
 */
export function createLocationPreferenceRule(config: LocationPreferenceConfig): CompilationRule {
  const parsed = LocationPreferenceSchema.parse(config);
  const scope = parseEntityScope(parsed);
  const { locationId } = parsed;
  const weight = PRIORITY_WEIGHTS[parsed.priority] ?? 0;

  return {
    compile(b) {
      if (weight === 0) return;

      const employees = resolveEmployeesFromScope(scope, b.employees);

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
