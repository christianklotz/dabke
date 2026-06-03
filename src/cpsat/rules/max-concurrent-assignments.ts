import * as z from "zod";
import type { TimeOfDay } from "../../types.js";
import { defineRuleDescriptor } from "../rule-descriptor.js";
import {
  MINUTES_PER_DAY,
  normalizeEndMinutes,
  priorityToPenalty,
  timeOfDayToMinutes,
} from "../utils.js";
import {
  PrioritySchema,
  entityScope,
  parseEntityScope,
  parseTimeScope,
  resolveActiveDaysFromScope,
  resolveMembersFromScope,
  ruleGroup,
  timeScope,
} from "./scope.types.js";
import { hardConstraint, reportValidation, softConstraint } from "./artifacts.js";
import {
  buildConcurrentAssignmentSegments,
  collectConcurrentAssignmentIntervals,
  resolveConcurrentWindow,
} from "./concurrent-intervals.js";

const timeOfDaySchema = z.object({
  hours: z.number().int().min(0).max(23),
  minutes: z.number().int().min(0).max(59),
});

export const MaxConcurrentAssignmentsSchema = z
  .object({
    assignments: z.number().int().min(0),
    priority: PrioritySchema,
    startTime: timeOfDaySchema.optional(),
    endTime: timeOfDaySchema.optional(),
  })
  .and(entityScope(["members", "roles", "skills"]))
  .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]))
  .refine(
    (config) => {
      const hasStartTime = config.startTime !== undefined;
      const hasEndTime = config.endTime !== undefined;
      return hasStartTime === hasEndTime;
    },
    {
      message:
        "Both startTime and endTime must be provided together for partial day concurrent-assignment caps",
    },
  );

/**
 * Configuration for {@link maxConcurrentAssignmentsRuleDescriptor}.
 */
export type MaxConcurrentAssignmentsConfig = z.infer<typeof MaxConcurrentAssignmentsSchema>;

/**
 * Low-level descriptor for the `max-concurrent-assignments` rule.
 *
 * @remarks
 * Caps how many targeted members may be assigned at the same time. Use it for
 * physical capacity constraints that should remain independent from coverage
 * floors. Unlike {@link import("./max-shifts-day.js").maxShiftsDayRuleDescriptor},
 * this counts concurrent overlap, not total assignments on a day.
 *
 * @category Rules
 */
export const maxConcurrentAssignmentsRuleDescriptor = defineRuleDescriptor({
  name: "max-concurrent-assignments",
  schema: MaxConcurrentAssignmentsSchema,
  compile(config, ctx) {
    const { assignments, priority, startTime, endTime } = config;
    const entityScopeValue = parseEntityScope(config);
    const timeScopeValue = parseTimeScope(config);
    const targetMembers = resolveMembersFromScope(entityScopeValue, [...ctx.members]);
    const activeDays = resolveActiveDaysFromScope(timeScopeValue, [...ctx.days]);

    if (targetMembers.length === 0 || activeDays.length === 0) {
      return { rule: "max-concurrent-assignments", artifacts: [] };
    }

    const windowStart = startTime ? timeOfDayToMinutes(startTime) : undefined;
    const windowEnd =
      startTime && endTime
        ? normalizeEndMinutes(windowStart ?? 0, timeOfDayToMinutes(endTime))
        : undefined;
    const windowKey = buildWindowKey(startTime, endTime);
    const windowLabel = buildWindowLabel(startTime, endTime);
    const group = ruleGroup(
      `max-concurrent-assignments:${assignments}:${windowKey}`,
      `Max ${assignments} concurrent assignment${assignments === 1 ? "" : "s"}${windowLabel}`,
      entityScopeValue,
      timeScopeValue,
    );

    const artifacts = activeDays.flatMap((day) => {
      const dayContext = { days: [day.iso], memberIds: targetMembers.map((member) => member.id) };
      const intervals = collectConcurrentAssignmentIntervals(day, targetMembers, ctx.shiftPatterns);
      const window = resolveConcurrentWindow(intervals, windowStart, windowEnd);
      const segments = buildConcurrentAssignmentSegments(intervals, window.start, window.end);

      return segments.flatMap((segment) => {
        const description = `Max ${assignments} concurrent assignment${assignments === 1 ? "" : "s"} on ${day.iso} (${formatTimeRange(segment.start, segment.end)})`;
        const constraintId = `${group.key}:${day.iso}:${segment.start}`;
        const linearTerms = segment.varNames.map((varName) => ({ var: varName, coeff: 1 }));

        return [
          priority === "MANDATORY"
            ? hardConstraint({
                group,
                description,
                context: dayContext,
                validation: reportValidation(constraintId),
                terms: linearTerms,
                comparator: "<=",
                targetValue: assignments,
              })
            : softConstraint({
                group,
                description,
                context: dayContext,
                validation: reportValidation(),
                terms: linearTerms,
                comparator: "<=",
                targetValue: assignments,
                penalty: priorityToPenalty(priority),
                constraintId,
              }),
        ];
      });
    });

    return {
      rule: "max-concurrent-assignments",
      artifacts,
    };
  },
});

function buildWindowKey(startTime?: TimeOfDay, endTime?: TimeOfDay): string {
  if (!startTime || !endTime) {
    return "all-day";
  }

  return `${formatTimeKey(startTime)}-${formatTimeKey(endTime)}`;
}

function buildWindowLabel(startTime?: TimeOfDay, endTime?: TimeOfDay): string {
  if (!startTime || !endTime) {
    return "";
  }

  return ` (${formatTimeKey(startTime)}-${formatTimeKey(endTime)})`;
}

function formatTimeRange(startMinutes: number, endMinutes: number): string {
  return `${formatClockMinutes(startMinutes)}-${formatClockMinutes(endMinutes)}`;
}

function formatTimeKey(time: TimeOfDay): string {
  return `${String(time.hours).padStart(2, "0")}:${String(time.minutes ?? 0).padStart(2, "0")}`;
}

function formatClockMinutes(totalMinutes: number): string {
  const normalized = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
