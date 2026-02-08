import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import {
  createBaseConfig,
  decodeAssignments,
  solveWithRules,
  startSolverContainer,
} from "./helpers.js";

describe("CP-SAT: max-consecutive-days rule", () => {
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

  it("limits consecutive working days", async () => {
    const baseConfig = createBaseConfig({
      roleIds: ["barista"],
      shift: {
        id: "day",
        startTime: { hours: 7, minutes: 0 },
        endTime: { hours: 15, minutes: 0 },
      },
      schedulingPeriod: { specificDates: ["2024-02-01", "2024-02-02", "2024-02-03"] },
    });

    const preference: CpsatRuleConfigEntry[] = [
      {
        name: "employee-assignment-priority",
        config: { employeeIds: ["alice"], preference: "high" },
      },
      {
        name: "employee-assignment-priority",
        config: { employeeIds: ["bob"], preference: "low" },
      },
    ];

    const baseline = await solveWithRules(client, baseConfig, preference);
    expect(baseline.status).toBe("OPTIMAL");
    const baselineAssignments = decodeAssignments(baseline.values);
    expect(baselineAssignments.filter((a) => a.employeeId === "alice").length).toBe(3);

    const withLimit = await solveWithRules(client, baseConfig, [
      ...preference,
      {
        name: "max-consecutive-days",
        config: { days: 2, priority: "MANDATORY" },
      },
    ] satisfies CpsatRuleConfigEntry[]);
    expect(withLimit.status).toBe("OPTIMAL");
    const limitedAssignments = decodeAssignments(withLimit.values);
    expect(limitedAssignments.filter((a) => a.employeeId === "alice").length).toBeLessThanOrEqual(
      2,
    );
    expect(limitedAssignments.filter((a) => a.employeeId === "bob").length).toBeGreaterThanOrEqual(
      1,
    );
  }, 30_000);
});
