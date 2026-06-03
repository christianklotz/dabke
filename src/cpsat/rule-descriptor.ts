/**
 * Rule descriptor contracts for CP-SAT compilation.
 *
 * @remarks
 * Rules compile into declarative artifacts instead of mutating the solver
 * builder directly. This keeps validation handling and backend lowering
 * centralized. The user-facing feedback unit is the rule or validation group,
 * not an individual solver constraint.
 *
 * @packageDocumentation
 */

import type { z } from "zod";
import type { DateString, DayOfWeek, SchedulingDay, TimeOfDay } from "../types.js";
import type { ModelBuilder } from "./model-builder.js";
import type { ResolvedShiftAssignment, ShiftAssignment } from "./response.js";
import type { SchedulingMember, ShiftPattern, Term } from "./types.js";
import type { ValidationContext, ValidationGroup } from "./validation.types.js";
import type { ValidationReporter } from "./validation-reporter.js";

export type RuleMode =
  | "hard-constraint"
  | "soft-constraint"
  | "objective"
  | "coverage-exclusion"
  | "pre-solve-feedback"
  | "post-solve-feedback"
  | "cost"
  | "variable";

/**
 * Inputs available while compiling a rule descriptor.
 *
 * @remarks
 * Descriptor compilation happens before the model builder applies artifacts, so
 * rules receive normalized scheduling inputs and return declarative artifacts
 * instead of mutating the builder directly.
 *
 * @category Rules
 */
export interface RuleCompileContext {
  readonly members: readonly SchedulingMember[];
  readonly shiftPatterns: readonly ShiftPattern[];
  readonly days: readonly SchedulingDay[];
  readonly weekStartsOn: DayOfWeek;
  readonly coverageBucketMinutes?: number;
}

export type RulePreSolveFeedbackContext = RuleCompileContext;
export type RulePostSolveFeedbackContext = RuleCompileContext;
export type CostCalculationContext = RuleCompileContext;

export type PreSolveFeedbackFn = (
  ctx: RulePreSolveFeedbackContext,
  reporter: ValidationReporter,
) => void;

export type PostSolveFeedbackFn = (
  assignments: readonly ResolvedShiftAssignment[],
  reporter: ValidationReporter,
  ctx: RulePostSolveFeedbackContext,
) => void;

/**
 * Structured opt-out categories for artifact-level validation reporting.
 *
 * @category Rules
 */
export type ValidationSkipCategory = "scaffolding" | "no-meaningful-feedback";

/**
 * Validation strategy that reports a hard constraint into the validation pipeline.
 *
 * @category Rules
 */
export interface ReportHardConstraintValidationStrategy {
  readonly strategy: "report";
  readonly id: string;
}

/**
 * Validation strategy that reports a soft constraint into the validation pipeline.
 *
 * @remarks
 * Soft constraints report using their artifact `constraintId`.
 *
 * @category Rules
 */
export interface ReportSoftConstraintValidationStrategy {
  readonly strategy: "report";
}

/**
 * Validation strategy that explicitly skips validation reporting for an artifact.
 *
 * @category Rules
 */
export interface SkipValidationStrategy {
  readonly strategy: "skip";
  readonly category: ValidationSkipCategory;
  readonly rationale: string;
}

/**
 * Validation strategy attached to hard constraints.
 *
 * @category Rules
 */
export type HardConstraintValidationStrategy =
  | ReportHardConstraintValidationStrategy
  | SkipValidationStrategy;

/**
 * Validation strategy attached to soft constraints.
 *
 * @category Rules
 */
export type SoftConstraintValidationStrategy =
  | ReportSoftConstraintValidationStrategy
  | SkipValidationStrategy;

/**
 * Validation strategy attached to objective artifacts.
 *
 * @category Rules
 */
export type ObjectiveValidationStrategy = SkipValidationStrategy;

/**
 * Validation strategy attached to cost artifacts.
 *
 * @category Rules
 */
export type CostValidationStrategy = SkipValidationStrategy;

/**
 * A compiled hard constraint emitted by a rule descriptor.
 *
 * @remarks
 * Hard constraints are still implementation details. End-user feedback should
 * normally be summarized at the rule or validation-group level. Artifact rule
 * identity is inherited from the containing `CompiledRule`. Solver-stage
 * reporting uses artifact-level validation strategies. Pre-solve feedback
 * should be emitted via dedicated feedback artifacts.
 *
 * @category Rules
 */
export interface HardConstraintArtifact {
  readonly kind: "hard-constraint";
  readonly group?: ValidationGroup;
  readonly validation: HardConstraintValidationStrategy;
  readonly description: string;
  readonly context: ValidationContext;
  readonly terms: readonly Term[];
  readonly comparator: "<=" | ">=" | "==";
  readonly targetValue: number;
}

export interface SoftConstraintArtifact {
  readonly kind: "soft-constraint";
  readonly group?: ValidationGroup;
  readonly validation: SoftConstraintValidationStrategy;
  readonly description: string;
  readonly context: ValidationContext;
  readonly terms: readonly Term[];
  readonly comparator: "<=" | ">=";
  readonly targetValue: number;
  readonly penalty: number;
  readonly constraintId: string;
  /** Optional objective stage ID used for staged solver requests. */
  readonly stage?: string;
}

export interface ObjectiveArtifact {
  readonly kind: "objective";
  readonly group?: ValidationGroup;
  readonly terms: readonly Term[];
  readonly validation: ObjectiveValidationStrategy;
  /** Optional objective stage ID used for staged solver requests. */
  readonly stage?: string;
}

export interface CoverageExclusionArtifact {
  readonly kind: "coverage-exclusion";
  readonly group?: ValidationGroup;
  readonly memberId: string;
  readonly day: DateString;
  readonly startTime?: TimeOfDay;
  readonly endTime?: TimeOfDay;
}

export interface PreSolveFeedbackArtifact {
  readonly kind: "pre-solve-feedback";
  readonly run: PreSolveFeedbackFn;
}

export interface PostSolveFeedbackArtifact {
  readonly kind: "post-solve-feedback";
  readonly run: PostSolveFeedbackFn;
}

export interface CostEntry {
  readonly memberId: string;
  readonly day: string;
  readonly category: string;
  readonly amount: number;
}

export interface CostContribution {
  readonly entries: readonly CostEntry[];
}

export interface CostArtifact {
  readonly kind: "cost";
  readonly compileObjective?: (builder: ModelBuilder) => void;
  readonly calculateCost?: (
    assignments: readonly ShiftAssignment[],
    ctx: CostCalculationContext,
  ) => CostContribution;
  readonly validation: CostValidationStrategy;
}

export type VariableArtifact =
  | {
      readonly kind: "variable";
      readonly variable: { type: "bool"; name: string };
    }
  | {
      readonly kind: "variable";
      readonly variable: { type: "int"; name: string; min: number; max: number };
    };

export type RuleArtifact =
  | VariableArtifact
  | HardConstraintArtifact
  | SoftConstraintArtifact
  | ObjectiveArtifact
  | CoverageExclusionArtifact
  | PreSolveFeedbackArtifact
  | PostSolveFeedbackArtifact
  | CostArtifact;

export interface CompiledRule {
  readonly rule: string;
  readonly artifacts: readonly RuleArtifact[];
}

/**
 * A low-level CP-SAT rule descriptor.
 *
 * @remarks
 * Advanced consumers can register custom descriptors via
 * {@link createCpsatRuleRegistry}. Each descriptor owns runtime validation via
 * its Zod schema and compiles a parsed config into declarative rule artifacts.
 *
 * @category Rules
 */
export interface RuleDescriptor<Name extends string = string, Config = unknown> {
  readonly name: Name;
  readonly schema: z.ZodType<Config>;
  compile(config: Config, ctx: RuleCompileContext): CompiledRule;
}

/**
 * Defines a typed low-level CP-SAT rule descriptor.
 *
 * @remarks
 * Use this for custom rules that should participate in the same descriptor and
 * artifact pipeline as the built-in rules.
 *
 * @example
 * ```ts
 * const debugRuleDescriptor = defineRuleDescriptor({
 *   name: "debug",
 *   schema: z.object({ flag: z.boolean() }),
 *   compile(config) {
 *     return {
 *       rule: "debug",
 *       artifacts: config.flag ? [] : [],
 *     };
 *   },
 * });
 * ```
 *
 * @category Rules
 */
export function defineRuleDescriptor<Name extends string, Schema extends z.ZodTypeAny>(descriptor: {
  readonly name: Name;
  readonly schema: Schema;
  compile(config: z.infer<Schema>, ctx: RuleCompileContext): CompiledRule;
}): RuleDescriptor<Name, z.infer<Schema>> {
  return descriptor as RuleDescriptor<Name, z.infer<Schema>>;
}

/**
 * Parses raw config through a descriptor schema, then compiles it into artifacts.
 *
 * @remarks
 * Schema parsing fails loudly. This helper does not recover from invalid JSON or
 * invalid rule config.
 *
 * @category Rules
 */
export function compileRuleDescriptor<Name extends string, Config>(
  descriptor: RuleDescriptor<Name, Config>,
  rawConfig: unknown,
  ctx: RuleCompileContext,
): CompiledRule {
  const config = descriptor.schema.parse(rawConfig);
  return descriptor.compile(config, ctx);
}
