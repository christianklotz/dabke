import * as z from "zod";
import type { CompilationRule } from "../model-builder.js";
import { priorityToPenalty } from "../utils.js";
import { withScopes } from "./scoping.js";

const MaxConsecutiveDaysSchema = withScopes(
  z.object({
    days: z.number().min(0),
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
 * Configuration for {@link createMaxConsecutiveDaysRule}.
 *
 * - `days` (required): maximum consecutive days allowed
 * - `priority` (required): how strictly the solver enforces this rule
 *
 * Also accepts all fields from {@link ScopeConfig} for entity scoping.
 */
export type MaxConsecutiveDaysConfig = z.infer<typeof MaxConsecutiveDaysSchema>;

/**
 * Limits how many consecutive days a person can be assigned.
 *
 * @param config - See {@link MaxConsecutiveDaysConfig}
 * @example
 * ```ts
 * const rule = createMaxConsecutiveDaysRule({
 *   days: 5,
 *   priority: "MANDATORY",
 * });
 * builder = new ModelBuilder({ ...config, rules: [rule] });
 * ```
 */
export function createMaxConsecutiveDaysRule(config: MaxConsecutiveDaysConfig): CompilationRule {
  const { days, priority, employeeIds } = MaxConsecutiveDaysSchema.parse(config);
  const windowSize = days + 1;

  return {
    compile(b) {
      const employees = employeeIds
        ? b.employees.filter((e) => employeeIds.includes(e.id))
        : b.employees;

      for (const emp of employees) {
        for (let i = 0; i <= b.days.length - windowSize; i++) {
          const windowDays = b.days.slice(i, i + windowSize);

          const worksDayVars: string[] = [];
          for (const day of windowDays) {
            const worksVar = b.boolVar(`works_${emp.id}_${day}`);
            worksDayVars.push(worksVar);

            const dayAssignments = b.shiftPatterns
              .filter((p) => b.canAssign(emp, p) && b.patternAvailableOnDay(p, day))
              .map((p) => b.assignment(emp.id, p.id, day));

            if (dayAssignments.length === 0) {
              b.addLinear([{ var: worksVar, coeff: 1 }], "==", 0);
            } else {
              for (const assignVar of dayAssignments) {
                b.addLinear(
                  [
                    { var: worksVar, coeff: 1 },
                    { var: assignVar, coeff: -1 },
                  ],
                  ">=",
                  0,
                );
              }
              b.addLinear(
                [
                  { var: worksVar, coeff: 1 },
                  ...dayAssignments.map((v) => ({ var: v, coeff: -1 })),
                ],
                "<=",
                0,
              );
            }
          }

          if (priority === "MANDATORY") {
            b.addLinear(
              worksDayVars.map((v) => ({ var: v, coeff: 1 })),
              "<=",
              days,
            );
          } else {
            b.addSoftLinear(
              worksDayVars.map((v) => ({ var: v, coeff: 1 })),
              "<=",
              days,
              priorityToPenalty(priority),
            );
          }
        }
      }
    },
  };
}
