import { beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { createBaseConfig, decodeAssignments, solveWithRules, getSolverClient } from "./helpers.js";

describe("CP-SAT: min-consecutive-days rule", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("extends work streaks once an member starts working", async () => {
    const baseConfig = createBaseConfig({
      roleIds: ["cashier"],
      shift: {
        id: "day",
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-03" } },
    });

    const baseRules: CpsatRuleConfigEntry[] = [
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
      {
        name: "time-off",

        memberIds: ["alice"],
        specificDates: ["2024-02-02"],
        priority: "MANDATORY",
      },
    ];

    const baseline = await solveWithRules(client, baseConfig, baseRules);
    expect(baseline.status).toBe("OPTIMAL");
    const baselineAssignments = decodeAssignments(baseline.values);
    const bobBaseline = baselineAssignments.filter((a) => a.memberId === "bob");
    expect(bobBaseline.map((a) => a.day)).toEqual(["2024-02-02"]);

    const withMinimum = await solveWithRules(client, baseConfig, [
      ...baseRules,
      {
        name: "min-consecutive-days",

        days: 2,
        priority: "MANDATORY",
        memberIds: ["bob"],
      },
    ] satisfies CpsatRuleConfigEntry[]);
    expect(withMinimum.status).toBe("OPTIMAL");
    const bobAssignments = decodeAssignments(withMinimum.values).filter(
      (a) => a.memberId === "bob",
    );

    expect(bobAssignments.map((a) => a.day)).toContain("2024-02-02");
    expect(bobAssignments.length).toBeGreaterThanOrEqual(2);
    expect(bobAssignments.some((a) => a.day === "2024-02-01" || a.day === "2024-02-03")).toBe(true);
  }, 30_000);
});
