import * as z from "zod";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import { targetPeakPriorityToPenalty } from "../utils.js";
import {
  boolVariable,
  hardConstraint,
  intVariable,
  reportValidation,
  skipValidation,
  softConstraint,
} from "./artifacts.js";
import {
  buildConcurrentAssignmentSegments,
  collectConcurrentAssignmentIntervals,
  resolveConcurrentWindow,
} from "./concurrent-intervals.js";
import {
  entityScope,
  parseEntityScope,
  parseTimeScope,
  resolveActiveDaysFromScope,
  resolveMembersFromScope,
  ruleGroup,
  SoftPrioritySchema,
  timeScope,
} from "./scope.types.js";

export const TargetPeakConcurrentAssignmentsSchema = z
  .object({
    assignments: z.number().int().min(0),
    priority: SoftPrioritySchema.default("HIGH"),
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));

/**
 * Configuration for {@link targetPeakConcurrentAssignmentsRuleDescriptor}.
 */
export type TargetPeakConcurrentAssignmentsConfig = z.infer<
  typeof TargetPeakConcurrentAssignmentsSchema
>;

/** @internal */
export const TARGET_PEAK_CONCURRENT_ASSIGNMENTS_OBJECTIVE_STAGE_ID =
  "__dabke_target_peak_concurrent_assignments__";

/**
 * Low-level descriptor for the `target-peak-concurrent-assignments` rule.
 *
 * @remarks
 * Softly targets the daily peak number of concurrent targeted assignments
 * within the scoped day set. This is not a lower bound across the whole day.
 * Use {@link import("../../schedule/coverage.js").cover} for whole-window
 * minimum staffing, and pair this rule with
 * {@link import("./max-concurrent-assignments.js").maxConcurrentAssignmentsRuleDescriptor}
 * when the same value is also a hard capacity cap.
 *
 * @category Rules
 */
export const targetPeakConcurrentAssignmentsRuleDescriptor = defineRuleDescriptor({
  name: "target-peak-concurrent-assignments",
  schema: TargetPeakConcurrentAssignmentsSchema,
  compile(config, ctx) {
    const { assignments, priority } = config;
    if (assignments === 0) {
      return { rule: "target-peak-concurrent-assignments", artifacts: [] };
    }

    const entityScopeValue = parseEntityScope(config);
    const timeScopeValue = parseTimeScope(config);
    const targetMembers = resolveMembersFromScope(entityScopeValue, [...ctx.members]);
    const activeDays = resolveActiveDaysFromScope(timeScopeValue, [...ctx.days]);

    if (activeDays.length === 0) {
      return { rule: "target-peak-concurrent-assignments", artifacts: [] };
    }

    const group = ruleGroup(
      `target-peak-concurrent-assignments:${assignments}`,
      `Target peak ${assignments} concurrent assignment${assignments === 1 ? "" : "s"}`,
      entityScopeValue,
      timeScopeValue,
    );

    const artifacts = activeDays.flatMap((day) => {
      const dayContext = { days: [day.iso], memberIds: targetMembers.map((member) => member.id) };
      const intervals = collectConcurrentAssignmentIntervals(day, targetMembers, ctx.shiftPatterns);
      const window = resolveConcurrentWindow(intervals);
      const segments = buildConcurrentAssignmentSegments(intervals, window.start, window.end);
      const dayKey = `${group.key}:${day.iso}`;
      const shortfallVar = `${dayKey}:shortfall`;

      if (segments.length === 0) {
        return [
          intVariable(shortfallVar, 0, assignments),
          hardConstraint({
            group,
            description: `Fix peak-target shortfall to ${assignments} on ${day.iso} because no eligible assignments exist`,
            context: dayContext,
            validation: skipValidation(
              "scaffolding",
              "Peak-target shortfall is fixed when no eligible assignments can contribute to the daily peak.",
            ),
            terms: [{ var: shortfallVar, coeff: 1 }],
            comparator: "==",
            targetValue: assignments,
          }),
          softConstraint({
            stage: TARGET_PEAK_CONCURRENT_ASSIGNMENTS_OBJECTIVE_STAGE_ID,
            group,
            description: `Target peak ${assignments} concurrent assignment${assignments === 1 ? "" : "s"} on ${day.iso}`,
            context: dayContext,
            validation: reportValidation(),
            terms: [{ var: shortfallVar, coeff: 1 }],
            comparator: "<=",
            targetValue: 0,
            penalty: targetPeakPriorityToPenalty(priority),
            constraintId: `${dayKey}:shortfall`,
          }),
        ];
      }

      const witnessVars = segments.map((segment) => ({
        segmentStart: segment.start,
        name: `${dayKey}:${segment.start}:witness`,
      }));

      const helperArtifacts = [
        intVariable(shortfallVar, 0, assignments),
        ...witnessVars.map(({ name }) => boolVariable(name)),
        hardConstraint({
          group,
          description: `Select exactly one peak segment witness on ${day.iso}`,
          context: dayContext,
          validation: skipValidation(
            "scaffolding",
            "Peak-target witness selection is an internal helper for day-level peak targeting.",
          ),
          terms: witnessVars.map(({ name }) => ({ var: name, coeff: 1 })),
          comparator: "==",
          targetValue: 1,
        }),
      ];

      const linkageArtifacts = segments.map((segment) => {
        const witnessVar = witnessVars.find(
          (witness) => witness.segmentStart === segment.start,
        )?.name;
        if (!witnessVar) {
          throw new Error(
            `Missing peak-target witness variable for segment ${segment.start} on ${day.iso}`,
          );
        }

        return hardConstraint({
          group,
          description: `Link peak-target shortfall to segment ${formatTimeRange(segment.start, segment.end)} on ${day.iso}`,
          context: dayContext,
          validation: skipValidation(
            "scaffolding",
            "Peak-target segment linkage is an internal helper that selects the best segment on a day.",
          ),
          terms: [
            ...segment.varNames.map((varName) => ({ var: varName, coeff: 1 })),
            { var: witnessVar, coeff: -assignments },
            { var: shortfallVar, coeff: 1 },
          ],
          comparator: ">=",
          targetValue: 0,
        });
      });

      const shortfallArtifact = softConstraint({
        stage: TARGET_PEAK_CONCURRENT_ASSIGNMENTS_OBJECTIVE_STAGE_ID,
        group,
        description: `Target peak ${assignments} concurrent assignment${assignments === 1 ? "" : "s"} on ${day.iso}`,
        context: dayContext,
        validation: reportValidation(),
        terms: [{ var: shortfallVar, coeff: 1 }],
        comparator: "<=",
        targetValue: 0,
        penalty: targetPeakPriorityToPenalty(priority),
        constraintId: `${dayKey}:shortfall`,
      });

      const dayArtifacts: Array<
        | (typeof helperArtifacts)[number]
        | (typeof linkageArtifacts)[number]
        | typeof shortfallArtifact
      > = [];
      dayArtifacts.push(...helperArtifacts, ...linkageArtifacts, shortfallArtifact);
      return dayArtifacts;
    });

    return {
      rule: "target-peak-concurrent-assignments",
      artifacts,
    };
  },
});

function formatTimeRange(startMinutes: number, endMinutes: number): string {
  return `${formatClockMinutes(startMinutes)}-${formatClockMinutes(endMinutes)}`;
}

function formatClockMinutes(totalMinutes: number): string {
  const minutesPerDay = 24 * 60;
  const normalized = ((totalMinutes % minutesPerDay) + minutesPerDay) % minutesPerDay;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
