import { describe, it, expect, beforeAll } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { createBaseConfig, decodeAssignments, solveWithRules, getSolverClient } from "./helpers.js";

describe("CP-SAT: max-shifts-day rule (integration)", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("limits employee to one shift per day when maxShifts is 1", async () => {
    // Two employees, two shifts, but each can only work one shift
    const baseConfig = createBaseConfig({
      employeeIds: ["alice", "bob"],
      shifts: [
        {
          id: "morning",
          startTime: { hours: 8, minutes: 0 },
          endTime: { hours: 12, minutes: 0 },
        },
        {
          id: "afternoon",
          startTime: { hours: 13, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
      targetCount: 1,
    });

    const rules: CpsatRuleConfigEntry[] = [
      {
        name: "max-shifts-day",

        shifts: 1,
        priority: "MANDATORY",
      },
    ];

    const response = await solveWithRules(client, baseConfig, rules);

    expect(response.status).toBe("OPTIMAL");
    const assignments = decodeAssignments(response.values);

    // Each employee should only be assigned to one shift
    const aliceAssignments = assignments.filter(
      (a) => a?.employeeId === "alice" && a?.day === "2024-02-01",
    );
    const bobAssignments = assignments.filter(
      (a) => a?.employeeId === "bob" && a?.day === "2024-02-01",
    );
    expect(aliceAssignments.length).toBeLessThanOrEqual(1);
    expect(bobAssignments.length).toBeLessThanOrEqual(1);

    // Both shifts should be covered (by different people)
    expect(assignments).toHaveLength(2);
  }, 30_000);

  it("allows employee to work multiple shifts when maxShifts permits", async () => {
    const baseConfig = createBaseConfig({
      employeeIds: ["alice"],
      shifts: [
        {
          id: "morning",
          startTime: { hours: 8, minutes: 0 },
          endTime: { hours: 12, minutes: 0 },
        },
        {
          id: "afternoon",
          startTime: { hours: 13, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
      targetCount: 1,
    });

    const rules: CpsatRuleConfigEntry[] = [
      {
        name: "max-shifts-day",

        shifts: 2,
        priority: "MANDATORY",
      },
    ];

    const response = await solveWithRules(client, baseConfig, rules);

    expect(response.status).toBe("OPTIMAL");
    const assignments = decodeAssignments(response.values);

    // Alice can be assigned to both shifts (coverage requires it)
    const aliceAssignments = assignments.filter(
      (a) => a?.employeeId === "alice" && a?.day === "2024-02-01",
    );
    expect(aliceAssignments).toHaveLength(2);
  }, 30_000);

  it("without max-shifts-day rule, employees can work unlimited shifts", async () => {
    const baseConfig = createBaseConfig({
      employeeIds: ["alice"],
      shifts: [
        {
          id: "morning",
          startTime: { hours: 8, minutes: 0 },
          endTime: { hours: 12, minutes: 0 },
        },
        {
          id: "afternoon",
          startTime: { hours: 13, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
        {
          id: "evening",
          startTime: { hours: 18, minutes: 0 },
          endTime: { hours: 22, minutes: 0 },
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
      targetCount: 1,
    });

    // No max-shifts-day rule
    const rules: CpsatRuleConfigEntry[] = [];

    const response = await solveWithRules(client, baseConfig, rules);

    expect(response.status).toBe("OPTIMAL");
    const assignments = decodeAssignments(response.values);

    // Alice should be assigned to all 3 shifts to meet coverage
    const aliceAssignments = assignments.filter(
      (a) => a?.employeeId === "alice" && a?.day === "2024-02-01",
    );
    expect(aliceAssignments).toHaveLength(3);
  }, 30_000);

  it("soft constraint allows exceeding limit with penalty", async () => {
    // With only one employee and two required shifts, a soft limit should be exceeded
    const baseConfig = createBaseConfig({
      employeeIds: ["alice"],
      shifts: [
        {
          id: "morning",
          startTime: { hours: 8, minutes: 0 },
          endTime: { hours: 12, minutes: 0 },
        },
        {
          id: "afternoon",
          startTime: { hours: 13, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
      targetCount: 1, // Both shifts need coverage
    });

    const rules: CpsatRuleConfigEntry[] = [
      {
        name: "max-shifts-day",

        shifts: 1,
        priority: "LOW", // Soft constraint,
      },
    ];

    const response = await solveWithRules(client, baseConfig, rules);

    expect(response.status).toBe("OPTIMAL");
    const assignments = decodeAssignments(response.values);

    // Coverage is mandatory, so alice works both shifts despite soft limit
    const aliceAssignments = assignments.filter(
      (a) => a?.employeeId === "alice" && a?.day === "2024-02-01",
    );
    expect(aliceAssignments).toHaveLength(2);
  }, 30_000);

  it("hard constraint makes infeasible when cannot be satisfied", async () => {
    // Only alice available, two shifts need coverage, but max 1 shift allowed
    const baseConfig = createBaseConfig({
      employeeIds: ["alice"],
      shifts: [
        {
          id: "morning",
          startTime: { hours: 8, minutes: 0 },
          endTime: { hours: 12, minutes: 0 },
        },
        {
          id: "afternoon",
          startTime: { hours: 13, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
      targetCount: 1,
    });

    const rules: CpsatRuleConfigEntry[] = [
      {
        name: "max-shifts-day",

        shifts: 1,
        priority: "MANDATORY",
      },
    ];

    const response = await solveWithRules(client, baseConfig, rules);

    // Should be infeasible: can't cover both shifts with max 1 shift per employee
    expect(response.status).toBe("INFEASIBLE");
  }, 30_000);
});
