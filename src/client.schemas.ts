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
  id: z.string().optional(),
});

export const SoftLinearConstraintSchema = z.object({
  type: z.literal("soft_linear"),
  terms: z.array(SolverTermSchema),
  op: z.union([z.literal("<="), z.literal(">=")]),
  rhs: z.number(),
  penalty: z.number(),
  id: z.string().optional(),
  stage: z.string().optional(),
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

export const SolverObjectiveStageSchema = SolverObjectiveSchema.extend({
  id: z.string(),
});

export const SolverModeSchema = z.enum(["optimize", "satisfy"]);
export const SolverDiagnosticModeSchema = z.enum(["none", "hard"]);

// --------------------------------------------------------------------------
// Options schema
// --------------------------------------------------------------------------

export const SolverOptionsSchema = z.object({
  timeLimitSeconds: z.number().optional(),
  solutionLimit: z.number().optional(),
  diagnostics: SolverDiagnosticModeSchema.optional(),
});

// --------------------------------------------------------------------------
// Request/Response schemas
// --------------------------------------------------------------------------

export const SolverStatusSchema = z.enum(["OPTIMAL", "FEASIBLE", "INFEASIBLE", "TIMEOUT", "ERROR"]);

export const SolverStageResultSchema = z.object({
  id: z.string(),
  status: SolverStatusSchema,
  objectiveValue: z.number().optional(),
  bestObjectiveBound: z.number().optional(),
  solveTimeMs: z.number(),
});

export const SolverRequestSchema = z
  .object({
    variables: z.array(SolverVariableSchema),
    constraints: z.array(SolverConstraintSchema),
    objective: SolverObjectiveSchema.optional(),
    objectiveStages: z.array(SolverObjectiveStageSchema).optional(),
    mode: SolverModeSchema.optional(),
    options: SolverOptionsSchema.optional(),
  })
  .superRefine((request, ctx) => {
    if (request.objective && request.objectiveStages) {
      ctx.addIssue({
        code: "custom",
        path: ["objectiveStages"],
        message: "objective and objectiveStages cannot both be present",
      });
    }

    if (request.objectiveStages !== undefined) {
      if (request.objectiveStages.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["objectiveStages"],
          message: "objectiveStages cannot be empty",
        });
      }

      const seenStageIds = new Set<string>();
      for (const [index, stage] of request.objectiveStages.entries()) {
        if (seenStageIds.has(stage.id)) {
          ctx.addIssue({
            code: "custom",
            path: ["objectiveStages", index, "id"],
            message: `Duplicate objective stage id ${stage.id}`,
          });
        }
        seenStageIds.add(stage.id);
      }

      if (request.options?.solutionLimit === 1) {
        ctx.addIssue({
          code: "custom",
          path: ["options", "solutionLimit"],
          message: "objectiveStages cannot be used with solutionLimit=1",
        });
      }

      for (const [index, constraint] of request.constraints.entries()) {
        if (constraint.type !== "soft_linear") continue;

        if (constraint.stage === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["constraints", index, "stage"],
            message: "Soft linear constraint requires stage when objectiveStages are used",
          });
          continue;
        }

        if (!seenStageIds.has(constraint.stage)) {
          ctx.addIssue({
            code: "custom",
            path: ["constraints", index, "stage"],
            message: `Soft linear constraint stage ${constraint.stage} is not declared`,
          });
        }
      }
    }

    if (request.mode === "satisfy") {
      if (request.objective) {
        ctx.addIssue({
          code: "custom",
          path: ["objective"],
          message: 'mode "satisfy" cannot be used with objective',
        });
      }
      if (request.objectiveStages) {
        ctx.addIssue({
          code: "custom",
          path: ["objectiveStages"],
          message: 'mode "satisfy" cannot be used with objectiveStages',
        });
      }
    }
  });

export const SolverStatisticsSchema = z.object({
  solveTimeMs: z.number().optional(),
  conflicts: z.number().optional(),
  branches: z.number().optional(),
});

export const SolverSoftConstraintViolationSchema = z.object({
  constraintId: z.string(),
  violationAmount: z.number(),
  targetValue: z.number(),
  actualValue: z.number(),
});

export const SolverHardConstraintConflictSchema = z.object({
  constraintId: z.string(),
});

const SolverResponseBaseSchema = z.object({
  values: z.record(z.string(), z.number()).optional(),
  statistics: SolverStatisticsSchema.optional(),
  error: z.string().optional(),
  solutionInfo: z.string().optional(),
  hardConstraintConflicts: z.array(SolverHardConstraintConflictSchema).optional(),
  stageResults: z.array(SolverStageResultSchema).optional(),
});

const SuccessfulSolverResponseSchema = SolverResponseBaseSchema.extend({
  status: z.union([z.literal("OPTIMAL"), z.literal("FEASIBLE")]),
  softConstraintViolations: z.array(SolverSoftConstraintViolationSchema),
});

const NonSuccessfulSolverResponseSchema = SolverResponseBaseSchema.extend({
  status: z.union([z.literal("INFEASIBLE"), z.literal("TIMEOUT"), z.literal("ERROR")]),
  softConstraintViolations: z.array(SolverSoftConstraintViolationSchema).optional(),
});

export const SolverResponseSchema = z.union([
  SuccessfulSolverResponseSchema,
  NonSuccessfulSolverResponseSchema,
]);
