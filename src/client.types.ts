/**
 * CP-SAT solver transport types and status constants.
 *
 * Types are derived from Zod schemas to ensure validation and types stay in sync.
 *
 * @see client.schemas.ts for the source Zod schemas
 */

import type { z } from "zod";
import type {
  SolverTermSchema,
  SolverVariableSchema,
  SolverConstraintSchema,
  SolverObjectiveSchema,
  SolverObjectiveStageSchema,
  SolverRequestSchema,
  SolverResponseSchema,
  SolverStageResultSchema,
  SolverDiagnosticModeSchema,
  SolverStatusSchema,
  SolverModeSchema,
  SolverSoftConstraintViolationSchema,
  SolverHardConstraintConflictSchema,
} from "./client.schemas.js";

// --------------------------------------------------------------------------
// Types derived from Zod schemas
// --------------------------------------------------------------------------

/**
 * A single linear term in a constraint or objective.
 *
 * - `var` (required): variable name
 * - `coeff` (required): integer coefficient
 */
export type SolverTerm = z.infer<typeof SolverTermSchema>;

/**
 * A decision variable in the CP-SAT model.
 *
 * - `name` (required): unique variable identifier
 * - `lb` (required): lower bound
 * - `ub` (required): upper bound
 * - `isBoolean` (optional): whether this is a boolean variable
 * - `isInterval` (optional): whether this is an interval variable
 * - `start`, `end`, `size`, `presenceVar` (optional): interval variable fields
 */
export type SolverVariable = z.infer<typeof SolverVariableSchema>;

/**
 * A constraint in the CP-SAT model.
 *
 * - `name` (required): constraint identifier
 * - `type` (required): constraint kind (e.g. "linear", "bool_and", "no_overlap")
 * - Additional fields vary by constraint type
 */
export type SolverConstraint = z.infer<typeof SolverConstraintSchema>;

/**
 * An optimization objective for the solver.
 *
 * - `terms` (required): linear terms to minimize/maximize
 * - `sense` (required): whether to minimize or maximize
 */
export type SolverObjective = z.infer<typeof SolverObjectiveSchema>;

/**
 * A named objective optimized as one step in a lexicographic solve.
 *
 * - `id` (required): unique stage identifier
 * - `sense` (required): whether to minimize or maximize
 * - `terms` (required): linear terms to optimize
 */
export type SolverObjectiveStage = z.infer<typeof SolverObjectiveStageSchema>;

/**
 * Solver mode.
 *
 * `"optimize"` is the semantic default when omitted. `"satisfy"` asks the
 * solver to find any hard-feasible solution without optimizing objectives or
 * soft constraint penalties.
 */
export type SolverMode = z.infer<typeof SolverModeSchema>;

/**
 * Solver diagnostic mode.
 *
 * - `"none"`: solve normally without extra hard-conflict tracking
 * - `"hard"`: track hard constraints with CP-SAT assumptions so infeasible responses include conflicts
 */
export type SolverDiagnosticMode = z.infer<typeof SolverDiagnosticModeSchema>;

/**
 * The full request payload sent to the CP-SAT solver service.
 *
 * - `variables` (required): all decision variables
 * - `constraints` (required): all constraints
 * - `objective` (optional): optimization objective
 * - `objectiveStages` (optional): named objectives solved in lexicographic order
 * - `mode` (optional): solving mode, defaulting semantically to `"optimize"`
 * - `options` (optional): solver time limit, solution controls, and diagnostics mode
 */
export type SolverRequest = z.infer<typeof SolverRequestSchema>;

/**
 * The raw response payload returned by the CP-SAT solver service.
 *
 * @remarks
 * This transport type is solver-stage only. It is later translated into the
 * public `ScheduleValidation` feedback model with `errors`, `violations`, and
 * `passed` items.
 *
 * - `status` (required): solve outcome (see {@link SolverStatus})
 * - `values` (optional): variable assignments when a solution is found
 * - `statistics` (optional): solve time, conflicts, branches
 * - `softConstraintViolations` (required on `OPTIMAL`/`FEASIBLE` responses): raw solver-stage records for violated soft constraints
 * - `hardConstraintConflicts` (optional on `INFEASIBLE` responses): tracked hard constraints in a sufficient infeasible set
 * - `error` (optional): error message on failure
 * - `solutionInfo` (optional): solver diagnostic info
 * - `stageResults` (optional): per-stage metadata for staged optimization
 */
export type SolverResponse = z.infer<typeof SolverResponseSchema>;

/**
 * Metadata for one solved objective stage.
 *
 * - `id` (required): objective stage identifier
 * - `status` (required): solve outcome for the stage
 * - `objectiveValue` (optional): achieved objective value when available
 * - `bestObjectiveBound` (optional): solver bound when available
 * - `solveTimeMs` (required): wall-clock solve time for this stage
 */
export type SolverStageResult = z.infer<typeof SolverStageResultSchema>;

/**
 * Solver outcome status.
 *
 * One of `"OPTIMAL"`, `"FEASIBLE"`, `"INFEASIBLE"`, `"TIMEOUT"`, or `"ERROR"`.
 *
 * @category Solver
 */
export type SolverStatus = z.infer<typeof SolverStatusSchema>;

/**
 * A raw solver-stage record for a violated soft constraint.
 *
 * Successful solver responses always include a
 * `softConstraintViolations` array, even when it is empty.
 *
 * - `constraintId` (required): which soft constraint was violated
 * - `violationAmount` (required): magnitude of the violation
 */
export type SolverSoftConstraintViolation = z.infer<typeof SolverSoftConstraintViolationSchema>;

/**
 * A tracked hard constraint included in a sufficient infeasible constraint set.
 *
 * @remarks
 * Hard constraints are not reported as violations because no solution exists to
 * measure actual values against. The solver reports a sufficient conflict set
 * from CP-SAT assumptions instead.
 *
 * - `constraintId` (required): which tracked hard constraint is part of the conflict set
 */
export type SolverHardConstraintConflict = z.infer<typeof SolverHardConstraintConflictSchema>;

// --------------------------------------------------------------------------
// Status constants (for convenience)
// --------------------------------------------------------------------------

/** Convenience constants for {@link SolverStatus} values. */
export const SOLVER_STATUS = {
  OPTIMAL: "OPTIMAL",
  FEASIBLE: "FEASIBLE",
  INFEASIBLE: "INFEASIBLE",
  TIMEOUT: "TIMEOUT",
  ERROR: "ERROR",
} as const;

// --------------------------------------------------------------------------
// Client interface
// --------------------------------------------------------------------------

/** A `fetch` function or an object with a `fetch` method. */
export type FetcherLike =
  | typeof fetch
  | {
      fetch: typeof fetch;
    };

/**
 * Interface for sending solver requests and receiving responses.
 *
 * @category Solver
 */
export interface SolverClient {
  solve(request: SolverRequest, options?: { signal?: AbortSignal }): Promise<SolverResponse>;
  health?(): Promise<void>;
}
