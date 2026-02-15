import { beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { createBaseConfig, decodeAssignments, solveWithRules, getSolverClient } from "./helpers.js";

describe("CP-SAT: min-hours-day rule", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("excludes patterns shorter than the daily minimum", async () => {
    const shiftPatterns = [
      {
        id: "short",
        roleIds: ["server"] as [string],
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 13, minutes: 0 },
      },
      {
        id: "long",
        roleIds: ["server"] as [string],
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
    ];
    const coverage = [
      {
        day: "2024-02-01",
        roleIds: ["server"] as [string],
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 13, minutes: 0 },
        targetCount: 1,
        priority: "MANDATORY" as const,
      },
    ];

    // Control: only the short pattern — solver must assign it, proving it's viable
    const control = await solveWithRules(
      client,
      createBaseConfig({
        roleId: "server",
        employeeIds: ["alice"],
        shiftPatterns: [shiftPatterns[0]!],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage,
      }),
      [],
    );
    expect(control.status).toBe("OPTIMAL");
    const controlAssignments = decodeAssignments(control.values);
    expect(controlAssignments).toContainEqual(expect.objectContaining({ shiftPatternId: "short" }));

    // With rule: both patterns available, 6h minimum excludes short (4h)
    const withMinimum = await solveWithRules(
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
          name: "min-hours-day",
          hours: 6,
          priority: "MANDATORY",
        },
      ] satisfies CpsatRuleConfigEntry[],
    );
    expect(withMinimum.status).toBe("OPTIMAL");
    const minAssignments = decodeAssignments(withMinimum.values);
    expect(minAssignments).toContainEqual(expect.objectContaining({ shiftPatternId: "long" }));
    expect(minAssignments.find((a) => a.shiftPatternId === "short")).toBeUndefined();
  }, 30_000);
});
