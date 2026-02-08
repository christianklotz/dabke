import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import {
  createBaseConfig,
  decodeAssignments,
  PatternPenaltyRule,
  solveWithRules,
  startSolverContainer,
} from "./helpers.js";

describe("CP-SAT: max-hours-day rule", () => {
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

  it("avoids assigning patterns longer than the daily cap", async () => {
    // Coverage period matches the short shift so either pattern can satisfy it.
    // This isolates testing the max-hours-day rule behavior.
    const baseConfig = createBaseConfig({ roleId: "server",
      employeeIds: ["alice", "bob"],
      shiftPatterns: [
        {
          id: "short",
          roleIds: ["server"],
          startTime: { hours: 8, minutes: 0 },
          endTime: { hours: 14, minutes: 0 },
        },
        {
          id: "long",
          roleIds: ["server"],
          startTime: { hours: 8, minutes: 0 },
          endTime: { hours: 18, minutes: 0 },
        },
      ],
      schedulingPeriod: { specificDates: ["2024-02-01"] },
      coverage: [
        {
          day: "2024-02-01",
          roleIds: ["server"],
          startTime: { hours: 8, minutes: 0 },
          endTime: { hours: 14, minutes: 0 }, // Matches short shift duration
          targetCount: 1,
          priority: "MANDATORY" as const,
        },
      ],
    });

    const preferenceRules: CpsatRuleConfigEntry[] = [
      {
        name: "employee-assignment-priority",
        config: { employeeIds: ["alice"], preference: "high" },
      },
      {
        name: "employee-assignment-priority",
        config: { employeeIds: ["bob"], preference: "low" },
      },
    ];
    const customRules = [new PatternPenaltyRule("short", 5)];

    const baseline = await solveWithRules(client, baseConfig, preferenceRules, customRules);
    expect(baseline.status).toBe("OPTIMAL");
    const baselineAssignments = decodeAssignments(baseline.values);
    // Without max-hours cap, solver prefers long shift (penalty on short)
    expect(baselineAssignments).toContainEqual(
      expect.objectContaining({ employeeId: "alice", patternId: "long" }),
    );

    const withCap = await solveWithRules(
      client,
      baseConfig,
      [
        ...preferenceRules,
        {
          name: "max-hours-day",
          config: { hours: 8, priority: "MANDATORY" },
        },
      ] satisfies CpsatRuleConfigEntry[],
      customRules,
    );

    expect(withCap.status).toBe("OPTIMAL");
    const cappedAssignments = decodeAssignments(withCap.values);
    // With max-hours-day of 8 hours, long shifts (10 hours) are disallowed
    expect(cappedAssignments).toContainEqual(
      expect.objectContaining({ patternId: "short", day: "2024-02-01" }),
    );
    expect(cappedAssignments.find((a) => a.shiftPatternId === "long")).toBeUndefined();
  }, 30_000);
});
