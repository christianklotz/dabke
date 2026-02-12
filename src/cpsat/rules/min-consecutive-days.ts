import * as z from "zod";
import type { CompilationRule } from "../model-builder.js";
import { priorityToPenalty } from "../utils.js";
import { withScopes } from "./scoping.js";

const MinConsecutiveDaysSchema = withScopes(
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
 * Configuration for {@link createMinConsecutiveDaysRule}.
 *
 * - `days` (required): minimum consecutive days required once a person starts working
 * - `priority` (required): how strictly the solver enforces this rule
 *
 * Also accepts all fields from {@link ScopeConfig} for entity scoping.
 */
export type MinConsecutiveDaysConfig = z.infer<typeof MinConsecutiveDaysSchema>;

/**
 * Requires that once a person starts working, they continue for a minimum
 * number of consecutive days.
 *
 * @param config - See {@link MinConsecutiveDaysConfig}
 * @example
 * ```ts
 * const rule = createMinConsecutiveDaysRule({
 *   days: 3,
 *   priority: "MANDATORY",
 * });
 * builder = new ModelBuilder({ ...config, rules: [rule] });
 * ```
 */
export function createMinConsecutiveDaysRule(config: MinConsecutiveDaysConfig): CompilationRule {
  const { days, priority, employeeIds } = MinConsecutiveDaysSchema.parse(config);

  return {
    compile(b) {
      if (days <= 1) return;

      const employees = employeeIds
        ? b.employees.filter((e) => employeeIds.includes(e.id))
        : b.employees;

      for (const emp of employees) {
        const worksByDay: string[] = [];

        for (const day of b.days) {
          const worksVar = b.boolVar(`works_${emp.id}_${day}`);
          worksByDay.push(worksVar);

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
              [{ var: worksVar, coeff: 1 }, ...dayAssignments.map((v) => ({ var: v, coeff: -1 }))],
              "<=",
              0,
            );
          }
        }

        for (let i = 0; i < b.days.length; i++) {
          const dayLabel = b.days[i];
          if (!dayLabel) continue;

          const worksToday = worksByDay[i];
          if (!worksToday) continue;
          const worksYesterday = i > 0 ? worksByDay[i - 1] : undefined;
          const startVar = b.boolVar(`work_start_${emp.id}_${dayLabel}`);

          b.addLinear(
            [
              { var: startVar, coeff: 1 },
              { var: worksToday, coeff: -1 },
            ],
            "<=",
            0,
          );
          if (worksYesterday) {
            b.addLinear(
              [
                { var: startVar, coeff: 1 },
                { var: worksYesterday, coeff: 1 },
              ],
              "<=",
              1,
            );
            b.addLinear(
              [
                { var: startVar, coeff: 1 },
                { var: worksYesterday, coeff: 1 },
                { var: worksToday, coeff: -1 },
              ],
              ">=",
              0,
            );
          } else {
            b.addLinear(
              [
                { var: startVar, coeff: 1 },
                { var: worksToday, coeff: -1 },
              ],
              ">=",
              0,
            );
          }

          const window = worksByDay.slice(i, i + days).filter(Boolean) as string[];
          if (window.length === 0) continue;

          const terms = [
            ...window.map((v) => ({ var: v, coeff: 1 })),
            { var: startVar, coeff: -days },
          ];

          if (priority === "MANDATORY") {
            b.addLinear(terms, ">=", 0);
          } else {
            b.addSoftLinear(terms, ">=", 0, priorityToPenalty(priority));
          }
        }
      }
    },
  };
}
