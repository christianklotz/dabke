import { beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { createBaseConfig, decodeAssignments, solveWithRules, getSolverClient } from "./helpers.js";

describe("CP-SAT: must-assign rule", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("forces both members onto the schedule when only one is needed", async () => {
    // Single day, targetCount: 1, two members.
    // Baseline: solver only assigns 1 member (coverage satisfied with 1).
    // With must-assign on both: solver must assign both (2 assignments).
    const baseConfig = createBaseConfig({
      roleId: "waiter",
      memberIds: ["alice", "bob"],
      shift: {
        id: "day",
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
      targetCount: 1,
    });

    // Baseline: no must-assign, only 1 needed
    const baseline = await solveWithRules(client, baseConfig, []);
    expect(baseline.status).toBe("OPTIMAL");
    const baselineAssignments = decodeAssignments(baseline.values);
    expect(baselineAssignments.length).toBe(1);

    // With must-assign on both: both must appear
    const withRule = await solveWithRules(client, baseConfig, [
      { name: "must-assign", memberIds: ["alice", "bob"] },
    ] satisfies CpsatRuleConfigEntry[]);

    expect(withRule.status).toBe("OPTIMAL");
    const assignments = decodeAssignments(withRule.values);
    expect(assignments.length).toBe(2);
    expect(assignments.some((a) => a.memberId === "alice")).toBe(true);
    expect(assignments.some((a) => a.memberId === "bob")).toBe(true);
  }, 30_000);

  it("produces a soft violation when member has full-period time-off", async () => {
    const baseConfig = createBaseConfig({
      roleId: "waiter",
      memberIds: ["alice", "bob"],
      shift: {
        id: "day",
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
      targetCount: 1,
    });

    const result = await solveWithRules(client, baseConfig, [
      { name: "must-assign", memberIds: ["bob"] },
      {
        name: "time-off",
        memberIds: ["bob"],
        dateRange: { start: "2024-02-01", end: "2024-02-01" },
        priority: "MANDATORY",
      },
    ] satisfies CpsatRuleConfigEntry[]);

    // Schedule succeeds (must-assign is soft), bob not assigned
    expect(result.status).toBe("OPTIMAL");
    const assignments = decodeAssignments(result.values);
    expect(assignments.filter((a) => a.memberId === "bob").length).toBe(0);

    // Soft violation reported for bob
    const violations = result.softConstraintViolations ?? [];
    const mustAssignViolation = violations.find((v) =>
      v.constraintId.startsWith("must-assign:bob:"),
    );
    expect(mustAssignViolation).toBeDefined();
  }, 30_000);
});
