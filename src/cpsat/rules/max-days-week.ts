import * as z from "zod";
import { DayOfWeekSchema } from "../../types.js";
import type { CompilationRule } from "../model-builder.js";
import type { Term } from "../types.js";
import { priorityToPenalty, splitIntoWeeks } from "../utils.js";
import {
  PrioritySchema,
  entityScope,
  timeScope,
  parseEntityScope,
  parseTimeScope,
  resolveMembersFromScope,
  resolveActiveDaysFromScope,
  ruleGroup,
} from "./scope.types.js";

const MaxDaysWeekBase = z.object({
  days: z.number().int().min(0),
  priority: PrioritySchema,
  weekStartsOn: DayOfWeekSchema.optional(),
});

const MaxDaysWeekSchema = MaxDaysWeekBase.and(entityScope(["members", "roles", "skills"])).and(
  timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]),
);

/**
 * Configuration for {@link createMaxDaysWeekRule}.
 *
 * - `days` (required): maximum number of days allowed per scheduling week
 * - `priority` (required): how strictly the solver enforces this rule
 * - `weekStartsOn` (optional): which day starts the week; defaults to {@link ModelBuilder.weekStartsOn}
 *
 * Entity scoping (at most one): `memberIds`, `roleIds`, `skillIds`
 * Time scoping (at most one, optional): `dateRange`, `specificDates`, `dayOfWeek`, `recurringPeriods`
 */
export type MaxDaysWeekConfig = z.infer<typeof MaxDaysWeekSchema>;

/**
 * Caps total number of days a person can work within each scheduling week.
 *
 * @remarks
 * Creates a binary "works on day" variable for each member and day, then
 * constrains the weekly sum. This counts distinct days, regardless of how
 * many shifts are assigned on a single day.
 *
 * @param config - See {@link MaxDaysWeekConfig}
 * @example Limit everyone to 5 days per week
 * ```ts
 * createMaxDaysWeekRule({ days: 5, priority: "MANDATORY" });
 * ```
 *
 * @example Part-time staff limited to 3 days
 * ```ts
 * createMaxDaysWeekRule({
 *   roleIds: ["part-time"],
 *   days: 3,
 *   priority: "HIGH",
 * });
 * ```
 */
export function createMaxDaysWeekRule(config: MaxDaysWeekConfig): CompilationRule {
  const parsed = MaxDaysWeekSchema.parse(config);
  const entityScopeValue = parseEntityScope(parsed);
  const timeScopeValue = parseTimeScope(parsed);
  const { days, priority, weekStartsOn } = parsed;
  const group = ruleGroup(
    `max-days-week:${days}`,
    `Max ${days}d per week`,
    entityScopeValue,
    timeScopeValue,
  );

  return {
    compile(b) {
      const targetMembers = resolveMembersFromScope(entityScopeValue, b.members);
      const activeDays = resolveActiveDaysFromScope(timeScopeValue, b.days);

      if (targetMembers.length === 0 || activeDays.length === 0) return;

      const weeks = splitIntoWeeks(activeDays, weekStartsOn ?? b.weekStartsOn);

      for (const emp of targetMembers) {
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
          const constraintId = `max-days-week:${emp.id}:${weekLabel}`;
          const terms: Term[] = weekWorkVars.map((v) => ({ var: v, coeff: 1 }));

          if (priority === "MANDATORY") {
            b.addLinear(terms, "<=", days);
          } else {
            b.addSoftLinear(terms, "<=", days, priorityToPenalty(priority), constraintId);
            b.reporter.trackConstraint({
              id: constraintId,
              type: "rule",
              rule: "max-days-week",
              description: `${emp.id} max ${days}d in week starting ${weekLabel}`,
              targetValue: days,
              comparator: "<=",
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
