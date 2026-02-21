import type { SolverResponse } from "../client.types.js";
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

  // Violations (soft constraint issues)
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
  analyzeSolution(response: SolverResponse): void;
}

/**
 * Generates a deterministic ID for a coverage-based validation item.
 * Format: {category}:coverage:{day}:{timeSlots}:{roles}:{skills}
 */
function coverageId(
  category: "error" | "violation" | "passed",
  day: string,
  timeSlots: readonly string[],
  roles?: readonly string[],
  skills?: readonly string[],
): string {
  const parts = [
    category,
    "coverage",
    day,
    [...timeSlots].toSorted().join(",") || "_",
    roles && roles.length > 0 ? [...roles].toSorted().join(",") : "_",
    skills ? [...skills].toSorted().join(",") : "_",
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
  #solverErrorCount = 0;

  excludeFromCoverage(exclusion: CoverageExclusion): void {
    this.#exclusions.push(exclusion);
  }

  reportCoverageError(error: Omit<CoverageError, "type" | "id">): void {
    const id = coverageId("error", error.day, error.timeSlots, error.roles, error.skills);
    this.#errors.push({ id, type: "coverage", ...error });
  }

  reportRuleError(error: Omit<RuleError, "type" | "id">): void {
    const id = ruleId("error", error.rule, error.context);
    this.#errors.push({ id, type: "rule", ...error });
  }

  reportSolverError(message: string): void {
    this.#solverErrorCount++;
    const id = `error:solver:${this.#solverErrorCount}`;
    this.#errors.push({ id, type: "solver", message });
  }

  reportCoverageViolation(violation: Omit<CoverageViolation, "type" | "id">): void {
    const id = coverageId(
      "violation",
      violation.day,
      violation.timeSlots,
      violation.roles,
      violation.skills,
    );
    this.#violations.push({ id, type: "coverage", ...violation });
  }

  reportRuleViolation(violation: Omit<RuleViolation, "type" | "id">): void {
    const id = ruleId("violation", violation.rule, violation.context);
    this.#violations.push({ id, type: "rule", ...violation });
  }

  reportCoveragePassed(passed: Omit<CoveragePassed, "type" | "id">): void {
    const id = coverageId("passed", passed.day, passed.timeSlots, passed.roles, passed.skills);
    this.#passed.push({ id, type: "coverage", ...passed });
  }

  reportRulePassed(passed: Omit<RulePassed, "type" | "id">): void {
    const id = ruleId("passed", passed.rule, passed.context);
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

  analyzeSolution(response: SolverResponse): void {
    if (response.status !== "OPTIMAL" && response.status !== "FEASIBLE") {
      if (response.status === "INFEASIBLE") {
        this.reportSolverError(response.solutionInfo ?? "Schedule is infeasible");
      } else if (response.status === "TIMEOUT") {
        this.reportSolverError("Solver timed out");
      } else if (response.error) {
        this.reportSolverError(response.error);
      }
      return;
    }

    const solverViolations = response.softViolations ?? [];

    for (const violation of solverViolations) {
      const tracked = this.#trackedConstraints.get(violation.constraintId);

      if (tracked?.type === "coverage") {
        const roles = tracked.roles?.join(", ") ?? "staff";
        const slot = tracked.timeSlot ?? "all day";
        this.reportCoverageViolation({
          day: tracked.day ?? "",
          timeSlots: tracked.timeSlot ? [tracked.timeSlot] : [],
          roles: tracked.roles,
          skills: tracked.skills,
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
      if (violatedIds.has(tracked.id)) continue;

      if (tracked.type === "coverage") {
        this.reportCoveragePassed({
          day: tracked.day ?? "",
          timeSlots: tracked.timeSlot ? [tracked.timeSlot] : [],
          roles: tracked.roles,
          skills: tracked.skills,
          message: tracked.description,
          group: tracked.group,
        });
      }
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
      days: Set<string>;
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
        days: new Set(),
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
