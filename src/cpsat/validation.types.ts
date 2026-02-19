import type { TimeOfDay } from "../types.js";

// =============================================================================
// Group Key - for aggregating related validation items
// =============================================================================

declare const GroupKeyBrand: unique symbol;

/**
 * Branded type for validation group keys.
 * Groups related validation items that originated from the same instruction.
 */
export type GroupKey = string & { readonly [GroupKeyBrand]: never };

/**
 * Creates a GroupKey from a description string.
 * Use this to create keys that group related validation items together.
 *
 * @example
 * ```typescript
 * const key = groupKey("2x waiter during lunch");
 * coverage.groupKey = key;
 * ```
 */
export function groupKey(description: string): GroupKey {
  return description as GroupKey;
}

/**
 * Context shared across validation results for grouping/display.
 */
export interface ValidationContext {
  days?: string[];
  timeSlots?: string[];
  memberIds?: string[];
}

// =============================================================================
// Errors - block schedule generation
// =============================================================================

export interface CoverageError {
  readonly id: string;
  readonly type: "coverage";
  readonly day: string;
  readonly timeSlots: readonly string[];
  readonly roles?: string[];
  readonly skills?: readonly string[];
  readonly reason: string;
  readonly suggestions?: readonly string[];
  readonly groupKey?: GroupKey;
}

export interface RuleError {
  readonly id: string;
  readonly type: "rule";
  readonly rule: string;
  readonly reason: string;
  readonly context: ValidationContext;
  readonly suggestions?: readonly string[];
  readonly groupKey?: GroupKey;
}

export interface SolverError {
  readonly id: string;
  readonly type: "solver";
  readonly reason: string;
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
  readonly roles?: string[];
  readonly skills?: readonly string[];
  readonly targetCount: number;
  readonly actualCount: number;
  readonly shortfall: number;
  readonly groupKey?: GroupKey;
}

export interface RuleViolation {
  readonly id: string;
  readonly type: "rule";
  readonly rule: string;
  readonly reason: string;
  readonly context: ValidationContext;
  readonly shortfall?: number;
  readonly overflow?: number;
  readonly groupKey?: GroupKey;
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
  readonly roles?: string[];
  readonly skills?: readonly string[];
  readonly description: string;
  readonly groupKey?: GroupKey;
}

export interface RulePassed {
  readonly id: string;
  readonly type: "rule";
  readonly rule: string;
  readonly description: string;
  readonly context: ValidationContext;
  readonly groupKey?: GroupKey;
}

export type SchedulePassed = CoveragePassed | RulePassed;

// =============================================================================
// Complete validation result
// =============================================================================

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
 * Use `summarizeValidation()` to create these from a ScheduleValidation.
 */
export interface ValidationSummary {
  readonly groupKey: GroupKey;
  readonly type: "coverage" | "rule";
  readonly description: string;
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
  readonly description: string;
  readonly targetValue: number;
  readonly comparator: "<=" | ">=";
  readonly day?: string;
  readonly timeSlot?: string;
  readonly roles?: string[];
  readonly skills?: readonly string[];
  readonly context: ValidationContext;
  readonly groupKey?: GroupKey;
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
