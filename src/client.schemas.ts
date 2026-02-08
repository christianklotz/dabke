/**
 * Zod schemas for CP-SAT solver transport types.
 *
 * These schemas define the contract between scheduling clients and the solver service.
 * TypeScript types are derived from these schemas using z.infer to ensure they stay in sync.
 *
 * @see client.types.ts for the derived TypeScript types
 */

import { z } from "zod";

// --------------------------------------------------------------------------
// Variable schemas
// --------------------------------------------------------------------------

export const SolverTermSchema = z.object({
  var: z.string(),
  coeff: z.number(),
});

export const BoolVariableSchema = z.object({
  type: z.literal("bool"),
  name: z.string(),
});

export const IntVariableSchema = z.object({
  type: z.literal("int"),
  name: z.string(),
  min: z.number(),
  max: z.number(),
});

export const IntervalVariableSchema = z.object({
  type: z.literal("interval"),
  name: z.string(),
  start: z.number(),
  end: z.number(),
  size: z.number(),
  /** If present, this is an optional interval enforced by this boolean var. */
  presenceVar: z.string().optional(),
});

export const SolverVariableSchema = z.union([
  BoolVariableSchema,
  IntVariableSchema,
  IntervalVariableSchema,
]);

// --------------------------------------------------------------------------
// Constraint schemas
// --------------------------------------------------------------------------

export const LinearConstraintSchema = z.object({
  type: z.literal("linear"),
  terms: z.array(SolverTermSchema),
  op: z.union([z.literal("<="), z.literal(">="), z.literal("==")]),
  rhs: z.number(),
});

export const SoftLinearConstraintSchema = z.object({
  type: z.literal("soft_linear"),
  terms: z.array(SolverTermSchema),
  op: z.union([z.literal("<="), z.literal(">=")]),
  rhs: z.number(),
  penalty: z.number(),
  id: z.string().optional(),
});

export const ExactlyOneConstraintSchema = z.object({
  type: z.literal("exactly_one"),
  vars: z.array(z.string()),
});

export const AtMostOneConstraintSchema = z.object({
  type: z.literal("at_most_one"),
  vars: z.array(z.string()),
});

export const ImplicationConstraintSchema = z.object({
  type: z.literal("implication"),
  if: z.string(),
  // oxlint-disable-next-line unicorn/no-thenable -- This is a schema property, not a Promise
  then: z.string(),
});

export const BoolOrConstraintSchema = z.object({
  type: z.literal("bool_or"),
  vars: z.array(z.string()),
});

export const BoolAndConstraintSchema = z.object({
  type: z.literal("bool_and"),
  vars: z.array(z.string()),
});

export const NoOverlapConstraintSchema = z.object({
  type: z.literal("no_overlap"),
  intervals: z.array(z.string()),
});

export const SolverConstraintSchema = z.union([
  LinearConstraintSchema,
  SoftLinearConstraintSchema,
  ExactlyOneConstraintSchema,
  AtMostOneConstraintSchema,
  ImplicationConstraintSchema,
  BoolOrConstraintSchema,
  BoolAndConstraintSchema,
  NoOverlapConstraintSchema,
]);

// --------------------------------------------------------------------------
// Objective schema
// --------------------------------------------------------------------------

export const SolverObjectiveSchema = z.object({
  sense: z.union([z.literal("minimize"), z.literal("maximize")]),
  terms: z.array(SolverTermSchema),
});

// --------------------------------------------------------------------------
// Options schema
// --------------------------------------------------------------------------

export const SolverOptionsSchema = z.object({
  timeLimitSeconds: z.number().optional(),
  solutionLimit: z.number().optional(),
});

// --------------------------------------------------------------------------
// Request/Response schemas
// --------------------------------------------------------------------------

export const SolverRequestSchema = z.object({
  variables: z.array(SolverVariableSchema),
  constraints: z.array(SolverConstraintSchema),
  objective: SolverObjectiveSchema.optional(),
  options: SolverOptionsSchema.optional(),
});

export const SolverStatusSchema = z.enum(["OPTIMAL", "FEASIBLE", "INFEASIBLE", "TIMEOUT", "ERROR"]);

export const SolverStatisticsSchema = z.object({
  solveTimeMs: z.number().optional(),
  conflicts: z.number().optional(),
  branches: z.number().optional(),
});

export const SoftConstraintViolationSchema = z.object({
  constraintId: z.string(),
  violationAmount: z.number(),
  targetValue: z.number(),
  actualValue: z.number(),
});

export const SolverResponseSchema = z.object({
  status: SolverStatusSchema,
  values: z.record(z.string(), z.number()).optional(),
  statistics: SolverStatisticsSchema.optional(),
  error: z.string().optional(),
  solutionInfo: z.string().optional(),
  softViolations: z.array(SoftConstraintViolationSchema).optional(),
});
