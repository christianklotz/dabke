/**
 * Time period primitives: day constants and semantic time constructors.
 *
 * Semantic times are business-relevant scheduling periods used to group
 * coverage and rules. Some come directly from the requirements, for example opening,
 * lunch, or closing. Others are inferred from the requirements so different
 * parts of a day can carry different coverage floors or constraints.
 *
 * An unscoped `time(...)` entry applies every day in the scheduling period.
 * Names are descriptive only, they do not scope a time to a day. If a time is
 * day-specific, add `dayOfWeek` or `dates` explicitly.
 *
 * @example
 * ```typescript
 * times: {
 *   lunch: time({ startTime: t(12), endTime: t(15) }),
 *   dinner: time(
 *     { startTime: t(17), endTime: t(21) },
 *     { startTime: t(18), endTime: t(22), dayOfWeek: weekend },
 *   ),
 *   thursday_open: time({ startTime: t(10), endTime: t(11), dayOfWeek: ["thursday"] }),
 * }
 * ```
 *
 * @module
 */

import type { DayOfWeek, TimeOfDay } from "../types.js";
import type {
  SemanticTimeDef,
  SemanticTimeVariant,
  SemanticTimeEntry,
} from "../cpsat/semantic-time.js";

/**
 * Creates a {@link TimeOfDay} value.
 *
 * @param hours - Hour component (0-23)
 * @param minutes - Minute component (0-59)
 *
 * @category Time Periods
 */
export function t(hours: number, minutes = 0): TimeOfDay {
  return { hours, minutes };
}

/**
 * Monday through Friday.
 *
 * @category Time Periods
 */
export const weekdays = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
] as const satisfies readonly [DayOfWeek, ...DayOfWeek[]];

/**
 * Saturday and Sunday.
 *
 * @category Time Periods
 */
export const weekend = ["saturday", "sunday"] as const satisfies readonly [
  DayOfWeek,
  ...DayOfWeek[],
];

/**
 * Define a named semantic time period.
 *
 * @remarks
 * Each entry has `startTime`/`endTime` and optional `dayOfWeek` or `dates`
 * scoping. Entries without scoping are the default and apply every day in the
 * scheduling period. The surrounding object key is only a name, it does not
 * add scope. For example, `thursday_open: time({ startTime: ..., endTime: ... })`
 * still applies on Monday, Tuesday, and every other scheduling day unless you
 * add `dayOfWeek: ["thursday"]`.
 *
 * Use semantic times to represent business periods, not shift patterns. Some
 * periods have explicit boundaries in the requirements. Others are inferred so
 * related coverage and rules can attach to the correct part of the day. Choose
 * the simplest set of semantic times that preserves the business distinctions
 * you need.
 *
 * Avoid adding a broad all-day semantic time when narrower windows already
 * describe the day's distinct requirements. If opening, core trading, and
 * closing each need different coverage, model those windows directly instead
 * of layering an extra whole-day period on top unless the lower bound truly
 * applies for the full span.
 *
 * @privateRemarks
 * Resolution precedence: `dates` > `dayOfWeek` > default.
 *
 * @category Time Periods
 */
export function time(
  ...entries: [SemanticTimeVariant, ...SemanticTimeVariant[]]
): SemanticTimeEntry {
  // Validate: at most one default (no dayOfWeek and no dates)
  const defaults = entries.filter((e) => !e.dayOfWeek && !e.dates);
  if (defaults.length > 1) {
    throw new Error(
      "time() accepts at most one default entry (without dayOfWeek or dates). " +
        `Found ${defaults.length} default entries.`,
    );
  }

  // Single entry without scoping: simple SemanticTimeDef
  if (entries.length === 1 && !entries[0].dayOfWeek && !entries[0].dates) {
    return {
      startTime: entries[0].startTime,
      endTime: entries[0].endTime,
    } satisfies SemanticTimeDef;
  }

  // Multiple entries or scoped entries: shallow-copy to decouple from caller
  return entries.map((entry) => Object.assign({}, entry));
}
