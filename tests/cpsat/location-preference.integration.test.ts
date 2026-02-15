import { beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { createBaseConfig, decodeAssignments, solveWithRules, getSolverClient } from "./helpers.js";

describe("CP-SAT: location-preference rule", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("steers assignments toward the preferred location", async () => {
    const shiftPatterns = [
      {
        id: "indoor",
        roleIds: ["waiter"] as [string],
        locationId: "indoor",
        startTime: { hours: 12, minutes: 0 },
        endTime: { hours: 18, minutes: 0 },
      },
      {
        id: "terrace",
        roleIds: ["waiter"] as [string],
        locationId: "terrace",
        startTime: { hours: 12, minutes: 0 },
        endTime: { hours: 18, minutes: 0 },
      },
    ];
    const coverage = [
      {
        day: "2024-02-01",
        roleIds: ["waiter"] as [string],
        startTime: { hours: 12, minutes: 0 },
        endTime: { hours: 18, minutes: 0 },
        targetCount: 1,
        priority: "MANDATORY" as const,
      },
    ];

    // Control: only indoor — solver must assign it, proving it's viable
    const control = await solveWithRules(
      client,
      createBaseConfig({
        roleId: "waiter",
        employeeIds: ["victoria"],
        shiftPatterns: [shiftPatterns[0]!],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage,
      }),
      [],
    );
    expect(control.status).toBe("OPTIMAL");
    const controlAssignments = decodeAssignments(control.values);
    expect(controlAssignments).toContainEqual(
      expect.objectContaining({ employeeId: "victoria", shiftPatternId: "indoor" }),
    );

    // With rule: both locations available, preference steers victoria to terrace
    const withPreference = await solveWithRules(
      client,
      createBaseConfig({
        roleId: "waiter",
        employeeIds: ["victoria"],
        shiftPatterns,
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage,
      }),
      [
        {
          name: "location-preference",

          locationId: "terrace",
          priority: "HIGH",
          employeeIds: ["victoria"],
        },
      ] satisfies CpsatRuleConfigEntry[],
    );
    expect(withPreference.status).toBe("OPTIMAL");
    const preferredAssignments = decodeAssignments(withPreference.values);
    expect(preferredAssignments).toContainEqual(
      expect.objectContaining({ employeeId: "victoria", shiftPatternId: "terrace" }),
    );
  }, 30_000);
});
