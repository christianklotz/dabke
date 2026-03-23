import { beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { createBaseConfig, decodeAssignments, solveWithRules, getSolverClient } from "./helpers.js";

describe("CP-SAT: max-days-week rule", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("caps weekly day count and shifts remaining work to other members", async () => {
    const baseConfig = createBaseConfig({
      roleIds: ["bartender"],
      memberIds: ["alice", "bob"],
      shift: {
        id: "swing",
        startTime: { hours: 10, minutes: 0 },
        endTime: { hours: 18, minutes: 0 },
      },
      schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-09" } },
    });

    const preferenceRules: CpsatRuleConfigEntry[] = [
      {
        name: "assignment-priority",
        memberIds: ["alice"],
        preference: "high",
      },
      {
        name: "assignment-priority",
        memberIds: ["bob"],
        preference: "low",
      },
    ];

    // Without the cap, alice gets all 5 days
    const baseline = await solveWithRules(client, baseConfig, preferenceRules);
    expect(baseline.status).toBe("OPTIMAL");
    const baselineAssignments = decodeAssignments(baseline.values);
    expect(baselineAssignments.filter((a) => a.memberId === "alice").length).toBe(5);

    // With max 3 days, alice should work at most 3 days and bob picks up the rest
    const withWeeklyCap = await solveWithRules(client, baseConfig, [
      ...preferenceRules,
      {
        name: "max-days-week",
        days: 3,
        priority: "MANDATORY",
      },
    ] satisfies CpsatRuleConfigEntry[]);

    expect(withWeeklyCap.status).toBe("OPTIMAL");
    const cappedAssignments = decodeAssignments(withWeeklyCap.values);
    expect(cappedAssignments.filter((a) => a.memberId === "alice").length).toBeLessThanOrEqual(3);
    expect(cappedAssignments.filter((a) => a.memberId === "bob").length).toBeGreaterThanOrEqual(2);
  }, 30_000);
});
