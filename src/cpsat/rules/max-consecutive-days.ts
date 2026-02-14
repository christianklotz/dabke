import * as z from "zod";
import type { CompilationRule } from "../model-builder.js";
import { priorityToPenalty } from "../utils.js";
import { entityScope, parseEntityScope, resolveEmployeesFromScope } from "./scope.types.js";

const MaxConsecutiveDaysSchema = z
  .object({
    days: z.number().min(0),
    priority: z.union([
      z.literal("LOW"),
      z.literal("MEDIUM"),
      z.literal("HIGH"),
      z.literal("MANDATORY"),
    ]),
  })
  .and(entityScope(["employees", "roles", "skills"]));

/**
 * Configuration for {@link createMaxConsecutiveDaysRule}.
 *
 * - `days` (required): maximum consecutive days allowed
 * - `priority` (required): how strictly the solver enforces this rule
 *
 * Entity scoping (at most one): `employeeIds`, `roleIds`, `skillIds`
 */
export type MaxConsecutiveDaysConfig = z.infer<typeof MaxConsecutiveDaysSchema>;

/**
 * Limits how many consecutive days a person can be assigned.
 *
 * @param config - See {@link MaxConsecutiveDaysConfig}
 * @example
 * ```ts
 * createMaxConsecutiveDaysRule({ days: 5, priority: "MANDATORY" });
 * ```
 */
export function createMaxConsecutiveDaysRule(config: MaxConsecutiveDaysConfig): CompilationRule {
  const parsed = MaxConsecutiveDaysSchema.parse(config);
  const scope = parseEntityScope(parsed);
  const { days, priority } = parsed;
  const windowSize = days + 1;

  return {
    compile(b) {
      const employees = resolveEmployeesFromScope(scope, b.employees);

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
