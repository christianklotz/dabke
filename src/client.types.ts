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
  SolverRequestSchema,
  SolverResponseSchema,
  SolverStatusSchema,
  SoftConstraintViolationSchema,
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
 * - `minimize` (required): whether to minimize (true) or maximize (false)
 */
export type SolverObjective = z.infer<typeof SolverObjectiveSchema>;

/**
 * The full request payload sent to the CP-SAT solver service.
 *
 * - `variables` (required): all decision variables
 * - `constraints` (required): all constraints
 * - `objective` (optional): optimization objective
 * - `timeoutSeconds` (optional): solver time limit
 */
export type SolverRequest = z.infer<typeof SolverRequestSchema>;

/**
 * The response payload returned by the CP-SAT solver service.
 *
 * - `status` (required): solve outcome (see {@link SolverStatus})
 * - `values` (optional): variable assignments when a solution is found
 * - `statistics` (optional): solve time, conflicts, branches
 * - `softViolations` (optional): which soft constraints were violated
 * - `error` (optional): error message on failure
 * - `solutionInfo` (optional): solver diagnostic info
 */
export type SolverResponse = z.infer<typeof SolverResponseSchema>;

/**
 * Solver outcome status.
 *
 * One of `"OPTIMAL"`, `"FEASIBLE"`, `"INFEASIBLE"`, `"TIMEOUT"`, or `"ERROR"`.
 *
 * @category Solver
 */
export type SolverStatus = z.infer<typeof SolverStatusSchema>;

/**
 * A soft constraint violation reported by the solver.
 *
 * - `constraintId` (required): which soft constraint was violated
 * - `violationAmount` (required): magnitude of the violation
 */
export type SoftConstraintViolation = z.infer<typeof SoftConstraintViolationSchema>;

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
