import { describe, it, expect, beforeAll } from "vitest";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import { parseSolverResponse, resolveAssignments } from "../../src/cpsat/response.js";
import { getSolverClient } from "./helpers.js";

describe("Validation diagnostics (integration)", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  describe("Compile-time errors", () => {
    it("reports coverage error when no eligible team members exist", () => {
      const builder = new ModelBuilder({
        employees: [{ id: "alice", roleIds: ["server"] }],
        shiftPatterns: [
          {
            id: "day",
            roleIds: ["barista"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 13, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [
          {
            day: "2024-02-01",
            roleIds: ["barista"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 13, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const diagnostics = builder.compile();

      expect(diagnostics.canSolve).toBe(false);
      expect(diagnostics.validation.errors.length).toBeGreaterThan(0);
      expect(diagnostics.validation.errors[0]?.type).toBe("coverage");
      expect(diagnostics.validation.errors[0]?.reason).toContain("no eligible team members");
    });

    it("reports coverage error when mandatory time-off blocks all employees", () => {
      const builder = new ModelBuilder({
        employees: [{ id: "alice", roleIds: ["barista"] }],
        shiftPatterns: [
          {
            id: "day",
            roleIds: ["barista"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 13, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [
          {
            day: "2024-02-01",
            roleIds: ["barista"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 13, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
        ruleConfigs: [
          {
            name: "time-off",

            employeeIds: ["alice"],
            specificDates: ["2024-02-01"],
            priority: "MANDATORY",
          },
        ],
      });

      const diagnostics = builder.compile();

      expect(diagnostics.canSolve).toBe(false);
      const error = diagnostics.validation.errors.find(
        (e) => e.type === "coverage" && e.reason.includes("mandatory time off"),
      );
      expect(error).toBeDefined();
    });
  });

  describe("Solve-time violations", () => {
    it("returns coverage violations when soft coverage target cannot be fully met", async () => {
      const builder = new ModelBuilder({
        employees: [{ id: "alice", roleIds: ["barista"] }],
        shiftPatterns: [
          {
            id: "day",
            roleIds: ["barista"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 13, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [
          {
            day: "2024-02-01",
            roleIds: ["barista"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 13, minutes: 0 },
            targetCount: 2,
            priority: "HIGH",
          },
        ],
      });

      const diagnostics = builder.compile();
      expect(diagnostics.canSolve).toBe(true);

      const response = await client.solve(diagnostics.request);
      expect(response.status).toBe("OPTIMAL");

      builder.reporter.analyzeSolution(response);
      const validation = builder.reporter.getValidation();

      expect(validation.violations.length).toBeGreaterThan(0);
      const coverageViolation = validation.violations.find((v) => v.type === "coverage");
      expect(coverageViolation).toBeDefined();
      if (coverageViolation?.type === "coverage") {
        expect(coverageViolation.shortfall).toBeGreaterThan(0);
      }
    }, 30_000);

    it("marks coverage as passed when mandatory coverage is fully satisfied", async () => {
      const builder = new ModelBuilder({
        employees: [
          { id: "alice", roleIds: ["barista"] },
          { id: "bob", roleIds: ["barista"] },
        ],
        shiftPatterns: [
          {
            id: "day",
            roleIds: ["barista"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 13, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [
          {
            day: "2024-02-01",
            roleIds: ["barista"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 13, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const diagnostics = builder.compile();
      expect(diagnostics.canSolve).toBe(true);

      const response = await client.solve(diagnostics.request);
      expect(response.status).toBe("OPTIMAL");

      builder.reporter.analyzeSolution(response);
      const validation = builder.reporter.getValidation();

      // No violations - the mandatory constraint was satisfied
      expect(validation.violations).toHaveLength(0);

      // Mandatory constraints are now tracked and reported as passed
      expect(validation.passed.length).toBeGreaterThan(0);
      const coveragePassed = validation.passed.find((p) => p.type === "coverage");
      expect(coveragePassed).toBeDefined();
      expect(coveragePassed?.roleIds).toEqual(["barista"]);
    }, 30_000);
  });

  describe("Post-solve time-off validation", () => {
    it("detects when non-mandatory time-off preference is violated", async () => {
      const builder = new ModelBuilder({
        employees: [{ id: "alice", roleIds: ["barista"] }],
        shiftPatterns: [
          {
            id: "day",
            roleIds: ["barista"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 13, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [
          {
            day: "2024-02-01",
            roleIds: ["barista"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 13, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
        ruleConfigs: [
          {
            name: "time-off",

            employeeIds: ["alice"],
            specificDates: ["2024-02-01"],
            priority: "LOW",
          },
        ],
      });

      const diagnostics = builder.compile();
      expect(diagnostics.canSolve).toBe(true);

      const response = await client.solve(diagnostics.request);
      expect(response.status).toBe("OPTIMAL");

      const result = parseSolverResponse(response);
      const resolved = resolveAssignments(result.assignments, builder.shiftPatterns);

      expect(resolved.length).toBe(1);
      expect(resolved[0]?.employeeId).toBe("alice");

      // Run post-solve validation
      builder.reporter.analyzeSolution(response);
      builder.validateSolution(resolved);

      const validation = builder.reporter.getValidation();

      const timeOffViolation = validation.violations.find(
        (v) => v.type === "rule" && v.rule === "time-off",
      );
      expect(timeOffViolation).toBeDefined();
      expect(timeOffViolation?.type).toBe("rule");
      if (timeOffViolation?.type === "rule") {
        expect(timeOffViolation.reason.toLowerCase()).toContain("alice");
      }
    }, 30_000);

    it("reports time-off as passed when employee is not scheduled during requested time", async () => {
      const builder = new ModelBuilder({
        employees: [
          { id: "alice", roleIds: ["barista"] },
          { id: "bob", roleIds: ["barista"] },
        ],
        shiftPatterns: [
          {
            id: "day",
            roleIds: ["barista"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 13, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [
          {
            day: "2024-02-01",
            roleIds: ["barista"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 13, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
        ruleConfigs: [
          {
            name: "time-off",

            employeeIds: ["alice"],
            specificDates: ["2024-02-01"],
            priority: "HIGH",
          },
        ],
      });

      const diagnostics = builder.compile();
      expect(diagnostics.canSolve).toBe(true);

      const response = await client.solve(diagnostics.request);
      expect(response.status).toBe("OPTIMAL");

      const result = parseSolverResponse(response);
      const resolved = resolveAssignments(result.assignments, builder.shiftPatterns);

      expect(resolved.length).toBe(1);
      expect(resolved[0]?.employeeId).toBe("bob");

      // Run post-solve validation
      builder.reporter.analyzeSolution(response);
      builder.validateSolution(resolved);

      const validation = builder.reporter.getValidation();

      // No time-off violations
      const timeOffViolation = validation.violations.find(
        (v) => v.type === "rule" && v.rule === "time-off",
      );
      expect(timeOffViolation).toBeUndefined();

      // Time-off should be marked as passed
      const timeOffPassed = validation.passed.find(
        (p) => p.type === "rule" && p.rule === "time-off",
      );
      expect(timeOffPassed).toBeDefined();
      expect(timeOffPassed?.description.toLowerCase()).toContain("alice");
    }, 30_000);

    it("validates time-off with role scoping", async () => {
      const builder = new ModelBuilder({
        employees: [
          { id: "alice", roleIds: ["barista"] },
          { id: "bob", roleIds: ["server"] },
        ],
        shiftPatterns: [
          {
            id: "day",
            roleIds: ["barista"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 13, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [
          {
            day: "2024-02-01",
            roleIds: ["barista"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 13, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
        ruleConfigs: [
          {
            name: "time-off",

            roleIds: ["barista"], // Scoped to baristas only
            specificDates: ["2024-02-01"],
            priority: "LOW",
          },
        ],
      });

      const diagnostics = builder.compile();
      expect(diagnostics.canSolve).toBe(true);

      const response = await client.solve(diagnostics.request);
      expect(response.status).toBe("OPTIMAL");

      const result = parseSolverResponse(response);
      const resolved = resolveAssignments(result.assignments, builder.shiftPatterns);

      // Alice is scheduled (only barista)
      expect(resolved.length).toBe(1);
      expect(resolved[0]?.employeeId).toBe("alice");

      builder.reporter.analyzeSolution(response);
      builder.validateSolution(resolved);

      const validation = builder.reporter.getValidation();

      // Time-off for alice (barista) should be violated
      const timeOffViolation = validation.violations.find(
        (v) => v.type === "rule" && v.rule === "time-off",
      );
      expect(timeOffViolation).toBeDefined();
      expect(timeOffViolation?.type).toBe("rule");
      if (timeOffViolation?.type === "rule") {
        expect(timeOffViolation.reason).toContain("alice");
      }
    }, 30_000);

    it("validates partial-day time-off correctly", async () => {
      // Alice and Bob can both work, Alice has soft afternoon time-off
      // Coverage only requires morning shift, so Alice should work morning
      // and her afternoon time-off should pass
      const builder = new ModelBuilder({
        employees: [
          { id: "alice", roleIds: ["barista"] },
          { id: "bob", roleIds: ["barista"] },
        ],
        shiftPatterns: [
          {
            id: "morning",
            roleIds: ["barista"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 13, minutes: 0 },
          },
          {
            id: "afternoon",
            roleIds: ["barista"],
            startTime: { hours: 14, minutes: 0 },
            endTime: { hours: 18, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [
          {
            day: "2024-02-01",
            roleIds: ["barista"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 13, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
        ruleConfigs: [
          {
            name: "time-off",

            employeeIds: ["alice"],
            specificDates: ["2024-02-01"],
            startTime: { hours: 14, minutes: 0 },
            endTime: { hours: 18, minutes: 0 },
            priority: "LOW",
          },
        ],
      });

      const diagnostics = builder.compile();
      expect(diagnostics.canSolve).toBe(true);

      const response = await client.solve(diagnostics.request);
      expect(response.status).toBe("OPTIMAL");

      const result = parseSolverResponse(response);
      const resolved = resolveAssignments(result.assignments, builder.shiftPatterns);

      builder.reporter.analyzeSolution(response);
      builder.validateSolution(resolved);

      const validation = builder.reporter.getValidation();

      // Alice's afternoon time-off should be honored (she only works morning)
      const aliceAfternoon = resolved.find(
        (a) => a.employeeId === "alice" && a.startTime.hours === 14,
      );
      expect(aliceAfternoon).toBeUndefined();

      // Time-off should be marked as passed
      const timeOffPassed = validation.passed.find(
        (p) => p.type === "rule" && p.rule === "time-off",
      );
      expect(timeOffPassed).toBeDefined();
    }, 30_000);
  });
});
