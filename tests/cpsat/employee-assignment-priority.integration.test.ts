import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import {
  createBaseConfig,
  decodeAssignments,
  solveWithRules,
  startSolverContainer,
} from "./helpers.js";

describe("CP-SAT: employee-assignment-priority rule", () => {
  let stop: (() => void) | undefined;
  let client: Awaited<ReturnType<typeof startSolverContainer>>["client"];

  beforeAll(async () => {
    const started = await startSolverContainer();
    client = started.client;
    stop = started.stop;
  }, 120_000);

  afterAll(() => {
    stop?.();
  });

  it("favors employees with higher assignment priority", async () => {
    const baseConfig = createBaseConfig({
      roleIds: ["stocker"],
      shift: {
        id: "day",
        startTime: { hours: 10, minutes: 0 },
        endTime: { hours: 18, minutes: 0 },
      },
    });

    const response = await solveWithRules(client, baseConfig, [
      {
        name: "employee-assignment-priority",
        config: { employeeIds: ["bob"], preference: "high" },
      },
      {
        name: "employee-assignment-priority",
        config: { employeeIds: ["alice"], preference: "low" },
      },
    ] satisfies CpsatRuleConfigEntry[]);
    expect(response.status).toBe("OPTIMAL");
    const assignments = decodeAssignments(response.values);
    expect(assignments).toContainEqual(expect.objectContaining({ employeeId: "bob" }));
    expect(assignments.find((a) => a.employeeId === "alice")).toBeUndefined();
  }, 30_000);

  it("assigns low-preference employees when coverage requires it", async () => {
    // Only one employee available (alice with low preference), coverage requires 1
    // The soft preference should not prevent assignment
    const baseConfig = createBaseConfig({
      roleIds: ["stocker"],
      employeeIds: ["alice"],
      shift: {
        id: "day",
        startTime: { hours: 10, minutes: 0 },
        endTime: { hours: 18, minutes: 0 },
      },
      targetCount: 1,
    });

    const response = await solveWithRules(client, baseConfig, [
      {
        name: "employee-assignment-priority",
        config: { employeeIds: ["alice"], preference: "low" },
      },
    ] satisfies CpsatRuleConfigEntry[]);

    expect(response.status).toBe("OPTIMAL");
    const assignments = decodeAssignments(response.values);
    // Alice must be assigned despite low preference because coverage requires it
    expect(assignments).toContainEqual(expect.objectContaining({ employeeId: "alice" }));
  }, 30_000);

  it("high preference is soft - non-preferred employees still assignable", async () => {
    // Bob has high preference, but we need 2 employees to cover
    // Alice (no preference specified) should also be assigned
    const baseConfig = createBaseConfig({
      roleIds: ["stocker"],
      employeeIds: ["alice", "bob"],
      shift: {
        id: "day",
        startTime: { hours: 10, minutes: 0 },
        endTime: { hours: 18, minutes: 0 },
      },
      targetCount: 2,
    });

    const response = await solveWithRules(client, baseConfig, [
      {
        name: "employee-assignment-priority",
        config: { employeeIds: ["bob"], preference: "high" },
      },
    ] satisfies CpsatRuleConfigEntry[]);

    expect(response.status).toBe("OPTIMAL");
    const assignments = decodeAssignments(response.values);
    // Both should be assigned to meet coverage requirement
    expect(assignments).toHaveLength(2);
    expect(assignments).toContainEqual(expect.objectContaining({ employeeId: "alice" }));
    expect(assignments).toContainEqual(expect.objectContaining({ employeeId: "bob" }));
  }, 30_000);
});
