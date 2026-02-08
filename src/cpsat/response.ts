import type { SolverResponse } from "../client.types.js";
import type { ShiftPattern } from "./types.js";
import type { TimeOfDay } from "../types.js";

/**
 * A shift assignment extracted from the solver response.
 */
export interface ShiftAssignment {
  employeeId: string;
  shiftPatternId: string;
  day: string;
}

/**
 * A shift assignment with resolved times.
 */
export interface ResolvedShiftAssignment {
  employeeId: string;
  day: string;
  startTime: TimeOfDay;
  endTime: TimeOfDay;
}

/**
 * Parsed solver result with assignments and metadata.
 */
export interface SolverResult {
  status: SolverResponse["status"];
  assignments: ShiftAssignment[];
  statistics?: SolverResponse["statistics"];
  error?: string;
}

/**
 * Extracts shift assignments from solver response.
 *
 * Parses variable names matching the pattern `assign:${employeeId}:${patternId}:${day}`
 * and returns assignments where the variable value is 1 (true).
 *
 * @remarks
 * IDs are validated by ModelBuilder to not contain colons,
 * ensuring unambiguous parsing.
 *
 * @param response - The solver response containing variable values
 * @returns Parsed schedule result with assignments
 *
 * @example
 * ```typescript
 * const response = await client.solve(request);
 * const result = parseSolverResponse(response);
 *
 * if (result.status === "OPTIMAL" || result.status === "FEASIBLE") {
 *   for (const assignment of result.assignments) {
 *     console.log(`${assignment.employeeId} works ${assignment.shiftPatternId} on ${assignment.day}`);
 *   }
 * }
 * ```
 */
export function parseSolverResponse(response: SolverResponse): SolverResult {
  if (response.status === "INFEASIBLE" || response.status === "ERROR") {
    return {
      status: response.status,
      assignments: [],
      statistics: response.statistics,
      error: response.error,
    };
  }

  const assignments: ShiftAssignment[] = [];

  for (const [varName, value] of Object.entries(response.values ?? {})) {
    if (value !== 1) continue;
    if (!varName.startsWith("assign:")) continue;

    // Pattern: assign:${employeeId}:${patternId}:${day}
    // IDs are validated to not contain colons, so splitting is unambiguous.
    const parts = varName.split(":");
    if (parts.length !== 4) continue;

    const [, employeeId, shiftPatternId, day] = parts;
    if (!employeeId || !shiftPatternId || !day) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;

    assignments.push({ employeeId, shiftPatternId, day });
  }

  return {
    status: response.status,
    assignments,
    statistics: response.statistics,
  };
}

/**
 * Resolves shift assignments to concrete times using shift patterns.
 *
 * @param assignments - Raw assignments from parseScheduleResult
 * @param shiftPatterns - The shift patterns used in the model
 * @returns Assignments with resolved start/end times
 *
 * @example
 * ```typescript
 * const result = parseScheduleResult(response);
 * const resolved = resolveAssignments(result.assignments, shiftPatterns);
 *
 * for (const shift of resolved) {
 *   console.log(`${shift.employeeId} works ${shift.day} from ${shift.startTime.hours}:${shift.startTime.minutes}`);
 * }
 * ```
 */
export function resolveAssignments(
  assignments: ShiftAssignment[],
  shiftPatterns: ShiftPattern[],
): ResolvedShiftAssignment[] {
  const patternMap = new Map(shiftPatterns.map((p) => [p.id, p]));

  return assignments
    .map((a) => {
      const pattern = patternMap.get(a.shiftPatternId);
      if (!pattern) return null;

      return {
        employeeId: a.employeeId,
        day: a.day,
        startTime: pattern.startTime,
        endTime: pattern.endTime,
      };
    })
    .filter((a): a is ResolvedShiftAssignment => a !== null);
}
