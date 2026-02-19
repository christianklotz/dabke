import { beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { createBaseConfig, decodeAssignments, solveWithRules, getSolverClient } from "./helpers.js";

describe("CP-SAT: weekStartsOn inheritance", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("uses ModelBuilder.weekStartsOn when weekly rule omits weekStartsOn", async () => {
    // Restaurant-style week: Saturday -> Friday
    // Days span Fri+Sat, so whether Fri/Sat belong to the same "week" depends on weekStartsOn.
    //
    // With weekStartsOn = saturday:
    //   - Fri is the last day of the previous week
    //   - Sat starts a new week
    // So a per-week cap should limit Fri and Sat separately.

    const baseConfig = createBaseConfig({
      roles: ["server"],
      memberIds: ["alice"],
      shift: {
        id: "day",
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 }, // 8h
      },
      schedulingPeriod: { dateRange: { start: "2024-02-09", end: "2024-02-10" } }, // Fri, Sat
      targetCount: 1,
    });

    const rule: CpsatRuleConfigEntry[] = [
      {
        name: "max-hours-week",

        hours: 8,
        priority: "MANDATORY",
        // Intentionally omitted: weekStartsOn,
      },
    ];

    const baseline = await solveWithRules(client, baseConfig, []);
    expect(baseline.status).toBe("OPTIMAL");
    const baselineAssignments = decodeAssignments(baseline.values);
    expect(baselineAssignments).toHaveLength(2);

    const saturdayWeek = await solveWithRules(
      client,
      { ...baseConfig, weekStartsOn: "saturday" },
      rule,
    );

    expect(saturdayWeek.status).toBe("OPTIMAL");
    const saturdayAssignments = decodeAssignments(saturdayWeek.values);

    // With Saturday week-start, Fri and Sat are in different weeks -> both can be scheduled
    expect(saturdayAssignments).toHaveLength(2);

    const mondayWeek = await solveWithRules(
      client,
      { ...baseConfig, weekStartsOn: "monday" },
      rule,
    );

    // With Monday week-start, Fri+Sat belong to the same week, so 8h/week cap makes it infeasible
    expect(mondayWeek.status).toBe("INFEASIBLE");
  }, 30_000);
});
