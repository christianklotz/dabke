import * as z from "zod";
import type { CompilationRule } from "../model-builder.js";
import { priorityToPenalty } from "../utils.js";
import { entityScope, parseEntityScope, resolveEmployeesFromScope } from "./scope.types.js";

const MinRestBetweenShiftsSchema = z
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
 * Configuration for {@link createMinRestBetweenShiftsRule}.
 *
 * - `hours` (required): minimum rest hours required between consecutive shifts
 * - `priority` (required): how strictly the solver enforces this rule
 *
 * Entity scoping (at most one): `employeeIds`, `roleIds`, `skillIds`
 */
export type MinRestBetweenShiftsConfig = z.infer<typeof MinRestBetweenShiftsSchema>;

/**
 * Enforces a minimum rest period between any two shifts a person works.
 *
 * @param config - See {@link MinRestBetweenShiftsConfig}
 * @example
 * ```ts
 * createMinRestBetweenShiftsRule({ hours: 10, priority: "MANDATORY" });
 * ```
 */
export function createMinRestBetweenShiftsRule(
  config: MinRestBetweenShiftsConfig,
): CompilationRule {
  const parsed = MinRestBetweenShiftsSchema.parse(config);
  const scope = parseEntityScope(parsed);
  const { hours, priority } = parsed;
  const minMinutes = hours * 60;

  return {
    compile(b) {
      const employees = resolveEmployeesFromScope(scope, b.employees);

      for (const emp of employees) {
        for (let i = 0; i < b.days.length; i++) {
          const day1 = b.days[i];
          if (!day1) continue;

          const checkDays: string[] = [day1];
          const nextDay = b.days[i + 1];
          if (nextDay) checkDays.push(nextDay);

          for (const pattern1 of b.shiftPatterns) {
            if (!b.canAssign(emp, pattern1)) continue;
            if (!b.patternAvailableOnDay(pattern1, day1)) continue;
            const end1 = b.endMinutes(pattern1, day1);

            for (const day2 of checkDays) {
              if (!day2) continue;
              for (const pattern2 of b.shiftPatterns) {
                if (!b.canAssign(emp, pattern2)) continue;
                if (!b.patternAvailableOnDay(pattern2, day2)) continue;
                if (day1 === day2 && pattern1.id === pattern2.id) continue;

                const start2 = b.startMinutes(pattern2, day2);
                const gap = start2 - end1;

                if (gap >= 0 && gap < minMinutes) {
                  const var1 = b.assignment(emp.id, pattern1.id, day1);
                  const var2 = b.assignment(emp.id, pattern2.id, day2);

                  if (priority === "MANDATORY") {
                    b.addLinear(
                      [
                        { var: var1, coeff: 1 },
                        { var: var2, coeff: 1 },
                      ],
                      "<=",
                      1,
                    );
                  } else {
                    const conflictVar = b.boolVar(
                      `rest_conflict_${emp.id}_${pattern1.id}_${day1}_${pattern2.id}_${day2}`,
                    );
                    b.addLinear(
                      [
                        { var: var1, coeff: 1 },
                        { var: var2, coeff: 1 },
                        { var: conflictVar, coeff: -1 },
                      ],
                      "<=",
                      1,
                    );
                    b.addLinear(
                      [
                        { var: conflictVar, coeff: 1 },
                        { var: var1, coeff: -1 },
                      ],
                      "<=",
                      0,
                    );
                    b.addLinear(
                      [
                        { var: conflictVar, coeff: 1 },
                        { var: var2, coeff: -1 },
                      ],
                      "<=",
                      0,
                    );
                    b.addPenalty(conflictVar, priorityToPenalty(priority));
                  }
                }
              }
            }
          }
        }
      }
    },
  };
}
