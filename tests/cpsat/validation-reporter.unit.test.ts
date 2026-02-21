import { describe, expect, it } from "vitest";
import {
  ValidationReporterImpl,
  summarizeValidation,
} from "../../src/cpsat/validation-reporter.js";
import type { ValidationGroup } from "../../src/cpsat/validation.types.js";
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
        message: "No eligible members available",
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
        message: "No eligible members available",
        suggestions: ["Add members with role barista"],
      });
      expect(reporter.hasErrors()).toBe(true);
    });

    it("reports rule errors with deterministic id", () => {
      const reporter = new ValidationReporterImpl();

      reporter.reportRuleError({
        rule: "time-off",
        message: "Conflicting time-off requests",
        context: { memberIds: ["alice", "bob"] },
        suggestions: ["Resolve the conflict"],
      });

      const validation = reporter.getValidation();
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]).toEqual({
        id: "error:rule:time-off:_:alice,bob",
        type: "rule",
        rule: "time-off",
        message: "Conflicting time-off requests",
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
        message: "Solver timed out",
      });
      expect(validation.errors[1]).toEqual({
        id: "error:solver:2",
        type: "solver",
        message: "Another error",
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
        message: "barista on 2024-02-01 (09:00-13:00): 1 assigned, need 2",
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
        message: "barista on 2024-02-01 (09:00-13:00): 1 assigned, need 2",
      });
    });

    it("reports rule violations with deterministic id", () => {
      const reporter = new ValidationReporterImpl();

      reporter.reportRuleViolation({
        rule: "time-off",
        message: "Time-off for alice on 2024-02-01 could not be honored",
        context: { memberIds: ["alice"], days: ["2024-02-01"] },
      });

      const validation = reporter.getValidation();
      expect(validation.violations).toHaveLength(1);
      expect(validation.violations[0]).toEqual({
        id: "violation:rule:time-off:2024-02-01:alice",
        type: "rule",
        rule: "time-off",
        message: "Time-off for alice on 2024-02-01 could not be honored",
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
        message: "2 baristas scheduled",
      });

      const validation = reporter.getValidation();
      expect(validation.passed).toHaveLength(1);
      expect(validation.passed[0]).toEqual({
        id: "passed:coverage:2024-02-01:09:00-13:00:barista:_",
        type: "coverage",
        day: "2024-02-01",
        timeSlots: ["09:00-13:00"],
        roleIds: ["barista"],
        message: "2 baristas scheduled",
      });
    });

    it("reports rule passed with deterministic id", () => {
      const reporter = new ValidationReporterImpl();

      reporter.reportRulePassed({
        rule: "time-off",
        message: "Alice's Monday time-off honored",
        context: { memberIds: ["alice"], days: ["2024-02-01"] },
      });

      const validation = reporter.getValidation();
      expect(validation.passed).toHaveLength(1);
      expect(validation.passed[0]).toEqual({
        id: "passed:rule:time-off:2024-02-01:alice",
        type: "rule",
        rule: "time-off",
        message: "Alice's Monday time-off honored",
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
        message: "No eligible members available",
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
        message: "Weekly hours exceeded",
        context: { memberIds: ["bob", "alice"], days: ["2024-02-01", "2024-02-02"] },
      };

      reporter1.reportRuleViolation(violationData);
      reporter2.reportRuleViolation(violationData);

      const id1 = reporter1.getValidation().violations[0]?.id;
      const id2 = reporter2.getValidation().violations[0]?.id;

      expect(id1).toBe(id2);
      expect(id1).toBe("violation:rule:max-hours-week:2024-02-01,2024-02-02:alice,bob");
    });

    it("sorts arrays for deterministic ID generation", () => {
      const reporter1 = new ValidationReporterImpl();
      const reporter2 = new ValidationReporterImpl();

      reporter1.reportRulePassed({
        rule: "time-off",
        message: "All time-off honored",
        context: { memberIds: ["charlie", "alice", "bob"], days: ["2024-02-03", "2024-02-01"] },
      });

      reporter2.reportRulePassed({
        rule: "time-off",
        message: "All time-off honored",
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
        message: "Error 1",
      });

      reporter.reportCoverageError({
        day: "2024-02-01",
        timeSlots: ["14:00-18:00"],
        roleIds: ["barista"],
        message: "Error 2",
      });

      reporter.reportCoverageError({
        day: "2024-02-02",
        timeSlots: ["09:00-13:00"],
        roleIds: ["barista"],
        message: "Error 3",
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

      reporter.reportCoverageError({ ...commonData, message: "Error" });
      reporter.reportCoverageViolation({
        ...commonData,
        targetCount: 2,
        actualCount: 1,
        shortfall: 1,
        message: "Violation",
      });
      reporter.reportCoveragePassed({ ...commonData, message: "Passed" });

      const validation = reporter.getValidation();

      expect(validation.errors[0]?.id).toContain("error:");
      expect(validation.violations[0]?.id).toContain("violation:");
      expect(validation.passed[0]?.id).toContain("passed:");

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
        message: "2x barista on 2024-02-01 at 09:00",
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
        message: "No solution exists",
      });
    });

    it("propagates group from tracked constraints to violations", () => {
      const reporter = new ValidationReporterImpl();
      const grp: ValidationGroup = {
        key: "coverage:morning:barista:2",
        title: "2x barista during morning",
      };

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
        group: grp,
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
      const violation = validation.violations[0]!;
      expect(violation.group).toBe(grp);
    });

    it("propagates group from tracked constraints to passed items", () => {
      const reporter = new ValidationReporterImpl();
      const grp: ValidationGroup = {
        key: "coverage:morning:barista:2",
        title: "2x barista during morning",
      };

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
        group: grp,
      });

      const response: SolverResponse = {
        status: "OPTIMAL",
        values: {},
        softViolations: [],
      };

      reporter.analyzeSolution(response);

      const validation = reporter.getValidation();
      const passed = validation.passed[0]!;
      expect(passed.group).toBe(grp);
    });
  });
});

describe("summarizeValidation", () => {
  const morningGroup: ValidationGroup = {
    key: "coverage:morning:barista:2",
    title: "2x barista during morning",
  };
  const afternoonGroup: ValidationGroup = {
    key: "coverage:afternoon:barista:3",
    title: "3x barista during afternoon",
  };

  it("groups passed items by group key", () => {
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
          message: "2x barista on 2024-02-01 at 09:00",
          group: morningGroup,
        },
        {
          id: "passed:coverage:2024-02-01:09:15:barista:_",
          type: "coverage" as const,
          day: "2024-02-01",
          timeSlots: ["09:15"],
          roleIds: ["barista"],
          message: "2x barista on 2024-02-01 at 09:15",
          group: morningGroup,
        },
        {
          id: "passed:coverage:2024-02-02:09:00:barista:_",
          type: "coverage" as const,
          day: "2024-02-02",
          timeSlots: ["09:00"],
          roleIds: ["barista"],
          message: "2x barista on 2024-02-02 at 09:00",
          group: morningGroup,
        },
      ],
    };

    const summaries = summarizeValidation(validation);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      groupKey: morningGroup.key,
      type: "coverage",
      title: "2x barista during morning",
      status: "passed",
      passedCount: 3,
      violatedCount: 0,
      errorCount: 0,
      days: ["2024-02-01", "2024-02-02"],
    });
  });

  it("creates separate groups for different groups", () => {
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
          message: "2x barista on 2024-02-01 at 09:00",
          group: morningGroup,
        },
        {
          id: "passed:coverage:2024-02-01:14:00:barista:_",
          type: "coverage" as const,
          day: "2024-02-01",
          timeSlots: ["14:00"],
          roleIds: ["barista"],
          message: "3x barista on 2024-02-01 at 14:00",
          group: afternoonGroup,
        },
      ],
    };

    const summaries = summarizeValidation(validation);

    expect(summaries).toHaveLength(2);
    const morning = summaries.find((s) => s.groupKey === morningGroup.key);
    const afternoon = summaries.find((s) => s.groupKey === afternoonGroup.key);

    expect(morning?.passedCount).toBe(1);
    expect(morning?.title).toBe("2x barista during morning");
    expect(afternoon?.passedCount).toBe(1);
    expect(afternoon?.title).toBe("3x barista during afternoon");
  });

  it("sets status to partial when there are violations but also passed", () => {
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
          message: "barista on 2024-02-01 (09:00): 1 assigned, need 2",
          group: morningGroup,
        },
      ],
      passed: [
        {
          id: "passed:coverage:2024-02-01:09:15:barista:_",
          type: "coverage" as const,
          day: "2024-02-01",
          timeSlots: ["09:15"],
          roleIds: ["barista"],
          message: "2x barista on 2024-02-01 at 09:15",
          group: morningGroup,
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
    const validation = {
      errors: [
        {
          id: "error:coverage:2024-02-01:09:00:barista:_",
          type: "coverage" as const,
          day: "2024-02-01",
          timeSlots: ["09:00"],
          roleIds: ["barista"],
          message: "No eligible members",
          group: morningGroup,
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

  it("uses group title for summary title", () => {
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
          message: "2x barista on 2024-02-01 at 09:00",
          group: morningGroup,
        },
      ],
    };

    const summaries = summarizeValidation(validation);

    expect(summaries[0]?.title).toBe("2x barista during morning");
  });

  it("creates separate entries for ungrouped items", () => {
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
          message: "2x barista on 2024-02-01 at 09:00",
        },
        {
          id: "passed:coverage:2024-02-01:09:15:barista:_",
          type: "coverage" as const,
          day: "2024-02-01",
          timeSlots: ["09:15"],
          roleIds: ["barista"],
          message: "2x barista on 2024-02-01 at 09:15",
        },
      ],
    };

    const summaries = summarizeValidation(validation);

    expect(summaries).toHaveLength(2);
    expect(summaries[0]?.groupKey).not.toBe(summaries[1]?.groupKey);
  });

  it("ignores solver errors in grouping", () => {
    const validation = {
      errors: [
        {
          id: "error:solver:1",
          type: "solver" as const,
          message: "Solver timed out",
        },
      ],
      violations: [],
      passed: [],
    };

    const summaries = summarizeValidation(validation);

    expect(summaries).toHaveLength(0);
  });
});
