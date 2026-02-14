import * as z from "zod";
import type { CompilationRule } from "../model-builder.js";
import { OBJECTIVE_WEIGHTS } from "../utils.js";
import {
  entityScope,
  timeScope,
  parseEntityScope,
  parseTimeScope,
  resolveEmployeesFromScope,
  resolveActiveDaysFromScope,
} from "./scope.types.js";

const EmployeeAssignmentPrioritySchema = z
  .object({
    preference: z.union([z.literal("high"), z.literal("low")]),
  })
  .and(entityScope(["employees", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/**
 * Configuration for {@link createEmployeeAssignmentPriorityRule}.
 *
 * - `preference` (required): `"high"` to prefer assigning or `"low"` to avoid assigning
 *
 * Entity scoping (at most one): `employeeIds`, `roleIds`, `skillIds`
 * Time scoping (at most one, optional): `dateRange`, `specificDates`, `dayOfWeek`, `recurringPeriods`
 */
export type EmployeeAssignmentPriorityConfig = z.infer<typeof EmployeeAssignmentPrioritySchema>;

/**
 * Adds objective weight to prefer or avoid assigning team members.
 *
 * @param config - See {@link EmployeeAssignmentPriorityConfig}
 * @example Prefer specific team members
 * ```ts
 * createEmployeeAssignmentPriorityRule({
 *   employeeIds: ["alice", "bob"],
 *   preference: "high",
 * });
 * ```
 *
 * @example Avoid assigning students on weekdays
 * ```ts
 * createEmployeeAssignmentPriorityRule({
 *   roleIds: ["student"],
 *   dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
 *   preference: "low",
 * });
 * ```
 */
export function createEmployeeAssignmentPriorityRule(
  config: EmployeeAssignmentPriorityConfig,
): CompilationRule {
  const parsed = EmployeeAssignmentPrioritySchema.parse(config);
  const { preference } = parsed;
  const entityScopeValue = parseEntityScope(parsed);
  const timeScopeValue = parseTimeScope(parsed);

  return {
    compile(b) {
      const targetEmployees = resolveEmployeesFromScope(entityScopeValue, b.employees);
      const activeDays = resolveActiveDaysFromScope(timeScopeValue, b.days);

      if (targetEmployees.length === 0 || activeDays.length === 0) return;

      const weight =
        preference === "high"
          ? -OBJECTIVE_WEIGHTS.ASSIGNMENT_PREFERENCE
          : OBJECTIVE_WEIGHTS.ASSIGNMENT_PREFERENCE;

      for (const emp of targetEmployees) {
        for (const pattern of b.shiftPatterns) {
          if (!b.canAssign(emp, pattern)) continue;
          for (const day of activeDays) {
            if (!b.patternAvailableOnDay(pattern, day)) continue;
            b.addPenalty(b.assignment(emp.id, pattern.id, day), weight);
          }
        }
      }
    },
  };
}
