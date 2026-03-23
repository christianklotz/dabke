/**
 * Shift pattern definitions: time slots available for employee assignment.
 *
 * @module
 */

import type { TimeOfDay } from "../types.js";
import type { ShiftPattern } from "../cpsat/types.js";

/**
 * Define a shift pattern: a time slot available for employee assignment.
 *
 * @remarks
 * Each pattern repeats daily unless filtered by `dayOfWeek`.
 *
 * @example
 * ```typescript
 * shiftPatterns: [
 *   shift("morning", t(11, 30), t(15)),
 *   shift("evening", t(17), t(22)),
 *
 *   // Role-restricted shift
 *   shift("kitchen", t(6), t(14), { roleIds: ["chef", "prep_cook"] }),
 *
 *   // Day-restricted shift
 *   shift("saturday_short", t(9), t(14), { dayOfWeek: ["saturday"] }),
 *
 *   // Location-specific shift
 *   shift("terrace_lunch", t(12), t(16), { locationId: "terrace" }),
 * ]
 * ```
 *
 * @category Shift Patterns
 */
export function shift(
  id: string,
  startTime: TimeOfDay,
  endTime: TimeOfDay,
  opts?: Pick<ShiftPattern, "roleIds" | "dayOfWeek" | "locationId">,
): ShiftPattern {
  const pattern: ShiftPattern = { id, startTime, endTime };
  if (opts?.roleIds) pattern.roleIds = opts.roleIds;
  if (opts?.dayOfWeek) pattern.dayOfWeek = opts.dayOfWeek;
  if (opts?.locationId) pattern.locationId = opts.locationId;
  return pattern;
}
