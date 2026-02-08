import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import {
  createBaseConfig,
  decodeAssignments,
  PatternPenaltyRule,
  solveWithRules,
  startSolverContainer,
} from "./helpers.js";

describe("CP-SAT: location-preference rule", () => {
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

  it("steers assignments toward the preferred location", async () => {
    const baseConfig = createBaseConfig({ roleId: "waiter",
      employeeIds: ["victoria", "bob"],
      shiftPatterns: [
        {
          id: "indoor",
          roleIds: ["waiter"],
          locationId: "indoor",
          startTime: { hours: 12, minutes: 0 },
          endTime: { hours: 18, minutes: 0 },
        },
        {
          id: "terrace",
          roleIds: ["waiter"],
          locationId: "terrace",
          startTime: { hours: 12, minutes: 0 },
          endTime: { hours: 18, minutes: 0 },
        },
      ],
      schedulingPeriod: { specificDates: ["2024-02-01"] },
      coverage: [
        {
          day: "2024-02-01",
          roleIds: ["waiter"],
          startTime: { hours: 12, minutes: 0 },
          endTime: { hours: 18, minutes: 0 },
          targetCount: 1,
          priority: "MANDATORY" as const,
        },
      ],
    });

    const preferenceRuleConfigs: CpsatRuleConfigEntry[] = [
      {
        name: "employee-assignment-priority",
        config: { employeeIds: ["victoria"], preference: "high" },
      },
    ];
    const customRules = [new PatternPenaltyRule("terrace", 5)];

    const baseline = await solveWithRules(client, baseConfig, preferenceRuleConfigs, customRules);
    expect(baseline.status).toBe("OPTIMAL");
    const baselineAssignments = decodeAssignments(baseline.values);
    expect(baselineAssignments).toContainEqual(
      expect.objectContaining({ employeeId: "victoria", patternId: "indoor" }),
    );

    const withPreference = await solveWithRules(
      client,
      baseConfig,
      [
        ...preferenceRuleConfigs,
        {
          name: "location-preference",
          config: {
            locationId: "terrace",
            priority: "HIGH",
            employeeIds: ["victoria"],
          },
        },
      ] satisfies CpsatRuleConfigEntry[],
      customRules,
    );
    expect(withPreference.status).toBe("OPTIMAL");
    const preferredAssignments = decodeAssignments(withPreference.values);
    expect(preferredAssignments).toContainEqual(
      expect.objectContaining({ employeeId: "victoria", patternId: "terrace" }),
    );
  }, 30_000);
});
