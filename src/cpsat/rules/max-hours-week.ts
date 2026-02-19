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
} from "./scope.types.js";

const MaxHoursWeekBase = z.object({
  hours: z.number().min(0),
  priority: PrioritySchema,
  weekStartsOn: DayOfWeekSchema.optional(),
});

const MaxHoursWeekSchema = MaxHoursWeekBase.and(entityScope(["members", "roles", "skills"])).and(
  timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]),
);

/**
 * Configuration for {@link createMaxHoursWeekRule}.
 *
 * - `hours` (required): maximum hours allowed per scheduling week
 * - `priority` (required): how strictly the solver enforces this rule
 * - `weekStartsOn` (optional): which day starts the week; defaults to {@link ModelBuilder.weekStartsOn}
 *
 * Entity scoping (at most one): `memberIds`, `roleIds`, `skillIds`
 * Time scoping (at most one, optional): `dateRange`, `specificDates`, `dayOfWeek`, `recurringPeriods`
 */
export type MaxHoursWeekConfig = z.infer<typeof MaxHoursWeekSchema>;

/**
 * Caps total hours a person can work within each scheduling week.
 *
 * @param config - See {@link MaxHoursWeekConfig}
 * @example Limit everyone to 40 hours per week
 * ```ts
 * createMaxHoursWeekRule({ hours: 40, priority: "HIGH" });
 * ```
 *
 * @example Students limited to 20 hours during term time
 * ```ts
 * createMaxHoursWeekRule({
 *   roleIds: ["student"],
 *   hours: 20,
 *   recurringPeriods: [
 *     { name: "fall-term", startMonth: 9, startDay: 1, endMonth: 12, endDay: 15 },
 *   ],
 *   priority: "MANDATORY",
 * });
 * ```
 */
export function createMaxHoursWeekRule(config: MaxHoursWeekConfig): CompilationRule {
  const parsed = MaxHoursWeekSchema.parse(config);
  const entityScopeValue = parseEntityScope(parsed);
  const timeScopeValue = parseTimeScope(parsed);
  const { hours, priority, weekStartsOn } = parsed;
  const maxMinutes = hours * 60;

  return {
    compile(b) {
      const targetMembers = resolveMembersFromScope(entityScopeValue, b.members);
      const activeDays = resolveActiveDaysFromScope(timeScopeValue, b.days);

      if (targetMembers.length === 0 || activeDays.length === 0) return;

      const weeks = splitIntoWeeks(activeDays, weekStartsOn ?? b.weekStartsOn);

      for (const emp of targetMembers) {
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
            b.addLinear(terms, "<=", maxMinutes);
          } else {
            b.addSoftLinear(terms, "<=", maxMinutes, priorityToPenalty(priority));
          }
        }
      }
    },
  };
}
