import * as z from "zod";
import { DayOfWeekSchema } from "../../types.js";
import type { CompilationRule, CostContribution } from "../model-builder.js";
import type { ShiftPattern, SchedulingMember, Term } from "../types.js";
import type { ShiftAssignment } from "../response.js";
import { COST_CATEGORY } from "../cost.js";
import {
  timeOfDayToMinutes,
  normalizeEndMinutes,
  splitIntoWeeks,
  unionMinutes,
  OBJECTIVE_WEIGHTS,
} from "../utils.js";
import {
  entityScope,
  timeScope,
  parseEntityScope,
  parseTimeScope,
  resolveMembersFromScope,
  resolveActiveDaysFromScope,
} from "./scope.types.js";
import { getHourlyRate, patternDurationMinutes } from "./cost-utils.js";

const OvertimeTierSchema = z.object({
  after: z.number().min(0),
  factor: z.number().min(1),
});

/**
 * A single tier in a tiered overtime configuration.
 *
 * @category Cost Optimization
 */
export type OvertimeTier = z.infer<typeof OvertimeTierSchema>;

const OvertimeTieredMultiplierSchema = z
  .object({
    tiers: z.array(OvertimeTierSchema).nonempty(),
    weekStartsOn: DayOfWeekSchema.optional(),
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/** Configuration for {@link createOvertimeTieredMultiplierRule}. */
export type OvertimeTieredMultiplierConfig = z.infer<typeof OvertimeTieredMultiplierSchema>;

/**
 * Creates a multi-threshold weekly overtime multiplier rule.
 *
 * Each tier applies only to the hours between its threshold and the next.
 * Tiers are sorted by threshold ascending internally.
 *
 * @example
 * ```typescript
 * // Hours 0-40: base rate
 * // Hours 40-48: 1.5x
 * // Hours 48+: 2.0x
 * tieredOvertimeMultiplier([
 *   { after: 40, factor: 1.5 },
 *   { after: 48, factor: 2.0 },
 * ])
 * ```
 */
export function createOvertimeTieredMultiplierRule(
  config: OvertimeTieredMultiplierConfig,
): CompilationRule {
  const parsed = OvertimeTieredMultiplierSchema.parse(config);
  const { weekStartsOn } = parsed;
  const entityScopeValue = parseEntityScope(parsed);
  const timeScopeValue = parseTimeScope(parsed);

  // Sort tiers by threshold ascending
  const tiers = parsed.tiers.toSorted((a, b) => a.after - b.after);

  // Filter out tiers with factor <= 1 (no extra cost)
  const effectiveTiers = tiers.filter((t) => t.factor > 1);
  let resolvedWeekStartsOn = weekStartsOn ?? "monday";

  return {
    compile(b) {
      resolvedWeekStartsOn = weekStartsOn ?? b.weekStartsOn;
      if (effectiveTiers.length === 0) return;

      const targetMembers = resolveMembersFromScope(entityScopeValue, b.members);
      const activeDays = resolveActiveDaysFromScope(timeScopeValue, b.days);

      if (targetMembers.length === 0 || activeDays.length === 0) return;

      const weeks = splitIntoWeeks(activeDays, weekStartsOn ?? b.weekStartsOn);

      const hasCostContext = b.costContext?.active === true;

      for (const emp of targetMembers) {
        const rate = getHourlyRate(emp);
        if (rate === undefined) continue;

        for (const [weekIdx, weekDays] of weeks.entries()) {
          // Build total minutes expression and compute per-member week max
          // using time-range union per day (accounts for no-overlap constraints)
          let empWeekMaxMinutes = 0;
          const terms: Term[] = [];
          for (const day of weekDays) {
            const dayRanges: Array<{ start: number; end: number }> = [];
            for (const pattern of b.shiftPatterns) {
              if (!b.canAssign(emp, pattern)) continue;
              if (!b.patternAvailableOnDay(pattern, day)) continue;
              const start = timeOfDayToMinutes(pattern.startTime);
              dayRanges.push({
                start,
                end: normalizeEndMinutes(start, timeOfDayToMinutes(pattern.endTime)),
              });
              terms.push({
                var: b.assignment(emp.id, pattern.id, day),
                coeff: patternDurationMinutes(pattern),
              });
            }
            empWeekMaxMinutes += unionMinutes(dayRanges);
          }

          if (terms.length === 0) continue;

          // Create a tierVar for each tier: max(0, totalMinutes - threshold)
          const tierVars: string[] = [];
          for (const [tierIdx, tier] of effectiveTiers.entries()) {
            const thresholdMinutes = tier.after * 60;
            const maxOvertime = Math.max(0, empWeekMaxMinutes - thresholdMinutes);
            if (maxOvertime === 0) {
              // Tiers are sorted ascending, so all subsequent tiers are also unreachable.
              tierVars.push("");
              continue;
            }

            const tierVar = b.intVar(
              `overtime:tiered:${emp.id}:w${weekIdx}:t${tierIdx}`,
              0,
              maxOvertime,
            );
            tierVars.push(tierVar);

            // tierVar >= totalMinutes - threshold
            b.addLinear(
              [{ var: tierVar, coeff: 1 }, ...terms.map((t) => ({ var: t.var, coeff: -t.coeff }))],
              ">=",
              -thresholdMinutes,
            );
          }

          // Compute per-tier-only hours and add penalties.
          // tierOnly_i = tierVar_i - tierVar_{i+1} for non-last tiers.
          // For the last tier, tierOnly = tierVar_last.
          for (let i = 0; i < effectiveTiers.length; i++) {
            const tierVar = tierVars[i];
            if (!tierVar) continue; // Tier unreachable

            const tier = effectiveTiers[i]!;
            const extraFactor = tier.factor - 1;

            const nextTierVar = i + 1 < effectiveTiers.length ? tierVars[i + 1] : undefined;

            if (nextTierVar) {
              // Create tierOnly_i = tierVar_i - tierVar_{i+1}
              const maxTierOnly = (effectiveTiers[i + 1]!.after - tier.after) * 60;
              const tierOnlyVar = b.intVar(
                `overtime:tiered-only:${emp.id}:w${weekIdx}:t${i}`,
                0,
                Math.max(0, maxTierOnly),
              );

              // tierOnlyVar == tierVar - nextTierVar
              b.addLinear(
                [
                  { var: tierOnlyVar, coeff: 1 },
                  { var: tierVar, coeff: -1 },
                  { var: nextTierVar, coeff: 1 },
                ],
                "==",
                0,
              );

              if (rate > 0) {
                const totalTierCost = (rate * extraFactor * Math.max(1, maxTierOnly)) / 60;
                if (hasCostContext) {
                  const normalizedMax = totalTierCost / b.costContext!.normalizationFactor;
                  b.addPenalty(
                    tierOnlyVar,
                    Math.max(1, Math.round(normalizedMax / Math.max(1, maxTierOnly))),
                  );
                } else {
                  b.addPenalty(
                    tierOnlyVar,
                    Math.max(1, Math.round(OBJECTIVE_WEIGHTS.COST / Math.max(1, maxTierOnly))),
                  );
                }
              } else {
                b.addPenalty(tierOnlyVar, 1);
              }
            } else {
              // Last tier: penalty directly on tierVar
              const maxOvertimeLast = Math.max(1, empWeekMaxMinutes - tier.after * 60);
              if (rate > 0) {
                const totalTierCost = (rate * extraFactor * maxOvertimeLast) / 60;
                if (hasCostContext) {
                  const normalizedMax = totalTierCost / b.costContext!.normalizationFactor;
                  b.addPenalty(tierVar, Math.max(1, Math.round(normalizedMax / maxOvertimeLast)));
                } else {
                  b.addPenalty(
                    tierVar,
                    Math.max(1, Math.round(OBJECTIVE_WEIGHTS.COST / maxOvertimeLast)),
                  );
                }
              } else {
                b.addPenalty(tierVar, 1);
              }
            }
          }
        }
      }
    },

    cost(
      assignments: ShiftAssignment[],
      members: ReadonlyArray<SchedulingMember>,
      shiftPatterns: ReadonlyArray<ShiftPattern>,
    ): CostContribution {
      if (effectiveTiers.length === 0) return { entries: [] };

      const memberMap = new Map(members.map((e) => [e.id, e]));
      const patternMap = new Map(shiftPatterns.map((p) => [p.id, p]));

      const allDays = [...new Set(assignments.map((a) => a.day))].toSorted();
      const activeDays = new Set(resolveActiveDaysFromScope(timeScopeValue, allDays));
      const targetEmpIds = new Set(
        resolveMembersFromScope(entityScopeValue, [...memberMap.values()]).map((e) => e.id),
      );

      const activeDaysList = allDays.filter((d) => activeDays.has(d));
      const weeks = splitIntoWeeks(activeDaysList, resolvedWeekStartsOn);

      const entries: CostContribution["entries"] = [];

      for (const weekDays of weeks) {
        const weekDaySet = new Set(weekDays);

        const empWeekData = new Map<
          string,
          { totalMinutes: number; dayMinutes: Map<string, number> }
        >();

        for (const a of assignments) {
          if (!weekDaySet.has(a.day)) continue;
          if (!activeDays.has(a.day)) continue;
          if (!targetEmpIds.has(a.memberId)) continue;

          const pattern = patternMap.get(a.shiftPatternId);
          if (!pattern) continue;
          const duration = patternDurationMinutes(pattern);

          let data = empWeekData.get(a.memberId);
          if (!data) {
            data = { totalMinutes: 0, dayMinutes: new Map() };
            empWeekData.set(a.memberId, data);
          }
          data.totalMinutes += duration;
          data.dayMinutes.set(a.day, (data.dayMinutes.get(a.day) ?? 0) + duration);
        }

        for (const [empId, data] of empWeekData) {
          const emp = memberMap.get(empId);
          if (!emp) continue;
          const rate = getHourlyRate(emp);
          if (rate === undefined) continue;

          // Compute total overtime cost across all tiers
          let totalOvertimeCost = 0;

          for (let i = 0; i < effectiveTiers.length; i++) {
            const tier = effectiveTiers[i]!;
            const thresholdMinutes = tier.after * 60;
            const extraFactor = tier.factor - 1;

            const overtimeAboveThreshold = Math.max(0, data.totalMinutes - thresholdMinutes);
            if (overtimeAboveThreshold <= 0) continue;

            // Minutes in this tier only (capped by next tier's threshold)
            const nextThreshold = effectiveTiers[i + 1]
              ? effectiveTiers[i + 1]!.after * 60
              : Infinity;
            const tierMinutes = Math.min(
              overtimeAboveThreshold,
              nextThreshold === Infinity
                ? overtimeAboveThreshold
                : nextThreshold - thresholdMinutes,
            );

            totalOvertimeCost += (rate * extraFactor * tierMinutes) / 60;
          }

          if (totalOvertimeCost <= 0) continue;

          // Distribute proportionally across days
          for (const [day, dayMinutes] of data.dayMinutes) {
            const proportion = dayMinutes / data.totalMinutes;
            entries.push({
              memberId: empId,
              day,
              category: COST_CATEGORY.OVERTIME,
              amount: totalOvertimeCost * proportion,
            });
          }
        }
      }

      return { entries };
    },
  };
}
