import type { SolverResponse } from "../client.types.js";
import type { DateString } from "../types.js";
import {
  type ScheduleError,
  type ScheduleViolation,
  type SchedulePassed,
  type ScheduleValidation,
  type TrackedConstraint,
  type CoverageError,
  type CoverageViolation,
  type CoveragePassed,
  type RuleError,
  type RuleViolation,
  type RulePassed,
  type CoverageExclusion,
  type ValidationSummary,
} from "./validation.types.js";

export interface ValidationReporter {
  // Coverage exclusions (compile-time, for feasibility analysis)
  excludeFromCoverage(exclusion: CoverageExclusion): void;

  // Errors (block generation)
  reportCoverageError(error: Omit<CoverageError, "type" | "id">): void;
  reportRuleError(error: Omit<RuleError, "type" | "id">): void;
  reportSolverError(message: string): void;

  // Violations (non-fatal feedback)
  reportCoverageViolation(violation: Omit<CoverageViolation, "type" | "id">): void;
  reportRuleViolation(violation: Omit<RuleViolation, "type" | "id">): void;

  // Passed (confidence builders)
  reportCoveragePassed(passed: Omit<CoveragePassed, "type" | "id">): void;
  reportRulePassed(passed: Omit<RulePassed, "type" | "id">): void;

  // Constraint tracking for post-solve analysis
  trackConstraint(constraint: TrackedConstraint): void;

  // Query methods
  hasErrors(): boolean;
  getValidation(): ScheduleValidation;
  getExclusions(): CoverageExclusion[];

  // Post-solve analysis
  analyzeSolution(response: SolverResponse, options?: AnalyzeSolutionOptions): void;
}

export interface AnalyzeSolutionOptions {
  /** Whether solver-reported soft constraint diagnostics should update validation. */
  analyzeSoftConstraints?: boolean;
}

const MISSING_SOFT_CONSTRAINT_VIOLATIONS_ERROR =
  "Solver response missing softConstraintViolations for tracked soft constraints.";

/**
 * Generates a deterministic ID for a coverage-based validation item.
 * Format: {category}:coverage:{day}:{timeSlots}:{roles}:{skills}
 */
function coverageId(
  category: "error" | "violation" | "passed",
  day: string,
  timeSlots: readonly string[],
  roleIds?: readonly string[],
  skillIds?: readonly string[],
): string {
  const parts = [
    category,
    "coverage",
    day,
    [...timeSlots].toSorted().join(",") || "_",
    roleIds && roleIds.length > 0 ? [...roleIds].toSorted().join(",") : "_",
    skillIds ? [...skillIds].toSorted().join(",") : "_",
  ];
  return parts.join(":");
}

/**
 * Generates a deterministic ID for a rule-based validation item.
 * Format: {category}:rule:{rule}:{days}:{memberIds}
 */
function ruleId(
  category: "error" | "violation" | "passed",
  rule: string,
  context: { days?: readonly string[]; memberIds?: readonly string[] },
): string {
  const parts = [
    category,
    "rule",
    rule,
    context.days ? [...context.days].toSorted().join(",") : "_",
    context.memberIds ? [...context.memberIds].toSorted().join(",") : "_",
  ];
  return parts.join(":");
}

export class ValidationReporterImpl implements ValidationReporter {
  #errors: ScheduleError[] = [];
  #violations: ScheduleViolation[] = [];
  #passed: SchedulePassed[] = [];
  #trackedConstraints = new Map<string, TrackedConstraint>();
  #exclusions: CoverageExclusion[] = [];
  #validationIdCounts = new Map<string, number>();
  #solverErrorCount = 0;

  #nextValidationId(baseId: string): string {
    const count = (this.#validationIdCounts.get(baseId) ?? 0) + 1;
    this.#validationIdCounts.set(baseId, count);
    return count === 1 ? baseId : `${baseId}:${count}`;
  }

  excludeFromCoverage(exclusion: CoverageExclusion): void {
    this.#exclusions.push(exclusion);
  }

  reportCoverageError(error: Omit<CoverageError, "type" | "id">): void {
    const id = this.#nextValidationId(
      coverageId("error", error.day, error.timeSlots, error.roleIds, error.skillIds),
    );
    this.#errors.push({ id, type: "coverage", ...error });
  }

  reportRuleError(error: Omit<RuleError, "type" | "id">): void {
    const id = this.#nextValidationId(ruleId("error", error.rule, error.context));
    this.#errors.push({ id, type: "rule", ...error });
  }

  reportSolverError(message: string): void {
    this.#solverErrorCount++;
    const id = `error:solver:${this.#solverErrorCount}`;
    this.#errors.push({ id, type: "solver", message });
  }

  reportCoverageViolation(violation: Omit<CoverageViolation, "type" | "id">): void {
    const id = this.#nextValidationId(
      coverageId(
        "violation",
        violation.day,
        violation.timeSlots,
        violation.roleIds,
        violation.skillIds,
      ),
    );
    this.#violations.push({ id, type: "coverage", ...violation });
  }

  reportRuleViolation(violation: Omit<RuleViolation, "type" | "id">): void {
    const id = this.#nextValidationId(ruleId("violation", violation.rule, violation.context));
    this.#violations.push({ id, type: "rule", ...violation });
  }

  reportCoveragePassed(passed: Omit<CoveragePassed, "type" | "id">): void {
    const id = this.#nextValidationId(
      coverageId("passed", passed.day, passed.timeSlots, passed.roleIds, passed.skillIds),
    );
    this.#passed.push({ id, type: "coverage", ...passed });
  }

  reportRulePassed(passed: Omit<RulePassed, "type" | "id">): void {
    const id = this.#nextValidationId(ruleId("passed", passed.rule, passed.context));
    this.#passed.push({ id, type: "rule", ...passed });
  }

  getExclusions(): CoverageExclusion[] {
    return [...this.#exclusions];
  }

  trackConstraint(constraint: TrackedConstraint): void {
    this.#trackedConstraints.set(constraint.id, constraint);
  }

  hasErrors(): boolean {
    return this.#errors.length > 0;
  }

  getValidation(): ScheduleValidation {
    return {
      errors: [...this.#errors],
      violations: [...this.#violations],
      passed: [...this.#passed],
    };
  }

  getTrackedConstraints(): TrackedConstraint[] {
    return [...this.#trackedConstraints.values()];
  }

  analyzeSolution(response: SolverResponse, options?: AnalyzeSolutionOptions): void {
    if (response.status !== "OPTIMAL" && response.status !== "FEASIBLE") {
      if (response.status === "INFEASIBLE") {
        this.#reportHardConstraintConflicts(
          (response.hardConstraintConflicts ?? []).map((conflict) => conflict.constraintId),
        );
        this.reportSolverError(response.solutionInfo ?? "Schedule is infeasible");
        if (response.error) {
          this.reportSolverError(response.error);
        }
      } else if (response.status === "TIMEOUT") {
        this.reportSolverError("Solver timed out");
      } else if (response.error) {
        this.reportSolverError(response.error);
      }
      return;
    }

    const analyzeSoftConstraints = options?.analyzeSoftConstraints ?? true;

    const hasTrackedSoftConstraints = [...this.#trackedConstraints.values()].some(
      (constraint) => constraint.source === "soft",
    );

    if (
      analyzeSoftConstraints &&
      hasTrackedSoftConstraints &&
      response.softConstraintViolations === undefined
    ) {
      throw new Error(MISSING_SOFT_CONSTRAINT_VIOLATIONS_ERROR);
    }

    const solverViolations = analyzeSoftConstraints
      ? (response.softConstraintViolations ?? [])
      : [];

    for (const violation of solverViolations) {
      const tracked = this.#trackedConstraints.get(violation.constraintId);

      if (tracked?.type === "coverage") {
        if (!tracked.day) continue;
        const roles = tracked.roleIds?.join(", ") ?? "staff";
        const slot = tracked.timeSlot ?? "all day";
        this.reportCoverageViolation({
          day: tracked.day,
          timeSlots: tracked.timeSlot ? [tracked.timeSlot] : [],
          roleIds: tracked.roleIds,
          skillIds: tracked.skillIds,
          targetCount: violation.targetValue,
          actualCount: violation.actualValue,
          shortfall: violation.violationAmount,
          message: `${roles} on ${tracked.day} (${slot}): ${violation.actualValue} assigned, need ${violation.targetValue}`,
          group: tracked.group,
        });
      } else if (tracked?.type === "rule") {
        const isShortfall = tracked.comparator === ">=";
        this.reportRuleViolation({
          rule: tracked.rule ?? "unknown",
          message: `${tracked.description}: needed ${violation.targetValue}, got ${violation.actualValue}`,
          context: tracked.context,
          shortfall: isShortfall ? violation.violationAmount : undefined,
          overflow: !isShortfall ? violation.violationAmount : undefined,
          group: tracked.group,
        });
      } else {
        this.reportRuleViolation({
          rule: "unknown",
          message: `Constraint ${violation.constraintId} violated by ${violation.violationAmount}`,
          context: {},
        });
      }
    }

    // Mark tracked coverage constraints as passed if not violated
    const violatedIds = new Set(solverViolations.map((v) => v.constraintId));
    for (const tracked of this.#trackedConstraints.values()) {
      if (!analyzeSoftConstraints && tracked.source === "soft") continue;
      if (violatedIds.has(tracked.id)) continue;

      if (tracked.type === "coverage") {
        if (!tracked.day) continue;
        this.reportCoveragePassed({
          day: tracked.day,
          timeSlots: tracked.timeSlot ? [tracked.timeSlot] : [],
          roleIds: tracked.roleIds,
          skillIds: tracked.skillIds,
          message: tracked.description,
          group: tracked.group,
        });
      }
    }
  }

  #reportHardConstraintConflicts(constraintIds: readonly string[]): void {
    if (constraintIds.length === 0) {
      return;
    }

    type CoverageGroup = {
      day: DateString;
      timeSlots: Set<string>;
      roleIds?: string[];
      skillIds?: readonly string[];
      group?: TrackedConstraint["group"];
      descriptions: string[];
    };
    type RuleGroup = {
      rule: string;
      days: Set<DateString>;
      memberIds: Set<string>;
      group?: TrackedConstraint["group"];
      descriptions: string[];
    };

    const coverageGroups = new Map<string, CoverageGroup>();
    const ruleGroups = new Map<string, RuleGroup>();

    for (const constraintId of constraintIds) {
      const tracked = this.#trackedConstraints.get(constraintId);
      if (!tracked) continue;

      if (tracked.type === "coverage") {
        if (!tracked.day) continue;
        const key = [
          tracked.group?.key ?? tracked.id,
          tracked.day,
          tracked.roleIds?.join(",") ?? "_",
          tracked.skillIds?.join(",") ?? "_",
        ].join(":");
        const existing = coverageGroups.get(key);
        if (existing) {
          if (tracked.timeSlot) existing.timeSlots.add(tracked.timeSlot);
          existing.descriptions.push(tracked.description);
          continue;
        }
        coverageGroups.set(key, {
          day: tracked.day,
          timeSlots: new Set(tracked.timeSlot ? [tracked.timeSlot] : []),
          roleIds: tracked.roleIds,
          skillIds: tracked.skillIds,
          group: tracked.group,
          descriptions: [tracked.description],
        });
        continue;
      }

      const key = tracked.group?.key ?? tracked.id;
      const existing = ruleGroups.get(key);
      if (existing) {
        for (const day of tracked.context.days ?? []) existing.days.add(day);
        for (const memberId of tracked.context.memberIds ?? []) existing.memberIds.add(memberId);
        existing.descriptions.push(tracked.description);
        continue;
      }
      ruleGroups.set(key, {
        rule: tracked.rule ?? "unknown",
        days: new Set(tracked.context.days ?? []),
        memberIds: new Set(tracked.context.memberIds ?? []),
        group: tracked.group,
        descriptions: [tracked.description],
      });
    }

    for (const coverage of coverageGroups.values()) {
      const label = coverage.group?.title ?? coverage.descriptions[0] ?? "Coverage requirement";
      this.reportCoverageError({
        day: coverage.day,
        timeSlots: [...coverage.timeSlots].toSorted(),
        roleIds: coverage.roleIds,
        skillIds: coverage.skillIds,
        message: `${label} is part of a sufficient infeasible constraint set.`,
        suggestions: [
          "Relax this mandatory coverage requirement",
          "Relax conflicting mandatory rules or add eligible team members",
        ],
        group: coverage.group,
      });
    }

    for (const rule of ruleGroups.values()) {
      const label = rule.group?.title ?? rule.descriptions[0] ?? rule.rule;
      this.reportRuleError({
        rule: rule.rule,
        message: `${label} is part of a sufficient infeasible constraint set.`,
        context: {
          days: [...rule.days].toSorted(),
          memberIds: [...rule.memberIds].toSorted(),
        },
        suggestions: [
          "Relax this mandatory rule",
          "Relax conflicting mandatory coverage requirements or add eligible team members",
        ],
        group: rule.group,
      });
    }
  }
}

// =============================================================================
// Validation Summary
// =============================================================================

type ValidationItem = ScheduleError | ScheduleViolation | SchedulePassed;

/**
 * Aggregates validation items by their group into summaries.
 *
 * Items sharing the same `group.key` are merged into a single summary.
 * The title comes from the first item's `group.title`; for ungrouped items
 * the item's `message` is used instead.
 *
 * @category Validation
 *
 * @example
 * ```typescript
 * const summaries = summarizeValidation(validation);
 * // summaries[0] = {
 * //   groupKey: "coverage:day_ward:nurse:3:dow:monday,tuesday,...",
 * //   title: "3x nurse during day_ward (weekdays)",
 * //   status: "passed",
 * //   passedCount: 180,
 * //   days: ["2026-02-02", "2026-02-03", ...]
 * // }
 * ```
 */
export function summarizeValidation(validation: ScheduleValidation): readonly ValidationSummary[] {
  const groups = new Map<
    string,
    {
      type: "coverage" | "rule";
      title: string;
      days: Set<DateString>;
      passedCount: number;
      violatedCount: number;
      errorCount: number;
    }
  >();

  const getOrCreateStats = (item: Exclude<ValidationItem, { type: "solver" }>) => {
    const key = ("group" in item && item.group?.key) || `ungrouped:${item.id}`;
    const title = ("group" in item && item.group?.title) || item.message;

    if (!groups.has(key)) {
      groups.set(key, {
        type: item.type,
        title,
        days: new Set<DateString>(),
        passedCount: 0,
        violatedCount: 0,
        errorCount: 0,
      });
    }
    return groups.get(key)!;
  };

  for (const item of validation.passed) {
    const stats = getOrCreateStats(item);
    stats.passedCount++;
    if (item.type === "coverage" && item.day) {
      stats.days.add(item.day);
    }
  }

  for (const item of validation.violations) {
    const stats = getOrCreateStats(item);
    stats.violatedCount++;
    if (item.type === "coverage" && item.day) {
      stats.days.add(item.day);
    }
  }

  for (const item of validation.errors) {
    if (item.type === "solver") continue;
    const stats = getOrCreateStats(item);
    stats.errorCount++;
    if (item.type === "coverage" && item.day) {
      stats.days.add(item.day);
    }
  }

  const summaries: ValidationSummary[] = [];
  for (const [key, group] of groups) {
    const status: ValidationSummary["status"] =
      group.errorCount > 0 ? "failed" : group.violatedCount > 0 ? "partial" : "passed";

    summaries.push({
      groupKey: key,
      type: group.type,
      title: group.title,
      days: [...group.days].toSorted(),
      status,
      passedCount: group.passedCount,
      violatedCount: group.violatedCount,
      errorCount: group.errorCount,
    });
  }

  return summaries;
}
