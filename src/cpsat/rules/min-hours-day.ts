import * as z from "zod";
import type { CompilationRule } from "../model-builder.js";
import type { Term } from "../types.js";
import { priorityToPenalty } from "../utils.js";
import { entityScope, parseEntityScope, resolveEmployeesFromScope } from "./scope.types.js";

const MinHoursDaySchema = z
  .object({
    hours: z.number().min(0),
    priority: z.union([
      z.literal("LOW"),
      z.literal("MEDIUM"),
      z.literal("HIGH"),
      z.literal("MANDATORY"),
    ]),
  })
  .and(entityScope(["employees", "roles", "skills"]));

/**
 * Configuration for {@link createMinHoursDayRule}.
 *
 * - `hours` (required): minimum hours required per day when scheduled
 * - `priority` (required): how strictly the solver enforces this rule
 *
 * Entity scoping (at most one): `employeeIds`, `roleIds`, `skillIds`
 */
export type MinHoursDayConfig = z.infer<typeof MinHoursDaySchema>;

/**
 * Ensures a person works at least a minimum number of hours per day.
 *
 * @param config - See {@link MinHoursDayConfig}
 * @example
 * ```ts
 * createMinHoursDayRule({ hours: 6, priority: "MANDATORY" });
 * ```
 */
export function createMinHoursDayRule(config: MinHoursDayConfig): CompilationRule {
  const parsed = MinHoursDaySchema.parse(config);
  const scope = parseEntityScope(parsed);
  const { hours, priority } = parsed;
  const minMinutes = hours * 60;

  return {
    compile(b) {
      if (hours <= 0) return;

      const employees = resolveEmployeesFromScope(scope, b.employees);

      for (const emp of employees) {
        for (const day of b.days) {
          const terms: Term[] = [];
          for (const pattern of b.shiftPatterns) {
            if (!b.canAssign(emp, pattern)) continue;
            if (!b.patternAvailableOnDay(pattern, day)) continue;
            terms.push({
              var: b.assignment(emp.id, pattern.id, day),
              coeff: b.patternDuration(pattern.id),
            });
          }

          if (terms.length === 0) continue;

          if (priority === "MANDATORY") {
            b.addLinear(terms, ">=", minMinutes);
          } else {
            b.addSoftLinear(terms, ">=", minMinutes, priorityToPenalty(priority));
          }
        }
      }
    },
  };
}
