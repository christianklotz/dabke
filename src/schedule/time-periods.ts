/**
 * Time period primitives: day constants and time constructors.
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
 * @example Hours only
 * ```ts
 * t(9)   // { hours: 9, minutes: 0 }
 * ```
 *
 * @example Hours and minutes
 * ```ts
 * t(17, 30)  // { hours: 17, minutes: 30 }
 * ```
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
 * scoping. Entries without scoping are the default.
 *
 * @example
 * ```typescript
 * times: {
 *   // Simple: same times every day
 *   lunch: time({ startTime: t(12), endTime: t(15) }),
 *
 *   // Variants: different times on weekends
 *   dinner: time(
 *     { startTime: t(17), endTime: t(21) },
 *     { startTime: t(18), endTime: t(22), dayOfWeek: weekend },
 *   ),
 *
 *   // Point-in-time window (keyholder at opening)
 *   opening: time({ startTime: t(8, 30), endTime: t(9) }),
 * }
 * ```
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
