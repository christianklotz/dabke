import type {
  HardConstraintArtifact,
  ReportHardConstraintValidationStrategy,
  ReportSoftConstraintValidationStrategy,
  SkipValidationStrategy,
  SoftConstraintArtifact,
  ValidationSkipCategory,
  VariableArtifact,
} from "../rule-descriptor.js";

export function boolVariable(name: string): VariableArtifact {
  return {
    kind: "variable",
    variable: { type: "bool", name },
  };
}

export function intVariable(name: string, min: number, max: number): VariableArtifact {
  return {
    kind: "variable",
    variable: { type: "int", name, min, max },
  };
}

export function reportValidation(id: string): ReportHardConstraintValidationStrategy;
export function reportValidation(): ReportSoftConstraintValidationStrategy;
export function reportValidation(
  id?: string,
): ReportHardConstraintValidationStrategy | ReportSoftConstraintValidationStrategy {
  return id ? { strategy: "report", id } : { strategy: "report" };
}

export function skipValidation(
  category: ValidationSkipCategory,
  rationale: string,
): SkipValidationStrategy {
  return { strategy: "skip", category, rationale };
}

export function hardConstraint(
  params: Omit<HardConstraintArtifact, "kind">,
): HardConstraintArtifact {
  return {
    ...params,
    kind: "hard-constraint",
  } satisfies HardConstraintArtifact;
}

export function softConstraint(
  params: Omit<SoftConstraintArtifact, "kind">,
): SoftConstraintArtifact {
  return {
    ...params,
    kind: "soft-constraint",
  } satisfies SoftConstraintArtifact;
}
