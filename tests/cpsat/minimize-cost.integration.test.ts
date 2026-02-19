import { beforeAll, describe, expect, it } from "vitest";
import { createBaseConfig, decodeAssignments, getSolverClient } from "./helpers.js";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules/rules.types.js";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import { calculateScheduleCost, COST_CATEGORY } from "../../src/cpsat/cost.js";
import { parseSolverResponse } from "../../src/cpsat/response.js";
import type { HttpSolverClient } from "../../src/client.js";

describe("CP-SAT: minimize-cost rule", () => {
  let client: HttpSolverClient;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("prefers cheaper hourly member when coverage allows", async () => {
    const config = createBaseConfig({
      members: [
        { id: "expensive", roles: ["waiter"], pay: { hourlyRate: 3000 } },
        { id: "cheap", roles: ["waiter"], pay: { hourlyRate: 1000 } },
      ],
      shift: { id: "day", startTime: { hours: 9, minutes: 0 }, endTime: { hours: 17, minutes: 0 } },
      targetCount: 1,
    });

    const builder = new ModelBuilder({
      ...config,
      ruleConfigs: [{ name: "minimize-cost" } as CpsatRuleConfigEntry],
    });
    const { request } = builder.compile();
    const response = await client.solve(request);
    expect(response.status).toBe("OPTIMAL");

    const assignments = decodeAssignments(response.values);
    const cheapAssignments = assignments.filter((a) => a.memberId === "cheap");
    const expensiveAssignments = assignments.filter((a) => a.memberId === "expensive");

    // Solver should prefer the cheaper member
    expect(cheapAssignments.length).toBeGreaterThan(0);
    expect(expensiveAssignments.length).toBe(0);
  }, 30_000);

  it("assigns both members when coverage requires it", async () => {
    const config = createBaseConfig({
      members: [
        { id: "expensive", roles: ["waiter"], pay: { hourlyRate: 3000 } },
        { id: "cheap", roles: ["waiter"], pay: { hourlyRate: 1000 } },
      ],
      shift: { id: "day", startTime: { hours: 9, minutes: 0 }, endTime: { hours: 17, minutes: 0 } },
      targetCount: 2,
    });

    const builder = new ModelBuilder({
      ...config,
      ruleConfigs: [{ name: "minimize-cost" } as CpsatRuleConfigEntry],
    });
    const { request } = builder.compile();
    const response = await client.solve(request);
    expect(response.status).toBe("OPTIMAL");

    const assignments = decodeAssignments(response.values);
    const cheapAssigned = assignments.some((a) => a.memberId === "cheap");
    const expensiveAssigned = assignments.some((a) => a.memberId === "expensive");

    expect(cheapAssigned).toBe(true);
    expect(expensiveAssigned).toBe(true);
  }, 30_000);

  it("post-solve cost calculation matches expectations", async () => {
    const config = createBaseConfig({
      members: [
        { id: "alice", roles: ["waiter"], pay: { hourlyRate: 2000 } },
        { id: "bob", roles: ["waiter"], pay: { hourlyRate: 1500 } },
      ],
      shift: { id: "day", startTime: { hours: 9, minutes: 0 }, endTime: { hours: 17, minutes: 0 } },
      targetCount: 1,
    });

    const builder = new ModelBuilder({
      ...config,
      ruleConfigs: [{ name: "minimize-cost" } as CpsatRuleConfigEntry],
    });
    const { request } = builder.compile();
    const response = await client.solve(request);
    expect(response.status).toBe("OPTIMAL");

    const result = parseSolverResponse(response);
    const cost = calculateScheduleCost(result.assignments, {
      members: config.members,
      shiftPatterns: config.shiftPatterns,
      rules: builder.rules,
    });

    // Solver should prefer bob (cheaper). 1 day, 8 hours, 1500/hr = 12000
    expect(cost.total).toBe(12000);
    expect(cost.byMember.get("bob")?.categories.get(COST_CATEGORY.BASE)).toBe(12000);
    expect(cost.byMember.get("bob")?.totalHours).toBe(8);
  }, 30_000);
});
