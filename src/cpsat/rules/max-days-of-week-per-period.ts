import * as z from "zod";
import { DayOfWeekSchema } from "../../types.js";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import { groupWeekChunks, priorityToPenalty, splitIntoMonths } from "../utils.js";
import {
  PrioritySchema,
  entityScope,
  parseEntityScope,
  resolveMembersFromScope,
  ruleGroup,
} from "./scope.types.js";
import { assignmentVarsForDay } from "./assignment-terms.js";
import { assignedDayVariableName } from "./variables.js";
import { hardConstraint, reportValidation, softConstraint } from "./artifacts.js";
import { buildAssignedDayIndicator } from "./assigned-day.js";

const PeriodSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("weeks"), value: z.number().int().min(1) }),
  z.object({ type: z.literal("months"), value: z.number().int().min(1) }),
]);

const MaxDaysOfWeekPerPeriodBase = z.object({
  days: z.number().int().min(0),
  dayOfWeek: z.array(DayOfWeekSchema).nonempty(),
  period: PeriodSchema,
  priority: PrioritySchema,
});

export const MaxDaysOfWeekPerPeriodSchema = MaxDaysOfWeekPerPeriodBase.and(
  entityScope(["members", "roles", "skills"]),
);

/**
 * Configuration for {@link maxDaysOfWeekPerPeriodRuleDescriptor}.
 */
export type MaxDaysOfWeekPerPeriodConfig = z.infer<typeof MaxDaysOfWeekPerPeriodSchema>;

/**
 * Low-level descriptor for the `max-days-of-week-per-period` rule.
 *
 * @remarks
 * This rule counts assigned days matching the configured days of the week.
 * Week-based periods align to `weekStartsOn`; month-based periods align to
 * calendar month boundaries.
 *
 * @category Rules
 */
export const maxDaysOfWeekPerPeriodRuleDescriptor = defineRuleDescriptor({
  name: "max-days-of-week-per-period",
  schema: MaxDaysOfWeekPerPeriodSchema,
  compile(config, ctx) {
    const entityScopeValue = parseEntityScope(config);
    const { days, dayOfWeek, period, priority } = config;
    const dowLabel = dayOfWeek.toSorted().join(",");
    const periodLabel = `${period.value}${period.type === "weeks" ? "w" : "m"}`;
    const group = ruleGroup(
      `max-days-of-week-per-period:${days}:${dowLabel}:${periodLabel}`,
      `Max ${days} ${dowLabel} per ${period.value} ${period.type}`,
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

        const description = `${member.id} max ${days} ${dowLabel} in period starting ${chunkStart.iso}`;
        const context = { memberIds: [member.id], days: matchingDays.map((day) => day.iso) };
        const constraintId = `max-days-of-week-per-period:${member.id}:${chunkStart.iso}`;
        const terms = assignedDayVars.map((varName) => ({ var: varName, coeff: 1 }));

        const finalArtifact =
          priority === "MANDATORY"
            ? hardConstraint({
                group,
                description,
                context,
                validation: reportValidation(constraintId),
                terms,
                comparator: "<=",
                targetValue: days,
              })
            : softConstraint({
                group,
                description,
                context,
                validation: reportValidation(),
                terms,
                comparator: "<=",
                targetValue: days,
                penalty: priorityToPenalty(priority),
                constraintId,
              });

        return supportArtifacts.concat(finalArtifact);
      }),
    );

    return {
      rule: "max-days-of-week-per-period",
      artifacts,
    };
  },
});
