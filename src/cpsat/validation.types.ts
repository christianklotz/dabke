import type { TimeOfDay } from "../types.js";

/**
 * Context shared across validation results for grouping/display.
 */
export interface ValidationContext {
  days?: string[];
  timeSlots?: string[];
  memberIds?: string[];
}

// =============================================================================
// Validation Group
// =============================================================================

/**
 * Groups related validation items under a deterministic, structural key.
 *
 * The `key` is derived from the rule/coverage structure (e.g.,
 * `"rule:max-hours-week:40:roles:nurse"`), ensuring that identical
 * configurations always produce the same key. The `title` is the
 * human-readable label shown in summaries.
 *
 * Rule authors create groups via {@link ruleGroup} in `scope.types.ts`;
 * coverage groups are produced by the semantic-time resolver.
 */
export interface ValidationGroup {
  /** Deterministic key derived from rule/coverage structure. */
  readonly key: string;
  /** Human-readable label for summaries (e.g., "Max 40h per week"). */
  readonly title: string;
}

// =============================================================================
// Key safety helpers
// =============================================================================

const KEY_DELIMITERS = /[,:/+]/;

/**
 * Throws if a value contains characters used as key delimiters.
 * Call before interpolating user-provided IDs into group keys.
 */
export function assertSafeKeySegment(value: string, label: string): void {
  if (KEY_DELIMITERS.test(value)) {
    throw new Error(`${label} "${value}" contains reserved delimiter characters (: , / +)`);
  }
}

export function assertSafeKeySegments(values: readonly string[], label: string): void {
  for (const v of values) {
    assertSafeKeySegment(v, label);
  }
}

// =============================================================================
// Errors - block schedule generation
// =============================================================================

export interface CoverageError {
  readonly id: string;
  readonly type: "coverage";
  readonly day: string;
  readonly timeSlots: readonly string[];
  readonly roleIds?: string[];
  readonly skillIds?: readonly string[];
  readonly message: string;
  readonly suggestions?: readonly string[];
  readonly group?: ValidationGroup;
}

export interface RuleError {
  readonly id: string;
  readonly type: "rule";
  readonly rule: string;
  readonly message: string;
  readonly context: ValidationContext;
  readonly suggestions?: readonly string[];
  readonly group?: ValidationGroup;
}

export interface SolverError {
  readonly id: string;
  readonly type: "solver";
  readonly message: string;
}

export type ScheduleError = CoverageError | RuleError | SolverError;

// =============================================================================
// Violations - soft constraints not met, but schedule generated
// =============================================================================

export interface CoverageViolation {
  readonly id: string;
  readonly type: "coverage";
  readonly day: string;
  readonly timeSlots: readonly string[];
  readonly roleIds?: string[];
  readonly skillIds?: readonly string[];
  readonly targetCount: number;
  readonly actualCount: number;
  readonly shortfall: number;
  readonly message: string;
  readonly group?: ValidationGroup;
}

export interface RuleViolation {
  readonly id: string;
  readonly type: "rule";
  readonly rule: string;
  readonly message: string;
  readonly context: ValidationContext;
  readonly shortfall?: number;
  readonly overflow?: number;
  readonly group?: ValidationGroup;
}

export type ScheduleViolation = CoverageViolation | RuleViolation;

// =============================================================================
// Passed - confidence builders showing what was honored
// =============================================================================

export interface CoveragePassed {
  readonly id: string;
  readonly type: "coverage";
  readonly day: string;
  readonly timeSlots: readonly string[];
  readonly roleIds?: string[];
  readonly skillIds?: readonly string[];
  readonly message: string;
  readonly group?: ValidationGroup;
}

export interface RulePassed {
  readonly id: string;
  readonly type: "rule";
  readonly rule: string;
  readonly message: string;
  readonly context: ValidationContext;
  readonly group?: ValidationGroup;
}

export type SchedulePassed = CoveragePassed | RulePassed;

// =============================================================================
// Complete validation result
// =============================================================================

/** @category Validation */
export interface ScheduleValidation {
  readonly errors: readonly ScheduleError[];
  readonly violations: readonly ScheduleViolation[];
  readonly passed: readonly SchedulePassed[];
}

// =============================================================================
// Validation Summary - aggregated view for display
// =============================================================================

/**
 * Summary of validation items grouped by their source instruction.
 * Use `summarizeValidation()` to create these from a `ScheduleValidation`.
 *
 * @category Validation
 */
export interface ValidationSummary {
  /** Deterministic group key derived from rule/coverage structure. */
  readonly groupKey: string;
  readonly type: "coverage" | "rule";
  /** Human-readable title for this group (e.g., "3x nurse during day_ward"). */
  readonly title: string;
  readonly days: readonly string[];
  readonly status: "passed" | "partial" | "failed";
  readonly passedCount: number;
  readonly violatedCount: number;
  readonly errorCount: number;
}

// =============================================================================
// Internal tracking types (used during model building)
// =============================================================================

export interface TrackedConstraint {
  readonly id: string;
  readonly type: "coverage" | "rule";
  readonly rule?: string;
  /** Per-constraint description used to generate violation messages. */
  readonly description: string;
  readonly targetValue: number;
  readonly comparator: "<=" | ">=";
  readonly day?: string;
  readonly timeSlot?: string;
  readonly roleIds?: string[];
  readonly skillIds?: readonly string[];
  readonly context: ValidationContext;
  readonly group?: ValidationGroup;
}

/**
 * Coverage exclusion - indicates a team member is unavailable for coverage during a time period.
 * Used during compile-time to determine coverage feasibility.
 */
export interface CoverageExclusion {
  memberId: string;
  day: string;
  startTime?: TimeOfDay;
  endTime?: TimeOfDay;
}
