import { beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { createBaseConfig, decodeAssignments, solveWithRules, getSolverClient } from "./helpers.js";

describe("CP-SAT: member-assignment-priority rule", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("favors members with higher assignment priority", async () => {
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
        name: "assignment-priority",
        memberIds: ["bob"],
        preference: "high",
      },
      {
        name: "assignment-priority",
        memberIds: ["alice"],
        preference: "low",
      },
    ] satisfies CpsatRuleConfigEntry[]);
    expect(response.status).toBe("OPTIMAL");
    const assignments = decodeAssignments(response.values);
    expect(assignments).toContainEqual(expect.objectContaining({ memberId: "bob" }));
    expect(assignments.find((a) => a.memberId === "alice")).toBeUndefined();
  }, 30_000);

  it("assigns low-preference members when coverage requires it", async () => {
    // Only one member available (alice with low preference), coverage requires 1
    // The soft preference should not prevent assignment
    const baseConfig = createBaseConfig({
      roleIds: ["stocker"],
      memberIds: ["alice"],
      shift: {
        id: "day",
        startTime: { hours: 10, minutes: 0 },
        endTime: { hours: 18, minutes: 0 },
      },
      targetCount: 1,
    });

    const response = await solveWithRules(client, baseConfig, [
      {
        name: "assignment-priority",
        memberIds: ["alice"],
        preference: "low",
      },
    ] satisfies CpsatRuleConfigEntry[]);

    expect(response.status).toBe("OPTIMAL");
    const assignments = decodeAssignments(response.values);
    // Alice must be assigned despite low preference because coverage requires it
    expect(assignments).toContainEqual(expect.objectContaining({ memberId: "alice" }));
  }, 30_000);

  it("high preference is soft - non-preferred members still assignable", async () => {
    // Bob has high preference, but we need 2 members to cover
    // Alice (no preference specified) should also be assigned
    const baseConfig = createBaseConfig({
      roleIds: ["stocker"],
      memberIds: ["alice", "bob"],
      shift: {
        id: "day",
        startTime: { hours: 10, minutes: 0 },
        endTime: { hours: 18, minutes: 0 },
      },
      targetCount: 2,
    });

    const response = await solveWithRules(client, baseConfig, [
      {
        name: "assignment-priority",
        memberIds: ["bob"],
        preference: "high",
      },
    ] satisfies CpsatRuleConfigEntry[]);

    expect(response.status).toBe("OPTIMAL");
    const assignments = decodeAssignments(response.values);
    // Both should be assigned to meet coverage requirement
    expect(assignments).toHaveLength(2);
    expect(assignments).toContainEqual(expect.objectContaining({ memberId: "alice" }));
    expect(assignments).toContainEqual(expect.objectContaining({ memberId: "bob" }));
  }, 30_000);
});
