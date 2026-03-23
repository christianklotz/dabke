import * as z from "zod";
import { DayOfWeekSchema } from "../../types.js";
import type { CompilationRule } from "../model-builder.js";
import type { Term } from "../types.js";
import { priorityToPenalty, splitIntoWeeks } from "../utils.js";
import {
  PrioritySchema,
  entityScope,
  parseEntityScope,
  resolveMembersFromScope,
  ruleGroup,
} from "./scope.types.js";

const MinDaysWeekBase = z.object({
  days: z.number().int().min(0),
  priority: PrioritySchema,
  weekStartsOn: DayOfWeekSchema.optional(),
});

const MinDaysWeekSchema = MinDaysWeekBase.and(entityScope(["members", "roles", "skills"]));

/**
 * Configuration for {@link createMinDaysWeekRule}.
 *
 * - `days` (required): minimum number of days required per scheduling week
 * - `priority` (required): how strictly the solver enforces this rule
 * - `weekStartsOn` (optional): which day starts the week; defaults to {@link ModelBuilder.weekStartsOn}
 *
 * Entity scoping (at most one): `memberIds`, `roleIds`, `skillIds`
 */
export type MinDaysWeekConfig = z.infer<typeof MinDaysWeekSchema>;

/**
 * Enforces a minimum number of days a person must work per scheduling week.
 *
 * @remarks
 * Creates a binary "works on day" variable for each member and day, then
 * constrains the weekly sum. This counts distinct days, regardless of how
 * many shifts are assigned on a single day.
 *
 * @param config - See {@link MinDaysWeekConfig}
 * @example
 * ```ts
 * createMinDaysWeekRule({ days: 3, priority: "HIGH" });
 * ```
 */
export function createMinDaysWeekRule(config: MinDaysWeekConfig): CompilationRule {
  const parsed = MinDaysWeekSchema.parse(config);
  const scope = parseEntityScope(parsed);
  const { days, priority, weekStartsOn } = parsed;
  const group = ruleGroup(`min-days-week:${days}`, `Min ${days}d per week`, scope);

  return {
    compile(b) {
      if (days <= 0) return;

      const members = resolveMembersFromScope(scope, b.members);
      const weeks = splitIntoWeeks(b.days, weekStartsOn ?? b.weekStartsOn);

      for (const emp of members) {
        for (const weekDays of weeks) {
          const weekWorkVars: string[] = [];

          for (const day of weekDays) {
            const dayAssignments = b.shiftPatterns
              .filter((p) => b.canAssign(emp, p) && b.patternAvailableOnDay(p, day))
              .map((p) => b.assignment(emp.id, p.id, day));

            if (dayAssignments.length === 0) continue;

            const worksVar = b.boolVar(`works_day_${emp.id}_${day}`);
            weekWorkVars.push(worksVar);

            // worksVar >= each assignment (if any assignment is 1, worksVar must be 1)
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

            // worksVar <= sum(assignments) (if no assignment is 1, worksVar must be 0)
            b.addLinear(
              [{ var: worksVar, coeff: 1 }, ...dayAssignments.map((v) => ({ var: v, coeff: -1 }))],
              "<=",
              0,
            );
          }

          if (weekWorkVars.length === 0) continue;

          const weekLabel = weekDays[0]!;
          const constraintId = `min-days-week:${emp.id}:${weekLabel}`;
          const terms: Term[] = weekWorkVars.map((v) => ({ var: v, coeff: 1 }));

          if (priority === "MANDATORY") {
            b.addLinear(terms, ">=", days);
          } else {
            b.addSoftLinear(terms, ">=", days, priorityToPenalty(priority), constraintId);
            b.reporter.trackConstraint({
              id: constraintId,
              type: "rule",
              rule: "min-days-week",
              description: `${emp.id} min ${days}d in week starting ${weekLabel}`,
              targetValue: days,
              comparator: ">=",
              day: weekLabel,
              context: { memberIds: [emp.id], days: weekDays },
              group,
            });
          }
        }
      }
    },
  };
}
