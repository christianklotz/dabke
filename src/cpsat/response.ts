import type { SolverResponse } from "../client.types.js";
import type { ShiftPattern } from "./types.js";
import type { TimeOfDay } from "../types.js";

/**
 * A raw assignment from the solver: which member works which shift on which day.
 *
 * @category Solver
 */
export interface ShiftAssignment {
  /** The assigned member's ID. */
  memberId: string;
  /** The shift pattern this member is assigned to. */
  shiftPatternId: string;
  /** The date of the assignment (YYYY-MM-DD). */
  day: string;
}

/**
 * A shift assignment with resolved times.
 *
 * @category Solver
 */
export interface ResolvedShiftAssignment {
  /** The assigned member's ID. */
  memberId: string;
  /** The date of the assignment (YYYY-MM-DD). */
  day: string;
  /** When the shift starts. */
  startTime: TimeOfDay;
  /** When the shift ends. */
  endTime: TimeOfDay;
}

/**
 * Parsed solver result with assignments and metadata.
 *
 * @category Solver
 */
export interface SolverResult {
  /** The solver outcome: OPTIMAL, FEASIBLE, INFEASIBLE, TIMEOUT, or ERROR. */
  status: SolverResponse["status"];
  /** The shift assignments extracted from the solution. */
  assignments: ShiftAssignment[];
  /** Solver performance statistics (branches, conflicts, solve time). */
  statistics?: SolverResponse["statistics"];
  /** Error message if the solver returned an error status. */
  error?: string;
}

/**
 * Extracts shift assignments from solver response.
 *
 * Parses variable names matching the pattern `assign:${memberId}:${patternId}:${day}`
 * and returns assignments where the variable value is 1 (true).
 *
 * @remarks
 * IDs are validated by ModelBuilder to not contain colons,
 * ensuring unambiguous parsing.
 *
 * @param response - The solver response containing variable values
 * @returns Parsed schedule result with assignments
 *
 * @category Solver
 *
 * @example
 * ```typescript
 * const response = await client.solve(request);
 * const result = parseSolverResponse(response);
 *
 * if (result.status === "OPTIMAL" || result.status === "FEASIBLE") {
 *   for (const assignment of result.assignments) {
 *     console.log(`${assignment.memberId} works ${assignment.shiftPatternId} on ${assignment.day}`);
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

    // Pattern: assign:${memberId}:${patternId}:${day}
    // IDs are validated to not contain colons, so splitting is unambiguous.
    const parts = varName.split(":");
    if (parts.length !== 4) continue;

    const [, memberId, shiftPatternId, day] = parts;
    if (!memberId || !shiftPatternId || !day) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;

    assignments.push({ memberId, shiftPatternId, day });
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
 * @param assignments - Raw assignments from parseSolverResponse
 * @param shiftPatterns - The shift patterns used in the model
 * @returns Assignments with resolved start/end times
 *
 * @category Solver
 *
 * @example
 * ```typescript
 * const result = parseSolverResponse(response);
 * const resolved = resolveAssignments(result.assignments, shiftPatterns);
 *
 * for (const shift of resolved) {
 *   console.log(`${shift.memberId} works ${shift.day} from ${shift.startTime.hours}:${shift.startTime.minutes}`);
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
        memberId: a.memberId,
        day: a.day,
        startTime: pattern.startTime,
        endTime: pattern.endTime,
      };
    })
    .filter((a): a is ResolvedShiftAssignment => a !== null);
}
