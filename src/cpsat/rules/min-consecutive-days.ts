import * as z from "zod";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import type { RuleArtifact } from "../rule-descriptor.js";
import { priorityToPenalty } from "../utils.js";
import {
  PrioritySchema,
  entityScope,
  parseEntityScope,
  resolveMembersFromScope,
  ruleGroup,
} from "./scope.types.js";
import { assignmentVarsForDay } from "./assignment-terms.js";
import { assignedDayStartVariableName } from "./variables.js";
import {
  boolVariable,
  hardConstraint,
  reportValidation,
  skipValidation,
  softConstraint,
} from "./artifacts.js";
import { buildAssignedDayIndicator } from "./assigned-day.js";

export const MinConsecutiveDaysSchema = z
  .object({
    days: z.number().min(0),
    priority: PrioritySchema,
  })
  .and(entityScope(["members", "roles", "skills"]));

/**
 * Configuration for {@link minConsecutiveDaysRuleDescriptor}.
 */
export type MinConsecutiveDaysConfig = z.infer<typeof MinConsecutiveDaysSchema>;

/**
 * Low-level descriptor for the `min-consecutive-days` rule.
 *
 * @remarks
 * Once an assignment streak starts, this rule requires it to continue for at
 * least the configured number of assigned days.
 *
 * @category Rules
 */
export const minConsecutiveDaysRuleDescriptor = defineRuleDescriptor({
  name: "min-consecutive-days",
  schema: MinConsecutiveDaysSchema,
  compile(config, ctx) {
    const scope = parseEntityScope(config);
    const { days, priority } = config;
    const group = ruleGroup(`min-consecutive-days:${days}`, `Min ${days} consecutive days`, scope);
    if (days <= 1) {
      return { rule: "min-consecutive-days", artifacts: [] };
    }

    const members = resolveMembersFromScope(scope, [...ctx.members]);
    const artifacts = members.flatMap((member) => {
      const supportArtifacts = ctx.days.flatMap(
        (day) =>
          buildAssignedDayIndicator({
            memberId: member.id,
            day,
            assignmentVars: assignmentVarsForDay(member, day, ctx.shiftPatterns),
            variableName: `assigned_${member.id}_${day.iso}`,
          }).artifacts,
      );

      const startArtifacts = ctx.days.flatMap((day, index) => {
        const assignedToday = `assigned_${member.id}_${day.iso}`;
        const assignedYesterday =
          index > 0 ? `assigned_${member.id}_${ctx.days[index - 1]!.iso}` : undefined;
        const startVar = assignedDayStartVariableName(member.id, day.iso);
        const artifactsForDay: RuleArtifact[] = [boolVariable(startVar)];

        artifactsForDay.push(
          hardConstraint({
            description: `${startVar} implies an assignment on ${day.iso}`,
            validation: skipValidation(
              "scaffolding",
              "This helper variable only marks the start of an assignment streak when the member has an assignment that day.",
            ),
            context: { memberIds: [member.id], days: [day.iso] },
            terms: [
              { var: startVar, coeff: 1 },
              { var: assignedToday, coeff: -1 },
            ],
            comparator: "<=",
            targetValue: 0,
          }),
        );

        if (assignedYesterday) {
          artifactsForDay.push(
            hardConstraint({
              description: `${startVar} only when previous day is unassigned`,
              validation: skipValidation(
                "scaffolding",
                "This helper variable must stay off when the previous day already belongs to the same assignment streak.",
              ),
              context: { memberIds: [member.id], days: [ctx.days[index - 1]!.iso, day.iso] },
              terms: [
                { var: startVar, coeff: 1 },
                { var: assignedYesterday, coeff: 1 },
              ],
              comparator: "<=",
              targetValue: 1,
            }),
          );
          artifactsForDay.push(
            hardConstraint({
              description: `${startVar} activates on a new assignment streak`,
              validation: skipValidation(
                "scaffolding",
                "This helper variable identifies new assignment streak boundaries for the consecutive-days window calculation.",
              ),
              context: { memberIds: [member.id], days: [ctx.days[index - 1]!.iso, day.iso] },
              terms: [
                { var: startVar, coeff: 1 },
                { var: assignedYesterday, coeff: 1 },
                { var: assignedToday, coeff: -1 },
              ],
              comparator: ">=",
              targetValue: 0,
            }),
          );
        } else {
          artifactsForDay.push(
            hardConstraint({
              description: `${startVar} matches first-day assignment state`,
              validation: skipValidation(
                "scaffolding",
                "On the first day of the horizon, the helper variable matches whether a new streak starts that day.",
              ),
              context: { memberIds: [member.id], days: [day.iso] },
              terms: [
                { var: startVar, coeff: 1 },
                { var: assignedToday, coeff: -1 },
              ],
              comparator: ">=",
              targetValue: 0,
            }),
          );
        }

        const windowDays = ctx.days.slice(index, index + days);
        if (windowDays.length === 0) return artifactsForDay;

        const description = `${member.id} min ${days} consecutive days from ${day.iso}`;
        const context = { memberIds: [member.id], days: windowDays.map((entry) => entry.iso) };
        const constraintId = `min-consecutive-days:${member.id}:${day.iso}`;
        const terms = [
          ...windowDays.map((windowDay) => ({
            var: `assigned_${member.id}_${windowDay.iso}`,
            coeff: 1,
          })),
          { var: startVar, coeff: -days },
        ];

        artifactsForDay.push(
          priority === "MANDATORY"
            ? hardConstraint({
                group,
                description,
                context,
                validation: reportValidation(constraintId),
                terms,
                comparator: ">=",
                targetValue: 0,
              })
            : softConstraint({
                group,
                description,
                context,
                validation: reportValidation(),
                terms,
                comparator: ">=",
                targetValue: 0,
                penalty: priorityToPenalty(priority),
                constraintId,
              }),
        );

        return artifactsForDay;
      });

      return supportArtifacts.concat(startArtifacts);
    });

    return {
      rule: "min-consecutive-days",
      artifacts,
    };
  },
});
