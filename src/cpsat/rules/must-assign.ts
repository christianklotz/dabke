import * as z from "zod";
import { DayOfWeekSchema } from "../../types.js";
import type { CompilationRule } from "../model-builder.js";
import type { Term } from "../types.js";
import { priorityToPenalty, splitIntoWeeks } from "../utils.js";
import {
  entityScope,
  parseEntityScope,
  resolveMembersFromScope,
  ruleGroup,
} from "./scope.types.js";

/** Internally always HIGH. Not user-configurable. */
const MUST_ASSIGN_PENALTY = priorityToPenalty("HIGH");

const MustAssignSchema = z
  .object({
    weekStartsOn: DayOfWeekSchema.optional(),
  })
  .and(entityScope(["members", "roles", "skills"]));

/**
 * Configuration for {@link createMustAssignRule}.
 *
 * - `weekStartsOn` (optional): which day starts the week; defaults to
 *   {@link ModelBuilder.weekStartsOn}
 *
 * Entity scoping (at most one): `memberIds`, `roleIds`, `skillIds`
 */
export type MustAssignConfig = z.infer<typeof MustAssignSchema>;

/**
 * Guarantees that targeted members appear on the schedule.
 *
 * @remarks
 * Use this for staffing obligations: salaried employees who are paid
 * regardless of whether they work, or contracted staff who must be
 * rostered. The solver ensures each targeted member has at least one
 * assignment per scheduling week.
 *
 * Always compiles as a soft constraint (HIGH priority internally) so the
 * schedule still generates when a member genuinely cannot be placed
 * (e.g., full week of absences, no compatible shift patterns). Violations
 * surface as validation warnings with distinct messaging from
 * `min-days-week`.
 *
 * Unlike {@link createMinDaysWeekRule}, this rule communicates a staffing
 * obligation rather than a scheduling preference. Validation messages
 * reflect this: "Alice was not assigned (staffing obligation)" rather
 * than "Alice worked 0 days, minimum was 1."
 *
 * @param config - See {@link MustAssignConfig}
 *
 * @example Ensure a salaried manager is always rostered
 * ```ts
 * createMustAssignRule({ memberIds: ["diana"] });
 * ```
 *
 * @example Ensure all supervisors appear on the rota
 * ```ts
 * createMustAssignRule({ roleIds: ["supervisor"] });
 * ```
 */
export function createMustAssignRule(config: MustAssignConfig): CompilationRule {
  const parsed = MustAssignSchema.parse(config);
  const scope = parseEntityScope(parsed);
  const { weekStartsOn } = parsed;
  const group = ruleGroup("must-assign", "Must assign", scope);

  return {
    compile(b) {
      const members = resolveMembersFromScope(scope, b.members);
      const weeks = splitIntoWeeks(b.days, weekStartsOn ?? b.weekStartsOn);

      for (const emp of members) {
        for (const weekDays of weeks) {
          const terms: Term[] = [];

          for (const day of weekDays) {
            for (const pattern of b.shiftPatterns) {
              if (!b.canAssign(emp, pattern)) continue;
              if (!b.patternAvailableOnDay(pattern, day)) continue;
              terms.push({ var: b.assignment(emp.id, pattern.id, day), coeff: 1 });
            }
          }

          if (terms.length === 0) continue;

          const weekLabel = weekDays[0]!;
          const constraintId = `must-assign:${emp.id}:${weekLabel}`;

          b.addSoftLinear(terms, ">=", 1, MUST_ASSIGN_PENALTY, constraintId);
          b.reporter.trackConstraint({
            id: constraintId,
            type: "rule",
            rule: "must-assign",
            description: `${emp.id} not assigned in week starting ${weekLabel} (staffing obligation)`,
            targetValue: 1,
            comparator: ">=",
            day: weekLabel,
            context: { memberIds: [emp.id], days: weekDays },
            group,
          });
        }
      }
    },
  };
}
