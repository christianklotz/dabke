import { beforeAll, describe, expect, it } from "vitest";
import { decodeAssignments, getSolverClient } from "./helpers.js";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules/rules.types.js";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import { parseSolverResponse } from "../../src/cpsat/response.js";
import { calculateScheduleCost, COST_CATEGORY } from "../../src/cpsat/cost.js";
import { resolveDaysFromPeriod } from "../../src/datetime.utils.js";
import type { HttpSolverClient } from "../../src/client.js";

describe("CP-SAT: day-cost-multiplier rule", () => {
  let client: HttpSolverClient;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("solver prefers weekday assignments to avoid weekend multiplier", async () => {
    // Mon-Sat schedule, need 1 person per day, only 1 member.
    // With weekend multiplier, the solver can't avoid Saturday
    // (must cover every day), but with 2 members and 1 coverage,
    // the solver should avoid assigning the more expensive combination.
    //
    // Setup: 2 members, 2 days (Fri + Sat), coverage of 1 per day.
    // With 1.5x weekend multiplier + fair distribution turned off,
    // solver should assign the cheaper member to Saturday.
    const period = {
      dateRange: { start: "2026-02-13", end: "2026-02-14" },
    };
    const days = resolveDaysFromPeriod(period);

    const config = {
      members: [
        { id: "expensive", roles: ["waiter"], pay: { hourlyRate: 3000 } },
        { id: "cheap", roles: ["waiter"], pay: { hourlyRate: 1000 } },
      ],
      shiftPatterns: [
        {
          id: "day",
          roleIds: ["waiter"] as [string, ...string[]],
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      ],
      schedulingPeriod: period,
      coverage: days.map((day) => ({
        day,
        roleIds: ["waiter"] as [string, ...string[]],
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
        targetCount: 1,
        priority: "MANDATORY" as const,
      })),
      fairDistribution: false,
    };

    const builder = new ModelBuilder({
      ...config,
      ruleConfigs: [
        { name: "minimize-cost" } as CpsatRuleConfigEntry,
        {
          name: "day-cost-multiplier",
          factor: 2.0,
          dayOfWeek: ["saturday"],
        } as CpsatRuleConfigEntry,
      ],
    });
    const { request } = builder.compile();
    const response = await client.solve(request);
    expect(response.status).toBe("OPTIMAL");

    const assignments = decodeAssignments(response.values);
    const satAssignment = assignments.find((a) => a.day === "2026-02-14");

    // Cheap member on Saturday to minimize cost
    expect(satAssignment?.memberId).toBe("cheap");
  }, 30_000);

  it("post-solve cost includes multiplier premium", async () => {
    const period = {
      dateRange: { start: "2026-02-14", end: "2026-02-14" },
    };
    const days = resolveDaysFromPeriod(period);

    const config = {
      members: [{ id: "alice", roles: ["waiter"], pay: { hourlyRate: 2000 } }],
      shiftPatterns: [
        {
          id: "day",
          roleIds: ["waiter"] as [string, ...string[]],
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      ],
      schedulingPeriod: period,
      coverage: days.map((day) => ({
        day,
        roleIds: ["waiter"] as [string, ...string[]],
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
        targetCount: 1,
        priority: "MANDATORY" as const,
      })),
    };

    const builder = new ModelBuilder({
      ...config,
      ruleConfigs: [
        { name: "minimize-cost" } as CpsatRuleConfigEntry,
        {
          name: "day-cost-multiplier",
          factor: 1.5,
          dayOfWeek: ["saturday"],
        } as CpsatRuleConfigEntry,
      ],
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

    // 8 hours * 2000 = 16000 base, 8 * 2000 * 0.5 = 8000 premium
    const alice = cost.byMember.get("alice")!;
    expect(alice.categories.get(COST_CATEGORY.BASE)).toBe(16000);
    expect(alice.categories.get(COST_CATEGORY.PREMIUM)).toBe(8000);
    expect(cost.total).toBe(24000);
  }, 30_000);
});
