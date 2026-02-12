import * as z from "zod";
import { DayOfWeekSchema } from "../../types.js";
import type { CompilationRule } from "../model-builder.js";
import type { Term } from "../types.js";
import { priorityToPenalty, splitIntoWeeks } from "../utils.js";
import { withScopes } from "./scoping.js";

const MinHoursWeekSchema = withScopes(
  z.object({
    hours: z.number().min(0),
    priority: z.union([
      z.literal("LOW"),
      z.literal("MEDIUM"),
      z.literal("HIGH"),
      z.literal("MANDATORY"),
    ]),
    // Optional override; defaults to ModelBuilder.weekStartsOn
    weekStartsOn: DayOfWeekSchema.optional(),
  }),
  { entities: ["employees", "roles", "skills"], times: [] },
);

/**
 * Configuration for {@link createMinHoursWeekRule}.
 *
 * - `hours` (required): minimum hours required per scheduling week
 * - `priority` (required): how strictly the solver enforces this rule
 * - `weekStartsOn` (optional): which day starts the week; defaults to {@link ModelBuilder.weekStartsOn}
 *
 * Also accepts all fields from {@link ScopeConfig} for entity scoping.
 */
export type MinHoursWeekConfig = z.infer<typeof MinHoursWeekSchema>;

/**
 * Enforces a minimum total number of hours per scheduling week.
 *
 * @param config - See {@link MinHoursWeekConfig}
 * @example
 * ```ts
 * const rule = createMinHoursWeekRule({
 *   hours: 30,
 *   priority: "HIGH",
 * });
 * builder = new ModelBuilder({ ...config, rules: [rule] });
 * ```
 */
export function createMinHoursWeekRule(config: MinHoursWeekConfig): CompilationRule {
  const parsed = MinHoursWeekSchema.parse(config);
  const { hours, priority, employeeIds } = parsed;
  const minMinutes = hours * 60;

  return {
    compile(b) {
      if (hours <= 0) return;

      const employees = employeeIds
        ? b.employees.filter((e) => employeeIds.includes(e.id))
        : b.employees;

      const weeks = splitIntoWeeks(b.days, parsed.weekStartsOn ?? b.weekStartsOn);

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
