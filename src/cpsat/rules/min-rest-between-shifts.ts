import * as z from "zod";
import type { CompilationRule, RuleValidationContext } from "../model-builder.js";
import type { ResolvedShiftAssignment } from "../response.js";
import { normalizeEndMinutes, priorityToPenalty, timeOfDayToMinutes } from "../utils.js";
import { validationGroup } from "../validation.types.js";
import type { ValidationReporter } from "../validation-reporter.js";
import {
  PrioritySchema,
  entityScope,
  parseEntityScope,
  resolveMembersFromScope,
  formatEntityScope,
} from "./scope.types.js";

const MinRestBetweenShiftsSchema = z
  .object({
    hours: z.number().min(0),
    priority: PrioritySchema,
  })
  .and(entityScope(["members", "roles", "skills"]));

/**
 * Configuration for {@link createMinRestBetweenShiftsRule}.
 *
 * - `hours` (required): minimum rest hours required between consecutive shifts
 * - `priority` (required): how strictly the solver enforces this rule
 *
 * Entity scoping (at most one): `memberIds`, `roleIds`, `skillIds`
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
  const gKey = validationGroup(`min ${hours}h rest between shifts${formatEntityScope(scope)}`);

  return {
    compile(b) {
      const members = resolveMembersFromScope(scope, b.members);

      for (const emp of members) {
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

    validate(
      assignments: ResolvedShiftAssignment[],
      reporter: ValidationReporter,
      context: RuleValidationContext,
    ) {
      if (priority === "MANDATORY") return;

      const members = resolveMembersFromScope(scope, context.members);
      if (members.length === 0) return;

      const memberIds = new Set(members.map((m) => m.id));

      // Group assignments by member, sort by day then start time
      const byMember = new Map<string, ResolvedShiftAssignment[]>();
      for (const a of assignments) {
        if (!memberIds.has(a.memberId)) continue;
        const list = byMember.get(a.memberId) ?? [];
        list.push(a);
        byMember.set(a.memberId, list);
      }

      for (const [memberId, memberAssignments] of byMember) {
        const sorted = memberAssignments.toSorted((a, b) => {
          if (a.day !== b.day) return a.day < b.day ? -1 : 1;
          return timeOfDayToMinutes(a.startTime) - timeOfDayToMinutes(b.startTime);
        });

        let violated = false;
        for (let i = 0; i < sorted.length - 1; i++) {
          const current = sorted[i]!;
          const next = sorted[i + 1]!;

          const currentEndMin = timeOfDayToMinutes(current.endTime);
          const normalizedEnd = normalizeEndMinutes(
            timeOfDayToMinutes(current.startTime),
            currentEndMin,
          );
          const nextStartMin = timeOfDayToMinutes(next.startTime);

          // Calculate gap considering day boundaries
          let gap: number;
          if (current.day === next.day) {
            gap = nextStartMin - normalizedEnd;
          } else {
            // Different days: account for the day boundary
            const dayDiff = daysBetween(current.day, next.day);
            gap = dayDiff * 24 * 60 - normalizedEnd + nextStartMin;
          }

          if (gap >= 0 && gap < minMinutes) {
            reporter.reportRuleViolation({
              rule: "min-rest-between-shifts",
              reason: `${memberId} has ${Math.round((gap / 60) * 10) / 10}h rest between shifts on ${current.day} and ${next.day}, need ${hours}h`,
              context: { memberIds: [memberId], days: [current.day, next.day] },
              shortfall: minMinutes - gap,
              group: gKey,
            });
            violated = true;
          }
        }

        if (!violated && sorted.length > 1) {
          reporter.reportRulePassed({
            rule: "min-rest-between-shifts",
            description: `${memberId} has ${hours}h+ rest between all shifts`,
            context: {
              memberIds: [memberId],
              days: [...new Set(sorted.map((a) => a.day))],
            },
            group: gKey,
          });
        }
      }
    },
  };
}

/** Compute day difference from YYYY-MM-DD strings. */
function daysBetween(day1: string, day2: string): number {
  const d1 = new Date(`${day1}T00:00:00Z`);
  const d2 = new Date(`${day2}T00:00:00Z`);
  return Math.round((d2.getTime() - d1.getTime()) / (24 * 60 * 60 * 1000));
}
