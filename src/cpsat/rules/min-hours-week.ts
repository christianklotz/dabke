import * as z from "zod";
import { DayOfWeekSchema } from "../../types.js";
import type { CompilationRule } from "../model-builder.js";
import type { Term } from "../types.js";
import { priorityToPenalty, splitIntoWeeks } from "../utils.js";
import { entityScope, parseEntityScope, resolveEmployeesFromScope } from "./scope.types.js";

const MinHoursWeekBase = z.object({
  hours: z.number().min(0),
  priority: z.union([
    z.literal("LOW"),
    z.literal("MEDIUM"),
    z.literal("HIGH"),
    z.literal("MANDATORY"),
  ]),
  weekStartsOn: DayOfWeekSchema.optional(),
});

const MinHoursWeekSchema = MinHoursWeekBase.and(entityScope(["employees", "roles", "skills"]));

/**
 * Configuration for {@link createMinHoursWeekRule}.
 *
 * - `hours` (required): minimum hours required per scheduling week
 * - `priority` (required): how strictly the solver enforces this rule
 * - `weekStartsOn` (optional): which day starts the week; defaults to {@link ModelBuilder.weekStartsOn}
 *
 * Entity scoping (at most one): `employeeIds`, `roleIds`, `skillIds`
 */
export type MinHoursWeekConfig = z.infer<typeof MinHoursWeekSchema>;

/**
 * Enforces a minimum total number of hours per scheduling week.
 *
 * @param config - See {@link MinHoursWeekConfig}
 * @example
 * ```ts
 * createMinHoursWeekRule({ hours: 30, priority: "HIGH" });
 * ```
 */
export function createMinHoursWeekRule(config: MinHoursWeekConfig): CompilationRule {
  const parsed = MinHoursWeekSchema.parse(config);
  const scope = parseEntityScope(parsed);
  const { hours, priority, weekStartsOn } = parsed;
  const minMinutes = hours * 60;

  return {
    compile(b) {
      if (hours <= 0) return;

      const employees = resolveEmployeesFromScope(scope, b.employees);
      const weeks = splitIntoWeeks(b.days, weekStartsOn ?? b.weekStartsOn);

      for (const emp of employees) {
        for (const weekDays of weeks) {
          const terms: Term[] = [];
          for (const day of weekDays) {
            for (const pattern of b.shiftPatterns) {
              if (!b.canAssign(emp, pattern)) continue;
              if (!b.patternAvailableOnDay(pattern, day)) continue;
              terms.push({
                var: b.assignment(emp.id, pattern.id, day),
                coeff: b.patternDuration(pattern.id),
              });
            }
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
