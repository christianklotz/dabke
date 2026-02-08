import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import {
  createBaseConfig,
  decodeAssignments,
  solveWithRules,
  startSolverContainer,
} from "./helpers.js";

describe("CP-SAT: min-hours-week rule", () => {
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

  it("adds shifts to meet weekly minimum minutes", async () => {
    const baseConfig = createBaseConfig({ roleId: "barista",
      employeeIds: ["alice"],
      shift: {
        id: "day",
        startTime: { hours: 8, minutes: 0 },
        endTime: { hours: 16, minutes: 0 },
      },
      schedulingPeriod: { specificDates: ["2024-02-01", "2024-02-02", "2024-02-03"] },
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
        config: {
          hours: 16,
          priority: "MANDATORY",
        },
      },
    ] satisfies CpsatRuleConfigEntry[]);
    expect(withMinimum.status).toBe("OPTIMAL");
    const minAssignments = decodeAssignments(withMinimum.values);
    expect(minAssignments.length).toBeGreaterThanOrEqual(2);
  }, 30_000);
});
