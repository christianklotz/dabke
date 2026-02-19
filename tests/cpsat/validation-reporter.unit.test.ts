import { describe, expect, it } from "vitest";
import {
  ValidationReporterImpl,
  summarizeValidation,
} from "../../src/cpsat/validation-reporter.js";
import { groupKey } from "../../src/cpsat/validation.types.js";
import type { SolverResponse } from "../../src/client.types.js";

describe("ValidationReporterImpl", () => {
  describe("coverage exclusions", () => {
    it("tracks coverage exclusions", () => {
      const reporter = new ValidationReporterImpl();

      reporter.excludeFromCoverage({
        memberId: "alice",
        day: "2024-02-01",
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      });

      const exclusions = reporter.getExclusions();
      expect(exclusions).toHaveLength(1);
      expect(exclusions[0]).toEqual({
        memberId: "alice",
        day: "2024-02-01",
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      });
    });

    it("allows full-day exclusions without times", () => {
      const reporter = new ValidationReporterImpl();

      reporter.excludeFromCoverage({
        memberId: "alice",
        day: "2024-02-01",
      });

      const exclusions = reporter.getExclusions();
      expect(exclusions).toHaveLength(1);
      expect(exclusions[0]?.startTime).toBeUndefined();
      expect(exclusions[0]?.endTime).toBeUndefined();
    });
  });

  describe("errors", () => {
    it("reports coverage errors with deterministic id", () => {
      const reporter = new ValidationReporterImpl();

      reporter.reportCoverageError({
        day: "2024-02-01",
        timeSlots: ["09:00-13:00"],
        roleIds: ["barista"],
        reason: "No eligible members available",
        suggestions: ["Add members with role barista"],
      });

      const validation = reporter.getValidation();
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]).toEqual({
        id: "error:coverage:2024-02-01:09:00-13:00:barista:_",
        type: "coverage",
        day: "2024-02-01",
        timeSlots: ["09:00-13:00"],
        roleIds: ["barista"],
        reason: "No eligible members available",
        suggestions: ["Add members with role barista"],
      });
      expect(reporter.hasErrors()).toBe(true);
    });

    it("reports rule errors with deterministic id", () => {
      const reporter = new ValidationReporterImpl();

      reporter.reportRuleError({
        rule: "time-off",
        reason: "Conflicting time-off requests",
        context: { memberIds: ["alice", "bob"] },
        suggestions: ["Resolve the conflict"],
      });

      const validation = reporter.getValidation();
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]).toEqual({
        id: "error:rule:time-off:_:alice,bob",
        type: "rule",
        rule: "time-off",
        reason: "Conflicting time-off requests",
        context: { memberIds: ["alice", "bob"] },
        suggestions: ["Resolve the conflict"],
      });
    });

    it("reports solver errors with sequential ids", () => {
      const reporter = new ValidationReporterImpl();

      reporter.reportSolverError("Solver timed out");
      reporter.reportSolverError("Another error");

      const validation = reporter.getValidation();
      expect(validation.errors).toHaveLength(2);
      expect(validation.errors[0]).toEqual({
        id: "error:solver:1",
        type: "solver",
        reason: "Solver timed out",
      });
      expect(validation.errors[1]).toEqual({
        id: "error:solver:2",
        type: "solver",
        reason: "Another error",
      });
    });
  });

  describe("violations", () => {
    it("reports coverage violations with deterministic id", () => {
      const reporter = new ValidationReporterImpl();

      reporter.reportCoverageViolation({
        day: "2024-02-01",
        timeSlots: ["09:00-13:00"],
        roleIds: ["barista"],
        targetCount: 2,
        actualCount: 1,
        shortfall: 1,
      });

      const validation = reporter.getValidation();
      expect(validation.violations).toHaveLength(1);
      expect(validation.violations[0]).toEqual({
        id: "violation:coverage:2024-02-01:09:00-13:00:barista:_",
        type: "coverage",
        day: "2024-02-01",
        timeSlots: ["09:00-13:00"],
        roleIds: ["barista"],
        targetCount: 2,
        actualCount: 1,
        shortfall: 1,
      });
    });

    it("reports rule violations with deterministic id", () => {
      const reporter = new ValidationReporterImpl();

      reporter.reportRuleViolation({
        rule: "time-off",
        reason: "Time-off for alice on 2024-02-01 could not be honored",
        context: { memberIds: ["alice"], days: ["2024-02-01"] },
      });

      const validation = reporter.getValidation();
      expect(validation.violations).toHaveLength(1);
      expect(validation.violations[0]).toEqual({
        id: "violation:rule:time-off:2024-02-01:alice",
        type: "rule",
        rule: "time-off",
        reason: "Time-off for alice on 2024-02-01 could not be honored",
        context: { memberIds: ["alice"], days: ["2024-02-01"] },
      });
    });
  });

  describe("passed", () => {
    it("reports coverage passed with deterministic id", () => {
      const reporter = new ValidationReporterImpl();

      reporter.reportCoveragePassed({
        day: "2024-02-01",
        timeSlots: ["09:00-13:00"],
        roleIds: ["barista"],
        description: "2 baristas scheduled",
      });

      const validation = reporter.getValidation();
      expect(validation.passed).toHaveLength(1);
      expect(validation.passed[0]).toEqual({
        id: "passed:coverage:2024-02-01:09:00-13:00:barista:_",
        type: "coverage",
        day: "2024-02-01",
        timeSlots: ["09:00-13:00"],
        roleIds: ["barista"],
        description: "2 baristas scheduled",
      });
    });

    it("reports rule passed with deterministic id", () => {
      const reporter = new ValidationReporterImpl();

      reporter.reportRulePassed({
        rule: "time-off",
        description: "Alice's Monday time-off honored",
        context: { memberIds: ["alice"], days: ["2024-02-01"] },
      });

      const validation = reporter.getValidation();
      expect(validation.passed).toHaveLength(1);
      expect(validation.passed[0]).toEqual({
        id: "passed:rule:time-off:2024-02-01:alice",
        type: "rule",
        rule: "time-off",
        description: "Alice's Monday time-off honored",
        context: { memberIds: ["alice"], days: ["2024-02-01"] },
      });
    });
  });

  describe("stable IDs", () => {
    it("generates identical IDs for identical coverage errors across runs", () => {
      const reporter1 = new ValidationReporterImpl();
      const reporter2 = new ValidationReporterImpl();

      const errorData = {
        day: "2024-02-01",
        timeSlots: ["09:00-13:00", "14:00-18:00"],
        roleIds: ["barista"],
        skillIds: ["espresso", "latte"],
        reason: "No eligible members available",
      };

      reporter1.reportCoverageError(errorData);
      reporter2.reportCoverageError(errorData);

      const id1 = reporter1.getValidation().errors[0]?.id;
      const id2 = reporter2.getValidation().errors[0]?.id;

      expect(id1).toBe(id2);
      expect(id1).toBe("error:coverage:2024-02-01:09:00-13:00,14:00-18:00:barista:espresso,latte");
    });

    it("generates identical IDs for identical rule violations across runs", () => {
      const reporter1 = new ValidationReporterImpl();
      const reporter2 = new ValidationReporterImpl();

      const violationData = {
        rule: "max-hours-week",
        reason: "Weekly hours exceeded",
        context: { memberIds: ["bob", "alice"], days: ["2024-02-01", "2024-02-02"] },
      };

      reporter1.reportRuleViolation(violationData);
      reporter2.reportRuleViolation(violationData);

      const id1 = reporter1.getValidation().violations[0]?.id;
      const id2 = reporter2.getValidation().violations[0]?.id;

      expect(id1).toBe(id2);
      // Note: arrays are sorted for deterministic IDs
      expect(id1).toBe("violation:rule:max-hours-week:2024-02-01,2024-02-02:alice,bob");
    });

    it("sorts arrays for deterministic ID generation", () => {
      const reporter1 = new ValidationReporterImpl();
      const reporter2 = new ValidationReporterImpl();

      // Same data but arrays in different order
      reporter1.reportRulePassed({
        rule: "time-off",
        description: "All time-off honored",
        context: { memberIds: ["charlie", "alice", "bob"], days: ["2024-02-03", "2024-02-01"] },
      });

      reporter2.reportRulePassed({
        rule: "time-off",
        description: "All time-off honored",
        context: { memberIds: ["alice", "bob", "charlie"], days: ["2024-02-01", "2024-02-03"] },
      });

      const id1 = reporter1.getValidation().passed[0]?.id;
      const id2 = reporter2.getValidation().passed[0]?.id;

      expect(id1).toBe(id2);
      expect(id1).toBe("passed:rule:time-off:2024-02-01,2024-02-03:alice,bob,charlie");
    });

    it("generates unique IDs for different items", () => {
      const reporter = new ValidationReporterImpl();

      reporter.reportCoverageError({
        day: "2024-02-01",
        timeSlots: ["09:00-13:00"],
        roleIds: ["barista"],
        reason: "Error 1",
      });

      reporter.reportCoverageError({
        day: "2024-02-01",
        timeSlots: ["14:00-18:00"],
        roleIds: ["barista"],
        reason: "Error 2",
      });

      reporter.reportCoverageError({
        day: "2024-02-02",
        timeSlots: ["09:00-13:00"],
        roleIds: ["barista"],
        reason: "Error 3",
      });

      const validation = reporter.getValidation();
      const ids = validation.errors.map((e) => e.id);

      expect(new Set(ids).size).toBe(3);
    });

    it("differentiates IDs by category (error vs violation vs passed)", () => {
      const reporter = new ValidationReporterImpl();

      const commonData = {
        day: "2024-02-01",
        timeSlots: ["09:00-13:00"],
        roleIds: ["barista"],
      };

      reporter.reportCoverageError({ ...commonData, reason: "Error" });
      reporter.reportCoverageViolation({
        ...commonData,
        targetCount: 2,
        actualCount: 1,
        shortfall: 1,
      });
      reporter.reportCoveragePassed({ ...commonData, description: "Passed" });

      const validation = reporter.getValidation();

      expect(validation.errors[0]?.id).toContain("error:");
      expect(validation.violations[0]?.id).toContain("violation:");
      expect(validation.passed[0]?.id).toContain("passed:");

      // All three should have different IDs
      const allIds = [
        validation.errors[0]?.id,
        validation.violations[0]?.id,
        validation.passed[0]?.id,
      ];
      expect(new Set(allIds).size).toBe(3);
    });
  });

  describe("analyzeSolution", () => {
    it("extracts coverage violations from solver response with deterministic id", () => {
      const reporter = new ValidationReporterImpl();

      reporter.trackConstraint({
        id: "coverage:barista:2024-02-01:540",
        type: "coverage",
        description: "2x barista on 2024-02-01 at 09:00",
        targetValue: 2,
        comparator: ">=",
        day: "2024-02-01",
        timeSlot: "09:00",
        roleIds: ["barista"],
        context: { days: ["2024-02-01"] },
      });

      const response: SolverResponse = {
        status: "OPTIMAL",
        values: {},
        softViolations: [
          {
            constraintId: "coverage:barista:2024-02-01:540",
            violationAmount: 1,
            targetValue: 2,
            actualValue: 1,
          },
        ],
      };

      reporter.analyzeSolution(response);

      const validation = reporter.getValidation();
      expect(validation.violations).toHaveLength(1);
      expect(validation.violations[0]).toMatchObject({
        id: "violation:coverage:2024-02-01:09:00:barista:_",
        type: "coverage",
        day: "2024-02-01",
        timeSlots: ["09:00"],
        roleIds: ["barista"],
        targetCount: 2,
        actualCount: 1,
        shortfall: 1,
      });
    });

    it("marks non-violated coverage constraints as passed with deterministic id", () => {
      const reporter = new ValidationReporterImpl();

      reporter.trackConstraint({
        id: "coverage:barista:2024-02-01:540",
        type: "coverage",
        description: "2x barista on 2024-02-01 at 09:00",
        targetValue: 2,
        comparator: ">=",
        day: "2024-02-01",
        timeSlot: "09:00",
        roleIds: ["barista"],
        context: { days: ["2024-02-01"] },
      });

      const response: SolverResponse = {
        status: "OPTIMAL",
        values: {},
        softViolations: [],
      };

      reporter.analyzeSolution(response);

      const validation = reporter.getValidation();
      expect(validation.violations).toHaveLength(0);
      expect(validation.passed).toHaveLength(1);
      expect(validation.passed[0]).toMatchObject({
        id: "passed:coverage:2024-02-01:09:00:barista:_",
        type: "coverage",
        day: "2024-02-01",
        timeSlots: ["09:00"],
        roleIds: ["barista"],
        description: "2x barista on 2024-02-01 at 09:00",
      });
    });

    it("reports solver error for infeasible response with id", () => {
      const reporter = new ValidationReporterImpl();

      const response: SolverResponse = {
        status: "INFEASIBLE",
        solutionInfo: "No solution exists",
      };

      reporter.analyzeSolution(response);

      const validation = reporter.getValidation();
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]).toEqual({
        id: "error:solver:1",
        type: "solver",
        reason: "No solution exists",
      });
    });

    it("propagates groupKey from tracked constraints to violations", () => {
      const reporter = new ValidationReporterImpl();
      const key = groupKey("2x barista during morning");

      reporter.trackConstraint({
        id: "coverage:barista:2024-02-01:540",
        type: "coverage",
        description: "2x barista on 2024-02-01 at 09:00",
        targetValue: 2,
        comparator: ">=",
        day: "2024-02-01",
        timeSlot: "09:00",
        roleIds: ["barista"],
        context: { days: ["2024-02-01"] },
        groupKey: key,
      });

      const response: SolverResponse = {
        status: "OPTIMAL",
        values: {},
        softViolations: [
          {
            constraintId: "coverage:barista:2024-02-01:540",
            violationAmount: 1,
            targetValue: 2,
            actualValue: 1,
          },
        ],
      };

      reporter.analyzeSolution(response);

      const validation = reporter.getValidation();
      expect(validation.violations[0]?.groupKey).toBe(key);
    });

    it("propagates groupKey from tracked constraints to passed items", () => {
      const reporter = new ValidationReporterImpl();
      const key = groupKey("2x barista during morning");

      reporter.trackConstraint({
        id: "coverage:barista:2024-02-01:540",
        type: "coverage",
        description: "2x barista on 2024-02-01 at 09:00",
        targetValue: 2,
        comparator: ">=",
        day: "2024-02-01",
        timeSlot: "09:00",
        roleIds: ["barista"],
        context: { days: ["2024-02-01"] },
        groupKey: key,
      });

      const response: SolverResponse = {
        status: "OPTIMAL",
        values: {},
        softViolations: [],
      };

      reporter.analyzeSolution(response);

      const validation = reporter.getValidation();
      expect(validation.passed[0]?.groupKey).toBe(key);
    });
  });
});

describe("summarizeValidation", () => {
  it("groups passed items by groupKey", () => {
    const key = groupKey("2x barista during morning");
    const validation = {
      errors: [],
      violations: [],
      passed: [
        {
          id: "passed:coverage:2024-02-01:09:00:barista:_",
          type: "coverage" as const,
          day: "2024-02-01",
          timeSlots: ["09:00"],
          roleIds: ["barista"],
          description: "2x barista on 2024-02-01 at 09:00",
          groupKey: key,
        },
        {
          id: "passed:coverage:2024-02-01:09:15:barista:_",
          type: "coverage" as const,
          day: "2024-02-01",
          timeSlots: ["09:15"],
          roleIds: ["barista"],
          description: "2x barista on 2024-02-01 at 09:15",
          groupKey: key,
        },
        {
          id: "passed:coverage:2024-02-02:09:00:barista:_",
          type: "coverage" as const,
          day: "2024-02-02",
          timeSlots: ["09:00"],
          roleIds: ["barista"],
          description: "2x barista on 2024-02-02 at 09:00",
          groupKey: key,
        },
      ],
    };

    const summaries = summarizeValidation(validation);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      groupKey: key,
      type: "coverage",
      status: "passed",
      passedCount: 3,
      violatedCount: 0,
      errorCount: 0,
      days: ["2024-02-01", "2024-02-02"],
    });
  });

  it("creates separate groups for different groupKeys", () => {
    const morningKey = groupKey("2x barista during morning");
    const afternoonKey = groupKey("3x barista during afternoon");
    const validation = {
      errors: [],
      violations: [],
      passed: [
        {
          id: "passed:coverage:2024-02-01:09:00:barista:_",
          type: "coverage" as const,
          day: "2024-02-01",
          timeSlots: ["09:00"],
          roleIds: ["barista"],
          description: "2x barista on 2024-02-01 at 09:00",
          groupKey: morningKey,
        },
        {
          id: "passed:coverage:2024-02-01:14:00:barista:_",
          type: "coverage" as const,
          day: "2024-02-01",
          timeSlots: ["14:00"],
          roleIds: ["barista"],
          description: "3x barista on 2024-02-01 at 14:00",
          groupKey: afternoonKey,
        },
      ],
    };

    const summaries = summarizeValidation(validation);

    expect(summaries).toHaveLength(2);
    const morning = summaries.find((s) => s.groupKey === morningKey);
    const afternoon = summaries.find((s) => s.groupKey === afternoonKey);

    expect(morning?.passedCount).toBe(1);
    expect(afternoon?.passedCount).toBe(1);
  });

  it("sets status to partial when there are violations but also passed", () => {
    const key = groupKey("2x barista during morning");
    const validation = {
      errors: [],
      violations: [
        {
          id: "violation:coverage:2024-02-01:09:00:barista:_",
          type: "coverage" as const,
          day: "2024-02-01",
          timeSlots: ["09:00"],
          roleIds: ["barista"],
          targetCount: 2,
          actualCount: 1,
          shortfall: 1,
          groupKey: key,
        },
      ],
      passed: [
        {
          id: "passed:coverage:2024-02-01:09:15:barista:_",
          type: "coverage" as const,
          day: "2024-02-01",
          timeSlots: ["09:15"],
          roleIds: ["barista"],
          description: "2x barista on 2024-02-01 at 09:15",
          groupKey: key,
        },
      ],
    };

    const summaries = summarizeValidation(validation);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.status).toBe("partial");
    expect(summaries[0]?.passedCount).toBe(1);
    expect(summaries[0]?.violatedCount).toBe(1);
  });

  it("sets status to failed when there are errors", () => {
    const key = groupKey("2x barista during morning");
    const validation = {
      errors: [
        {
          id: "error:coverage:2024-02-01:09:00:barista:_",
          type: "coverage" as const,
          day: "2024-02-01",
          timeSlots: ["09:00"],
          roleIds: ["barista"],
          reason: "No eligible members",
          groupKey: key,
        },
      ],
      violations: [],
      passed: [],
    };

    const summaries = summarizeValidation(validation);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.status).toBe("failed");
    expect(summaries[0]?.errorCount).toBe(1);
  });

  it("uses groupKey as description when it looks human-readable", () => {
    const key = groupKey("2x barista during morning");
    const validation = {
      errors: [],
      violations: [],
      passed: [
        {
          id: "passed:coverage:2024-02-01:09:00:barista:_",
          type: "coverage" as const,
          day: "2024-02-01",
          timeSlots: ["09:00"],
          roleIds: ["barista"],
          description: "2x barista on 2024-02-01 at 09:00",
          groupKey: key,
        },
      ],
    };

    const summaries = summarizeValidation(validation);

    expect(summaries[0]?.description).toBe("2x barista during morning");
  });

  it("creates ungrouped entries for items without groupKey", () => {
    const validation = {
      errors: [],
      violations: [],
      passed: [
        {
          id: "passed:coverage:2024-02-01:09:00:barista:_",
          type: "coverage" as const,
          day: "2024-02-01",
          timeSlots: ["09:00"],
          roleIds: ["barista"],
          description: "2x barista on 2024-02-01 at 09:00",
          // No groupKey
        },
        {
          id: "passed:coverage:2024-02-01:09:15:barista:_",
          type: "coverage" as const,
          day: "2024-02-01",
          timeSlots: ["09:15"],
          roleIds: ["barista"],
          description: "2x barista on 2024-02-01 at 09:15",
          // No groupKey
        },
      ],
    };

    const summaries = summarizeValidation(validation);

    // Each item without groupKey gets its own group
    expect(summaries).toHaveLength(2);
    expect(summaries[0]?.groupKey).toContain("ungrouped:");
    expect(summaries[1]?.groupKey).toContain("ungrouped:");
  });

  it("ignores solver errors in grouping", () => {
    const validation = {
      errors: [
        {
          id: "error:solver:1",
          type: "solver" as const,
          reason: "Solver timed out",
        },
      ],
      violations: [],
      passed: [],
    };

    const summaries = summarizeValidation(validation);

    // Solver errors don't create groups
    expect(summaries).toHaveLength(0);
  });
});
