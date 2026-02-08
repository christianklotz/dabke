import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import {
  createBaseConfig,
  decodeAssignments,
  solveWithRules,
  startSolverContainer,
} from "./helpers.js";

describe("CP-SAT: min-consecutive-days rule", () => {
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

  it("extends work streaks once an employee starts working", async () => {
    const baseConfig = createBaseConfig({
      roleIds: ["cashier"],
      shift: {
        id: "day",
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
      schedulingPeriod: { specificDates: ["2024-02-01", "2024-02-02", "2024-02-03"] },
    });

    const baseRules: CpsatRuleConfigEntry[] = [
      {
        name: "employee-assignment-priority",
        config: { employeeIds: ["alice"], preference: "high" },
      },
      {
        name: "employee-assignment-priority",
        config: { employeeIds: ["bob"], preference: "low" },
      },
      {
        name: "time-off",
        config: {
          employeeIds: ["alice"],
          specificDates: ["2024-02-02"],
          priority: "MANDATORY",
        },
      },
    ];

    const baseline = await solveWithRules(client, baseConfig, baseRules);
    expect(baseline.status).toBe("OPTIMAL");
    const baselineAssignments = decodeAssignments(baseline.values);
    const bobBaseline = baselineAssignments.filter((a) => a.employeeId === "bob");
    expect(bobBaseline.map((a) => a.day)).toEqual(["2024-02-02"]);

    const withMinimum = await solveWithRules(client, baseConfig, [
      ...baseRules,
      {
        name: "min-consecutive-days",
        config: {
          days: 2,
          priority: "MANDATORY",
          employeeIds: ["bob"],
        },
      },
    ] satisfies CpsatRuleConfigEntry[]);
    expect(withMinimum.status).toBe("OPTIMAL");
    const bobAssignments = decodeAssignments(withMinimum.values).filter(
      (a) => a.employeeId === "bob",
    );

    expect(bobAssignments.map((a) => a.day)).toContain("2024-02-02");
    expect(bobAssignments.length).toBeGreaterThanOrEqual(2);
    expect(bobAssignments.some((a) => a.day === "2024-02-01" || a.day === "2024-02-03")).toBe(true);
  }, 30_000);
});
