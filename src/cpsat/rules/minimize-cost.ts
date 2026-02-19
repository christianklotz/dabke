import type * as z from "zod";
import type { DayOfWeek } from "../../types.js";
import type { CompilationRule, CostContribution } from "../model-builder.js";
import type { ShiftPattern, SchedulingMember } from "../types.js";
import type { ShiftAssignment } from "../response.js";
import { COST_CATEGORY } from "../cost.js";
import {
  OBJECTIVE_WEIGHTS,
  timeOfDayToMinutes,
  normalizeEndMinutes,
  splitIntoWeeks,
} from "../utils.js";
import {
  entityScope,
  timeScope,
  parseEntityScope,
  parseTimeScope,
  resolveMembersFromScope,
  resolveActiveDaysFromScope,
} from "./scope.types.js";

const MinimizeCostSchema = entityScope(["members", "roles", "skills"]).and(
  timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]),
);

/** Configuration for {@link createMinimizeCostRule}. */
export type MinimizeCostConfig = z.infer<typeof MinimizeCostSchema>;

/** Returns the hourly rate for a member, or undefined if not hourly. */
function getHourlyRate(member: SchedulingMember): number | undefined {
  if (!member.pay) return undefined;
  if ("hourlyRate" in member.pay) return member.pay.hourlyRate;
  return undefined;
}

/** Returns salaried pay info, or undefined if not salaried. */
function getSalariedPay(
  member: SchedulingMember,
): { annual: number; hoursPerWeek: number } | undefined {
  if (!member.pay) return undefined;
  if ("annual" in member.pay) return member.pay;
  return undefined;
}

/** Computes shift duration in minutes from a pattern. */
function patternDurationMinutes(pattern: ShiftPattern): number {
  const start = timeOfDayToMinutes(pattern.startTime);
  const end = normalizeEndMinutes(start, timeOfDayToMinutes(pattern.endTime));
  return end - start;
}

/**
 * Creates the minimize-cost rule.
 *
 * **Hourly members:** adds a penalty proportional to
 * `hourlyRate * shiftDurationMinutes / 60` for each assignment.
 *
 * **Salaried members:** zero marginal cost up to their contracted hours.
 * A boolean variable tracks whether the member has any assignment in a
 * given week. When active, their full weekly salary (`annual / 52`) is
 * added as a penalty. This causes the solver to load work onto salaried
 * members (who are "free" once activated) before hourly workers.
 *
 * Computes a normalization factor and stores it on the model builder's
 * `costContext` so modifier rules can use the same scale.
 */
export function createMinimizeCostRule(config: MinimizeCostConfig): CompilationRule {
  const parsed = MinimizeCostSchema.parse(config);
  const entityScopeValue = parseEntityScope(parsed);
  const timeScopeValue = parseTimeScope(parsed);

  let resolvedWeekStartsOn: DayOfWeek = "monday";

  return {
    compile(b) {
      resolvedWeekStartsOn = b.weekStartsOn;

      const targetMembers = resolveMembersFromScope(entityScopeValue, b.members);
      const activeDays = resolveActiveDaysFromScope(timeScopeValue, b.days);

      if (targetMembers.length === 0 || activeDays.length === 0) return;

      // Compute normalization factor: max raw cost of any single assignment
      // (hourly) or weekly salary (salaried)
      let maxRawCost = 0;
      for (const member of targetMembers) {
        const rate = getHourlyRate(member);
        if (rate !== undefined) {
          for (const pattern of b.shiftPatterns) {
            if (!b.canAssign(member, pattern)) continue;
            const duration = patternDurationMinutes(pattern);
            const rawCost = (rate * duration) / 60;
            if (rawCost > maxRawCost) maxRawCost = rawCost;
          }
        }
        const salaried = getSalariedPay(member);
        if (salaried !== undefined) {
          const weeklyCost = salaried.annual / 52;
          if (weeklyCost > maxRawCost) maxRawCost = weeklyCost;
        }
      }

      if (maxRawCost === 0) return;

      const normalizationFactor = maxRawCost / OBJECTIVE_WEIGHTS.COST;

      b.costContext = {
        normalizationFactor,
        active: true,
      };

      // Add penalty terms for hourly members
      for (const member of targetMembers) {
        const rate = getHourlyRate(member);
        if (rate !== undefined) {
          for (const pattern of b.shiftPatterns) {
            if (!b.canAssign(member, pattern)) continue;
            for (const day of activeDays) {
              if (!b.patternAvailableOnDay(pattern, day)) continue;
              const duration = patternDurationMinutes(pattern);
              const rawCost = (rate * duration) / 60;
              const normalizedPenalty = rawCost / normalizationFactor;
              b.addPenalty(
                b.assignment(member.id, pattern.id, day),
                Math.max(1, normalizedPenalty),
              );
            }
          }
          continue;
        }

        // Salaried members: weekly fixed cost when active
        const salaried = getSalariedPay(member);
        if (salaried === undefined) continue;

        const weeklyCost = salaried.annual / 52;
        const normalizedWeeklyCost = weeklyCost / normalizationFactor;

        const weeks = splitIntoWeeks(activeDays, b.weekStartsOn);

        for (const [weekIdx, weekDays] of weeks.entries()) {
          // Collect all assignment vars for this member this week
          const weekAssignmentVars: string[] = [];
          for (const day of weekDays) {
            for (const pattern of b.shiftPatterns) {
              if (!b.canAssign(member, pattern)) continue;
              if (!b.patternAvailableOnDay(pattern, day)) continue;
              weekAssignmentVars.push(b.assignment(member.id, pattern.id, day));
            }
          }

          if (weekAssignmentVars.length === 0) continue;

          // Bool var: true if this salaried member works any shift this week
          const activeVar = b.boolVar(`active:cost:${member.id}:w${weekIdx}`);

          // If any assignment is true, activeVar must be true
          // activeVar OR NOT(assignment_1) OR NOT(assignment_2) OR ...
          // This is equivalent to: for each assignment, assignment => activeVar
          for (const assignVar of weekAssignmentVars) {
            b.addImplication(assignVar, activeVar);
          }

          b.addPenalty(activeVar, Math.max(1, Math.round(normalizedWeeklyCost)));
        }
      }
    },

    cost(
      assignments: ShiftAssignment[],
      members: ReadonlyArray<SchedulingMember>,
      shiftPatterns: ReadonlyArray<ShiftPattern>,
    ): CostContribution {
      const memberMap = new Map(members.map((m) => [m.id, m]));
      const patternMap = new Map(shiftPatterns.map((p) => [p.id, p]));

      const allDays = [...new Set(assignments.map((a) => a.day))].toSorted();
      const activeDays = new Set(resolveActiveDaysFromScope(timeScopeValue, allDays));
      const targetMemberIds = new Set(
        resolveMembersFromScope(entityScopeValue, [...members]).map((m) => m.id),
      );

      const entries: CostContribution["entries"] = [];

      // Track which salaried members are active per week for weekly cost
      const salariedWeekActive = new Map<string, Set<string>>();

      for (const a of assignments) {
        if (!activeDays.has(a.day)) continue;
        if (!targetMemberIds.has(a.memberId)) continue;
        const member = memberMap.get(a.memberId);
        if (!member) continue;

        const pattern = patternMap.get(a.shiftPatternId);
        if (!pattern) continue;
        const duration = patternDurationMinutes(pattern);

        const rate = getHourlyRate(member);
        if (rate !== undefined) {
          entries.push({
            memberId: a.memberId,
            day: a.day,
            category: COST_CATEGORY.BASE,
            amount: (rate * duration) / 60,
          });
          continue;
        }

        // Salaried: track weeks with assignments
        const salaried = getSalariedPay(member);
        if (salaried === undefined) continue;

        let days = salariedWeekActive.get(a.memberId);
        if (!days) {
          days = new Set();
          salariedWeekActive.set(a.memberId, days);
        }
        days.add(a.day);
      }

      // Compute salaried costs: weekly salary distributed across active days
      for (const [memberId, activeDaysSet] of salariedWeekActive) {
        const member = memberMap.get(memberId);
        if (!member) continue;
        const salaried = getSalariedPay(member);
        if (!salaried) continue;

        const activeList = [...activeDaysSet].toSorted();
        const weeks = splitIntoWeeks(activeList, resolvedWeekStartsOn);

        for (const weekDays of weeks) {
          if (weekDays.length === 0) continue;
          const weeklyCost = salaried.annual / 52;
          // Distribute evenly across days worked that week
          const perDay = weeklyCost / weekDays.length;
          for (const day of weekDays) {
            entries.push({
              memberId,
              day,
              category: COST_CATEGORY.BASE,
              amount: perDay,
            });
          }
        }
      }

      return { entries };
    },
  };
}
