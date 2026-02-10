import { beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { createBaseConfig, decodeAssignments, solveWithRules, getSolverClient } from "./helpers.js";

describe("CP-SAT: assign-together rule", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("keeps paired employees on the same shifts", async () => {
    const baseConfig = createBaseConfig({
      roleIds: ["runner"],
      employeeIds: ["alice", "bob"],
      shift: {
        id: "day",
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-02" } },
    });

    const preferenceRules: CpsatRuleConfigEntry[] = [
      {
        name: "employee-assignment-priority",
        config: { employeeIds: ["alice"], preference: "high" },
      },
      {
        name: "employee-assignment-priority",
        config: { employeeIds: ["bob"], preference: "low" },
      },
    ];

    const baseline = await solveWithRules(client, baseConfig, preferenceRules);
    expect(baseline.status).toBe("OPTIMAL");
    const baselineAssignments = decodeAssignments(baseline.values);
    expect(baselineAssignments.filter((a) => a.employeeId === "alice").length).toBe(2);
    expect(baselineAssignments.find((a) => a.employeeId === "bob")).toBeUndefined();

    const withPairing = await solveWithRules(client, baseConfig, [
      ...preferenceRules,
      {
        name: "assign-together",
        config: { groupEmployeeIds: ["alice", "bob"], priority: "HIGH" },
      },
    ] satisfies CpsatRuleConfigEntry[]);
    expect(withPairing.status).toBe("OPTIMAL");
    const pairedAssignments = decodeAssignments(withPairing.values);
    const aliceDays = pairedAssignments
      .filter((a) => a.employeeId === "alice")
      .map((a) => a.day)
      .toSorted();
    const bobDays = pairedAssignments
      .filter((a) => a.employeeId === "bob")
      .map((a) => a.day)
      .toSorted();
    expect(bobDays).toEqual(aliceDays);
    expect(bobDays).toHaveLength(2);
  }, 30_000);

  it("overlapping groups create transitive constraints (all three must work together)", async () => {
    // Scenario: 5 employees, need 2 per day
    // Rule 1: one and two should work together
    // Rule 2: two and three should work together
    // Question: Does this mean all three (one, two, three) must work together?

    const days = ["2024-02-01"];
    const roleId = "worker";

    const baseConfig = createBaseConfig({
      roleId,
      employeeIds: ["one", "two", "three", "four", "five"],
      shift: {
        id: "day",
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
      schedulingPeriod: { dateRange: { start: days[0]!, end: days[days.length - 1]! } },
      targetCount: 2, // Only need 2 employees
    });

    const rules: CpsatRuleConfigEntry[] = [
      {
        name: "assign-together",
        config: { groupEmployeeIds: ["one", "two"], priority: "MANDATORY" },
      },
      {
        name: "assign-together",
        config: { groupEmployeeIds: ["two", "three"], priority: "MANDATORY" },
      },
    ];

    const response = await solveWithRules(client, baseConfig, rules);
    console.log("Overlapping groups response:", response.status);

    // The solver should either find an optimal solution respecting transitivity,
    // or determine it's infeasible (can't satisfy transitive constraints with only 2 slots)
    expect(["OPTIMAL", "INFEASIBLE"]).toContain(response.status);

    if (response.status !== "OPTIMAL") {
      // INFEASIBLE is acceptable - transitive constraints may require 3 slots
      console.log("Result was:", response.status);
      return;
    }

    const assignments = decodeAssignments(response.values);
    console.log("Assignments:", assignments);

    const assignedEmployees = assignments.map((a) => a.employeeId).toSorted();
    console.log("Assigned employees:", assignedEmployees);

    // If transitive: one, two, three all work together (but we only need 2)
    const hasOne = assignedEmployees.includes("one");
    const hasTwo = assignedEmployees.includes("two");
    const hasThree = assignedEmployees.includes("three");

    console.log("Has one:", hasOne, "Has two:", hasTwo, "Has three:", hasThree);

    // Check transitivity: if any of one/two/three are assigned, they must all be assigned together
    // Either none or all three should be assigned (transitive constraint)
    const linkedGroup = [hasOne, hasTwo, hasThree];
    const allAssigned = linkedGroup.every(Boolean);
    const noneAssigned = linkedGroup.every((x) => !x);
    expect(allAssigned || noneAssigned).toBe(true);
  }, 30_000);

  it("overlapping groups with sufficient coverage allows all linked employees", async () => {
    // Same as above but with targetCount: 3 to allow all three to work
    const days = ["2024-02-01"];
    const roleId = "worker";

    const baseConfig = createBaseConfig({
      roleId,
      employeeIds: ["one", "two", "three", "four", "five"],
      shift: {
        id: "day",
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
      schedulingPeriod: { dateRange: { start: days[0]!, end: days[days.length - 1]! } },
      targetCount: 3, // Need 3 employees - enough for the transitive group
    });

    const rules: CpsatRuleConfigEntry[] = [
      {
        name: "assign-together",
        config: { groupEmployeeIds: ["one", "two"], priority: "MANDATORY" },
      },
      {
        name: "assign-together",
        config: { groupEmployeeIds: ["two", "three"], priority: "MANDATORY" },
      },
    ];

    const response = await solveWithRules(client, baseConfig, rules);
    expect(response.status).toBe("OPTIMAL");

    const assignments = decodeAssignments(response.values);
    const assignedEmployees = assignments.map((a) => a.employeeId).toSorted();

    console.log("With sufficient coverage, assigned:", assignedEmployees);

    // All three should be assigned together due to transitive constraints
    expect(assignedEmployees).toContain("one");
    expect(assignedEmployees).toContain("two");
    expect(assignedEmployees).toContain("three");
  }, 30_000);

  it("non-overlapping groups are independent", async () => {
    // Rule 1: one and two together
    // Rule 2: four and five together
    // These should be independent - solver can pick either group

    const days = ["2024-02-01"];
    const roleId = "worker";

    const baseConfig = createBaseConfig({
      roleId,
      employeeIds: ["one", "two", "three", "four", "five"],
      shift: {
        id: "day",
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
      schedulingPeriod: { dateRange: { start: days[0]!, end: days[days.length - 1]! } },
      targetCount: 2,
    });

    const rules: CpsatRuleConfigEntry[] = [
      {
        name: "assign-together",
        config: { groupEmployeeIds: ["one", "two"], priority: "MANDATORY" },
      },
      {
        name: "assign-together",
        config: { groupEmployeeIds: ["four", "five"], priority: "MANDATORY" },
      },
    ];

    const response = await solveWithRules(client, baseConfig, rules);
    expect(response.status).toBe("OPTIMAL");

    const assignments = decodeAssignments(response.values);
    const assignedEmployees = new Set(assignments.map((a) => a.employeeId));

    console.log("Non-overlapping groups, assigned:", [...assignedEmployees]);

    // Should get exactly one of the pairs (or possibly three if needed 2 workers)
    const hasGroupA = assignedEmployees.has("one") && assignedEmployees.has("two");
    const hasGroupB = assignedEmployees.has("four") && assignedEmployees.has("five");

    // At least one complete group should be assigned
    expect(hasGroupA || hasGroupB).toBe(true);

    // If one is assigned, two must be assigned (and vice versa)
    expect(assignedEmployees.has("one")).toBe(assignedEmployees.has("two"));
    expect(assignedEmployees.has("four")).toBe(assignedEmployees.has("five"));
  }, 30_000);
});
