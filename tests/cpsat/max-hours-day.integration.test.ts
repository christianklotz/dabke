import { beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { createBaseConfig, decodeAssignments, solveWithRules, getSolverClient } from "./helpers.js";

describe("CP-SAT: max-hours-day rule", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("avoids assigning patterns longer than the daily cap", async () => {
    const shiftPatterns = [
      {
        id: "short",
        roleIds: ["server"] as [string],
        startTime: { hours: 8, minutes: 0 },
        endTime: { hours: 14, minutes: 0 },
      },
      {
        id: "long",
        roleIds: ["server"] as [string],
        startTime: { hours: 8, minutes: 0 },
        endTime: { hours: 18, minutes: 0 },
      },
    ];
    const coverage = [
      {
        day: "2024-02-01",
        roleIds: ["server"] as [string],
        startTime: { hours: 8, minutes: 0 },
        endTime: { hours: 14, minutes: 0 },
        targetCount: 1,
        priority: "MANDATORY" as const,
      },
    ];

    // Control: only the long pattern — solver must assign it, proving it's viable
    const control = await solveWithRules(
      client,
      createBaseConfig({
        roleId: "server",
        employeeIds: ["alice"],
        shiftPatterns: [shiftPatterns[1]!],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage,
      }),
      [],
    );
    expect(control.status).toBe("OPTIMAL");
    const controlAssignments = decodeAssignments(control.values);
    expect(controlAssignments).toContainEqual(expect.objectContaining({ shiftPatternId: "long" }));

    // With rule: both patterns available, 8h cap excludes long (10h)
    const withCap = await solveWithRules(
      client,
      createBaseConfig({
        roleId: "server",
        employeeIds: ["alice"],
        shiftPatterns,
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage,
      }),
      [
        {
          name: "max-hours-day",
          config: { hours: 8, priority: "MANDATORY" },
        },
      ] satisfies CpsatRuleConfigEntry[],
    );
    expect(withCap.status).toBe("OPTIMAL");
    const cappedAssignments = decodeAssignments(withCap.values);
    expect(cappedAssignments).toContainEqual(expect.objectContaining({ shiftPatternId: "short" }));
    expect(cappedAssignments.find((a) => a.shiftPatternId === "long")).toBeUndefined();
  }, 30_000);
});
