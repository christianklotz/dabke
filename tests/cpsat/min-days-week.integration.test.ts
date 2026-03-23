import { beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { createBaseConfig, decodeAssignments, solveWithRules, getSolverClient } from "./helpers.js";

describe("CP-SAT: min-days-week rule", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("adds shifts to meet weekly minimum days", async () => {
    const baseConfig = createBaseConfig({
      roleId: "barista",
      memberIds: ["alice"],
      shift: {
        id: "day",
        startTime: { hours: 8, minutes: 0 },
        endTime: { hours: 16, minutes: 0 },
      },
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-03" } },
      coverage: [
        {
          day: "2024-02-01",
          roleIds: ["barista"],
          startTime: { hours: 8, minutes: 0 },
          endTime: { hours: 16, minutes: 0 },
          targetCount: 1,
          priority: "MANDATORY" as const,
        },
      ],
    });

    // Without rule, only 1 day assigned (coverage requires only 1 day)
    const baseline = await solveWithRules(client, baseConfig, []);
    expect(baseline.status).toBe("OPTIMAL");
    const baselineAssignments = decodeAssignments(baseline.values);
    expect(baselineAssignments.length).toBe(1);

    // With min 2 days, solver must assign at least 2 days
    const withMinimum = await solveWithRules(client, { ...baseConfig, weekStartsOn: "thursday" }, [
      {
        name: "min-days-week",
        days: 2,
        priority: "MANDATORY",
      },
    ] satisfies CpsatRuleConfigEntry[]);
    expect(withMinimum.status).toBe("OPTIMAL");
    const minAssignments = decodeAssignments(withMinimum.values);
    expect(minAssignments.length).toBeGreaterThanOrEqual(2);
  }, 30_000);
});
