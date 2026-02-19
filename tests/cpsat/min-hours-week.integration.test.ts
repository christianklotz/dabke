import { beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { createBaseConfig, decodeAssignments, solveWithRules, getSolverClient } from "./helpers.js";

describe("CP-SAT: min-hours-week rule", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("adds shifts to meet weekly minimum minutes", async () => {
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

    const baseline = await solveWithRules(client, baseConfig, []);
    expect(baseline.status).toBe("OPTIMAL");
    const baselineAssignments = decodeAssignments(baseline.values);
    expect(baselineAssignments.length).toBe(1);

    const withMinimum = await solveWithRules(client, { ...baseConfig, weekStartsOn: "thursday" }, [
      {
        name: "min-hours-week",

        hours: 16,
        priority: "MANDATORY",
      },
    ] satisfies CpsatRuleConfigEntry[]);
    expect(withMinimum.status).toBe("OPTIMAL");
    const minAssignments = decodeAssignments(withMinimum.values);
    expect(minAssignments.length).toBeGreaterThanOrEqual(2);
  }, 30_000);
});
