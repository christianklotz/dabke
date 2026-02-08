import * as z from "zod";
import type { CompilationRule } from "../model-builder.js";
import type { Term } from "../types.js";
import { priorityToPenalty } from "../utils.js";
import { withScopes } from "./scoping.js";

const MinHoursDaySchema = withScopes(
  z.object({
    hours: z.number().min(0),
    priority: z.union([
      z.literal("LOW"),
      z.literal("MEDIUM"),
      z.literal("HIGH"),
      z.literal("MANDATORY"),
    ]),
  }),
  { entities: ["employees", "roles", "skills"], times: [] },
);

export type MinHoursDayConfig = z.infer<typeof MinHoursDaySchema>;

/**
 * Ensures a person works at least a minimum number of hours per day.
 *
 * @example
 * ```ts
 * const rule = createMinHoursDayRule({
 *   hours: 6,
 *   priority: "MANDATORY",
 * });
 * builder = new ModelBuilder({ ...config, rules: [rule] });
 * ```
 */
export function createMinHoursDayRule(config: MinHoursDayConfig): CompilationRule {
  const { hours, priority, employeeIds } = MinHoursDaySchema.parse(config);
  const minMinutes = hours * 60;

  return {
    compile(b) {
      if (hours <= 0) return;

      const employees = employeeIds
        ? b.employees.filter((e) => employeeIds.includes(e.id))
        : b.employees;

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
