import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import {
  createBaseConfig,
  decodeAssignments,
  PatternPenaltyRule,
  solveWithRules,
  startSolverContainer,
} from "./helpers.js";

describe("CP-SAT: min-hours-day rule", () => {
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

  it("selects longer shifts when daily minimum minutes exceed shorter patterns", async () => {
    // Coverage period matches the short shift so either pattern can satisfy it.
    // This isolates testing the min-hours-day rule behavior.
    const baseConfig = createBaseConfig({ roleId: "server",
      employeeIds: ["alice", "bob"],
      shiftPatterns: [
        {
          id: "short",
          roleIds: ["server"],
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 13, minutes: 0 },
        },
        {
          id: "long",
          roleIds: ["server"],
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      ],
      schedulingPeriod: { specificDates: ["2024-02-01"] },
      coverage: [
        {
          day: "2024-02-01",
          roleIds: ["server"],
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 13, minutes: 0 }, // Matches short shift duration
          targetCount: 2,
          priority: "MANDATORY" as const,
        },
      ],
    });

    const preferenceRuleConfigs: CpsatRuleConfigEntry[] = [
      {
        name: "employee-assignment-priority",
        config: { employeeIds: ["alice"], preference: "high" },
      },
      {
        name: "employee-assignment-priority",
        config: { employeeIds: ["bob"], preference: "high" },
      },
    ];
    const customRules = [new PatternPenaltyRule("long", 5)];

    const baseline = await solveWithRules(client, baseConfig, preferenceRuleConfigs, customRules);
    expect(baseline.status).toBe("OPTIMAL");
    const baselineAssignments = decodeAssignments(baseline.values);
    // With penalty on long shifts and no min-hours rule, solver prefers short shifts
    expect(baselineAssignments.filter((a) => a.shiftPatternId === "short").length).toBe(2);

    const withMinimum = await solveWithRules(
      client,
      baseConfig,
      [
        ...preferenceRuleConfigs,
        {
          name: "min-hours-day",
          config: { hours: 6, priority: "MANDATORY" },
        },
      ] satisfies CpsatRuleConfigEntry[],
      customRules,
    );
    expect(withMinimum.status).toBe("OPTIMAL");
    const minAssignments = decodeAssignments(withMinimum.values);
    // With min-hours-day of 6 hours, short shifts (4 hours) are disallowed
    expect(minAssignments.filter((a) => a.shiftPatternId === "long").length).toBe(2);
  }, 30_000);
});
