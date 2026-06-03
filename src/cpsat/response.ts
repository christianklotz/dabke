import type { SolverResponse } from "../client.types.js";
import type { ShiftPattern } from "./types.js";
import { isDateString, type DateString, type TimeOfDay } from "../types.js";

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
  /** The concrete role this member is filling for the assignment. */
  roleId?: string;
  /** The date of the assignment (YYYY-MM-DD). */
  day: DateString;
}

/**
 * A shift assignment with resolved times.
 *
 * @category Solver
 */
export interface ResolvedShiftAssignment {
  /** The assigned member's ID. */
  memberId: string;
  /** The concrete role this member is filling for the assignment. */
  roleId?: string;
  /** The date of the assignment (YYYY-MM-DD). */
  day: DateString;
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
 * Parses role-specific variable names matching the pattern
 * `assign_role:${memberId}:${patternId}:${roleId}:${day}` and aggregate
 * assignment variable names matching `assign:${memberId}:${patternId}:${day}`.
 *
 * @remarks
 * The model uses aggregate assignment variables as the canonical shift presence
 * literals for intervals, objectives, shift-level rules, and skill-only coverage.
 * Role-specific variables are emitted when the solver also chooses a concrete
 * role for that shift. When both variable shapes exist for the same member,
 * pattern, and day, the role-specific assignment is returned so callers can see
 * the selected role without receiving a duplicate aggregate assignment.
 *
 * IDs are validated by ModelBuilder to not contain colons, ensuring unambiguous
 * parsing.
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

  const roleAssignments = new Map<string, ShiftAssignment>();
  const aggregateAssignments = new Map<string, ShiftAssignment>();

  for (const [varName, value] of Object.entries(response.values ?? {})) {
    if (value !== 1) continue;

    if (varName.startsWith("assign_role:")) {
      const parts = varName.split(":");
      if (parts.length !== 5) continue;

      const [, memberId, shiftPatternId, roleId, day] = parts;
      if (!memberId || !shiftPatternId || !roleId || !day) continue;
      if (!isDateString(day)) continue;

      roleAssignments.set(assignmentKey(memberId, shiftPatternId, day), {
        memberId,
        shiftPatternId,
        roleId,
        day,
      });
      continue;
    }

    if (!varName.startsWith("assign:")) continue;

    const parts = varName.split(":");
    if (parts.length !== 4) continue;
    const [, memberId, shiftPatternId, day] = parts;
    if (!memberId || !shiftPatternId || !day) continue;
    if (!isDateString(day)) continue;

    aggregateAssignments.set(assignmentKey(memberId, shiftPatternId, day), {
      memberId,
      shiftPatternId,
      day,
    });
  }

  const assignments = [...roleAssignments.values()];
  for (const [key, assignment] of aggregateAssignments) {
    if (!roleAssignments.has(key)) {
      assignments.push(assignment);
    }
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
        ...(a.roleId ? { roleId: a.roleId } : {}),
        day: a.day,
        startTime: pattern.startTime,
        endTime: pattern.endTime,
      };
    })
    .filter((a): a is ResolvedShiftAssignment => a !== null);
}

function assignmentKey(memberId: string, shiftPatternId: string, day: DateString): string {
  return `${memberId}:${shiftPatternId}:${day}`;
}
