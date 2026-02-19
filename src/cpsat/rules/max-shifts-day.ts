import * as z from "zod";
import type { CompilationRule } from "../model-builder.js";
import type { Term } from "../types.js";
import { priorityToPenalty } from "../utils.js";
import {
  PrioritySchema,
  entityScope,
  timeScope,
  parseEntityScope,
  parseTimeScope,
  resolveMembersFromScope,
  resolveActiveDaysFromScope,
} from "./scope.types.js";

const MaxShiftsDaySchema = z
  .object({
    shifts: z.number().int().min(1),
    priority: PrioritySchema,
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/**
 * Configuration for {@link createMaxShiftsDayRule}.
 *
 * - `shifts` (required): maximum number of shifts per day (at least 1)
 * - `priority` (required): how strictly the solver enforces this rule
 *
 * Entity scoping (at most one): `memberIds`, `roleIds`, `skillIds`
 * Time scoping (at most one, optional): `dateRange`, `specificDates`, `dayOfWeek`, `recurringPeriods`
 */
export type MaxShiftsDayConfig = z.infer<typeof MaxShiftsDaySchema>;

/**
 * Limits how many shifts a person can work in a single day.
 *
 * Controls the maximum number of distinct shift assignments per day,
 * regardless of shift duration. For limiting total hours worked, use `max-hours-day`.
 *
 * @param config - See {@link MaxShiftsDayConfig}
 * @example Limit to one shift per day
 * ```ts
 * createMaxShiftsDayRule({
 *   shifts: 1,
 *   priority: "MANDATORY",
 * });
 * ```
 *
 * @example Students can work 2 shifts on weekends only
 * ```ts
 * createMaxShiftsDayRule({
 *   roleIds: ["student"],
 *   shifts: 2,
 *   dayOfWeek: ["saturday", "sunday"],
 *   priority: "MANDATORY",
 * });
 * ```
 */
export function createMaxShiftsDayRule(config: MaxShiftsDayConfig): CompilationRule {
  const parsed = MaxShiftsDaySchema.parse(config);
  const entityScopeValue = parseEntityScope(parsed);
  const timeScopeValue = parseTimeScope(parsed);
  const { shifts, priority } = parsed;

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
              coeff: 1,
            });
          }

          if (terms.length === 0) continue;

          if (priority === "MANDATORY") {
            b.addLinear(terms, "<=", shifts);
          } else {
            b.addSoftLinear(terms, "<=", shifts, priorityToPenalty(priority));
          }
        }
      }
    },
  };
}
