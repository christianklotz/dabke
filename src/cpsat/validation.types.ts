import type { TimeOfDay } from "../types.js";

// =============================================================================
// Validation Group - for aggregating related validation items
// =============================================================================

let nextGroupId = 1;

/**
 * Groups related validation items that originated from the same instruction.
 *
 * Each `cover()` or rule call creates one group. All constraints generated
 * from that call share the same group, so `summarizeValidation()` can
 * collapse hundreds of individual items into a single summary line.
 *
 * @example
 * ```typescript
 * const group = validationGroup("3x nurse during day_ward (Mon-Fri)");
 * ```
 */
export interface ValidationGroup {
  /** Unique opaque identifier for this group. */
  readonly key: string;
  /** Human-readable description of the instruction that created this group. */
  readonly description: string;
}

/**
 * Creates a new validation group with a unique key.
 *
 * @param description - Human-readable summary of the source instruction
 */
export function validationGroup(description: string): ValidationGroup {
  return { key: `grp_${nextGroupId++}`, description };
}

/**
 * Resets the group counter. Only for use in tests.
 * @internal
 */
export function resetValidationGroupCounter(): void {
  nextGroupId = 1;
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
  readonly group?: ValidationGroup;
}

export interface RuleError {
  readonly id: string;
  readonly type: "rule";
  readonly rule: string;
  readonly reason: string;
  readonly context: ValidationContext;
  readonly suggestions?: readonly string[];
  readonly group?: ValidationGroup;
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
  readonly group?: ValidationGroup;
}

export interface RuleViolation {
  readonly id: string;
  readonly type: "rule";
  readonly rule: string;
  readonly reason: string;
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
  readonly roles?: string[];
  readonly skills?: readonly string[];
  readonly description: string;
  readonly group?: ValidationGroup;
}

export interface RulePassed {
  readonly id: string;
  readonly type: "rule";
  readonly rule: string;
  readonly description: string;
  readonly context: ValidationContext;
  readonly group?: ValidationGroup;
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
  /** Unique group identifier. Stable within a single solve run. */
  readonly groupKey: string;
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
