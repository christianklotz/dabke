import * as z from "zod";
import type { CompilationRule } from "../model-builder.js";
import type { Term } from "../types.js";
import { priorityToPenalty } from "../utils.js";
import { validationGroup } from "../validation.types.js";
import {
  PrioritySchema,
  entityScope,
  timeScope,
  parseEntityScope,
  parseTimeScope,
  resolveMembersFromScope,
  resolveActiveDaysFromScope,
  formatEntityScope,
  formatTimeScope,
} from "./scope.types.js";

const MaxHoursDaySchema = z
  .object({
    hours: z.number().min(0),
    priority: PrioritySchema,
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/**
 * Configuration for {@link createMaxHoursDayRule}.
 *
 * - `hours` (required): maximum hours allowed per day
 * - `priority` (required): how strictly the solver enforces this rule
 *
 * Entity scoping (at most one): `memberIds`, `roleIds`, `skillIds`
 * Time scoping (at most one, optional): `dateRange`, `specificDates`, `dayOfWeek`, `recurringPeriods`
 */
export type MaxHoursDayConfig = z.infer<typeof MaxHoursDaySchema>;

/**
 * Limits how many hours a person can work in a single day.
 *
 * @param config - See {@link MaxHoursDayConfig}
 * @example Limit everyone to 8 hours per day
 * ```ts
 * createMaxHoursDayRule({
 *   hours: 8,
 *   priority: "MANDATORY",
 * });
 * ```
 *
 * @example Students limited to 4 hours on weekdays during term
 * ```ts
 * createMaxHoursDayRule({
 *   roleIds: ["student"],
 *   hours: 4,
 *   dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
 *   priority: "MANDATORY",
 * });
 * ```
 */
export function createMaxHoursDayRule(config: MaxHoursDayConfig): CompilationRule {
  const parsed = MaxHoursDaySchema.parse(config);
  const entityScopeValue = parseEntityScope(parsed);
  const timeScopeValue = parseTimeScope(parsed);
  const { hours, priority } = parsed;
  const maxMinutes = hours * 60;
  const gKey = validationGroup(
    `max ${hours}h/day${formatEntityScope(entityScopeValue)}${formatTimeScope(timeScopeValue)}`,
  );

  return {
    compile(b) {
      const targetMembers = resolveMembersFromScope(entityScopeValue, b.members);
      const activeDays = resolveActiveDaysFromScope(timeScopeValue, b.days);

      if (targetMembers.length === 0 || activeDays.length === 0) return;

      for (const emp of targetMembers) {
        for (const day of activeDays) {
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

          const constraintId = `max-hours-day:${emp.id}:${day}`;

          if (priority === "MANDATORY") {
            b.addLinear(terms, "<=", maxMinutes);
          } else {
            b.addSoftLinear(terms, "<=", maxMinutes, priorityToPenalty(priority), constraintId);
            b.reporter.trackConstraint({
              id: constraintId,
              type: "rule",
              rule: "max-hours-day",
              description: `${emp.id} max ${hours}h on ${day}`,
              targetValue: maxMinutes,
              comparator: "<=",
              day,
              context: { memberIds: [emp.id], days: [day] },
              group: gKey,
            });
          }
        }
      }
    },
  };
}
