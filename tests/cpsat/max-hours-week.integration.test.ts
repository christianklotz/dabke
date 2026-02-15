import { beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { createBaseConfig, decodeAssignments, solveWithRules, getSolverClient } from "./helpers.js";

describe("CP-SAT: max-hours-week rule", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("caps weekly assignments and shifts remaining work to other employees", async () => {
    const baseConfig = createBaseConfig({
      roleIds: ["bartender"],
      employeeIds: ["alice", "bob"],
      shift: {
        id: "swing",
        startTime: { hours: 10, minutes: 0 },
        endTime: { hours: 18, minutes: 0 },
      },
      schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-08" } },
    });

    const preferenceRules: CpsatRuleConfigEntry[] = [
      {
        name: "employee-assignment-priority",
        employeeIds: ["alice"],
        preference: "high",
      },
      {
        name: "employee-assignment-priority",
        employeeIds: ["bob"],
        preference: "low",
      },
    ];

    const baseline = await solveWithRules(client, baseConfig, preferenceRules);
    expect(baseline.status).toBe("OPTIMAL");
    const baselineAssignments = decodeAssignments(baseline.values);
    expect(baselineAssignments.filter((a) => a.employeeId === "alice").length).toBe(4);

    const withWeeklyCap = await solveWithRules(client, baseConfig, [
      ...preferenceRules,
      {
        name: "max-hours-week",

        hours: 16,
        priority: "MANDATORY",
      },
    ] satisfies CpsatRuleConfigEntry[]);

    expect(withWeeklyCap.status).toBe("OPTIMAL");
    const cappedAssignments = decodeAssignments(withWeeklyCap.values);
    expect(cappedAssignments.filter((a) => a.employeeId === "alice").length).toBeLessThanOrEqual(2);
    expect(cappedAssignments.filter((a) => a.employeeId === "bob").length).toBeGreaterThanOrEqual(
      2,
    );
  }, 30_000);
});
