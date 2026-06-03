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
