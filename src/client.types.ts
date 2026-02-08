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

export type SolverTerm = z.infer<typeof SolverTermSchema>;

export type SolverVariable = z.infer<typeof SolverVariableSchema>;

export type SolverConstraint = z.infer<typeof SolverConstraintSchema>;

export type SolverObjective = z.infer<typeof SolverObjectiveSchema>;

export type SolverRequest = z.infer<typeof SolverRequestSchema>;

export type SolverResponse = z.infer<typeof SolverResponseSchema>;

export type SolverStatus = z.infer<typeof SolverStatusSchema>;

export type SoftConstraintViolation = z.infer<typeof SoftConstraintViolationSchema>;

// --------------------------------------------------------------------------
// Status constants (for convenience)
// --------------------------------------------------------------------------

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

export type FetcherLike =
  | typeof fetch
  | {
      fetch: typeof fetch;
    };

export interface SolverClient {
  solve(request: SolverRequest, options?: { signal?: AbortSignal }): Promise<SolverResponse>;
  health?(): Promise<void>;
}
