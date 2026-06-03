import * as z from "zod";
import { DayOfWeekSchema } from "../../types.js";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import type { RuleCompileContext } from "../rule-descriptor.js";
import type { ValidationReporter } from "../validation-reporter.js";
import { groupWeekChunks, priorityToPenalty, splitIntoMonths } from "../utils.js";
import {
  PrioritySchema,
  entityScope,
  parseEntityScope,
  resolveMembersFromScope,
  ruleGroup,
} from "./scope.types.js";
import { assignmentVarsForDay } from "./assignment-terms.js";
import { hasAnyAssignablePattern } from "./pattern-eligibility.js";
import { assignedDayVariableName } from "./variables.js";
import { hardConstraint, reportValidation, softConstraint } from "./artifacts.js";
import { buildAssignedDayIndicator } from "./assigned-day.js";

const PeriodSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("weeks"), value: z.number().int().min(1) }),
  z.object({ type: z.literal("months"), value: z.number().int().min(1) }),
]);

const MinDaysOfWeekPerPeriodBase = z.object({
  days: z.number().int().min(0),
  dayOfWeek: z.array(DayOfWeekSchema).nonempty(),
  period: PeriodSchema,
  priority: PrioritySchema,
});

export const MinDaysOfWeekPerPeriodSchema = MinDaysOfWeekPerPeriodBase.and(
  entityScope(["members", "roles", "skills"]),
);

/**
 * Configuration for {@link minDaysOfWeekPerPeriodRuleDescriptor}.
 */
export type MinDaysOfWeekPerPeriodConfig = z.infer<typeof MinDaysOfWeekPerPeriodSchema>;

export const minDaysOfWeekPerPeriodRuleDescriptor = defineRuleDescriptor({
  name: "min-days-of-week-per-period",
  schema: MinDaysOfWeekPerPeriodSchema,
  compile(config, ctx) {
    const entityScopeValue = parseEntityScope(config);
    const { days, dayOfWeek, period, priority } = config;
    const dowLabel = dayOfWeek.toSorted().join(",");
    const periodLabel = `${period.value}${period.type === "weeks" ? "w" : "m"}`;
    const group = ruleGroup(
      `min-days-of-week-per-period:${days}:${dowLabel}:${periodLabel}`,
      `Min ${days} ${dowLabel} per ${period.value} ${period.type}`,
      entityScopeValue,
    );

    const targetMembers = resolveMembersFromScope(entityScopeValue, [...ctx.members]);
    const targetDows = new Set(dayOfWeek);
    const chunks =
      period.type === "weeks"
        ? groupWeekChunks([...ctx.days], period.value, ctx.weekStartsOn)
        : splitIntoMonths([...ctx.days], period.value);

    const artifacts = targetMembers.flatMap((member) =>
      chunks.flatMap((chunkDays) => {
        const chunkStart = chunkDays[0];
        if (!chunkStart) return [];

        const matchingDays = chunkDays.filter((day) => targetDows.has(day.dayOfWeek));
        if (matchingDays.length === 0) return [];

        const supportArtifacts = matchingDays.flatMap(
          (day) =>
            buildAssignedDayIndicator({
              memberId: member.id,
              day,
              assignmentVars: assignmentVarsForDay(member, day, ctx.shiftPatterns),
            }).artifacts,
        );

        const assignedDayVars = matchingDays
          .filter((day) => assignmentVarsForDay(member, day, ctx.shiftPatterns).length > 0)
          .map((day) => assignedDayVariableName(member.id, day.iso));
        if (assignedDayVars.length === 0) return supportArtifacts;

        const description = `${member.id} min ${days} ${dowLabel} in period starting ${chunkStart.iso}`;
        const context = { memberIds: [member.id], days: matchingDays.map((day) => day.iso) };
        const constraintId = `min-days-of-week-per-period:${member.id}:${chunkStart.iso}`;
        const terms = assignedDayVars.map((varName) => ({ var: varName, coeff: 1 }));

        const finalArtifacts =
          priority === "MANDATORY"
            ? [
                hardConstraint({
                  group,
                  description,
                  context,
                  validation: reportValidation(constraintId),
                  terms,
                  comparator: ">=",
                  targetValue: days,
                }),
                {
                  kind: "pre-solve-feedback" as const,
                  run(_preSolveContext: RuleCompileContext, reporter: ValidationReporter) {
                    const possibleDays = matchingDays.filter((day) =>
                      hasAnyAssignablePattern(member, day, ctx.shiftPatterns),
                    ).length;
                    if (possibleDays >= days) return;
                    reporter.reportRuleError({
                      rule: "min-days-of-week-per-period",
                      message: `${member.id} cannot reach ${days} ${dowLabel} assignments in the period starting ${chunkStart.iso}; only ${possibleDays} matching day${possibleDays === 1 ? " is" : "s are"} assignable.`,
                      context,
                      suggestions: [
                        `Reduce the ${dowLabel} minimum in this period`,
                        `Add more assignable ${dowLabel} shifts in the period starting ${chunkStart.iso}`,
                      ],
                      group,
                    });
                  },
                },
              ]
            : [
                softConstraint({
                  group,
                  description,
                  context,
                  validation: reportValidation(),
                  terms,
                  comparator: ">=",
                  targetValue: days,
                  penalty: priorityToPenalty(priority),
                  constraintId,
                }),
              ];

        return supportArtifacts.concat(finalArtifacts);
      }),
    );

    return {
      rule: "min-days-of-week-per-period",
      artifacts,
    };
  },
});
