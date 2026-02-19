import { beforeAll, describe, expect, it } from "vitest";
import { createBaseConfig, decodeAssignments, getSolverClient } from "./helpers.js";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules/rules.types.js";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import { calculateScheduleCost, COST_CATEGORY } from "../../src/cpsat/cost.js";
import { parseSolverResponse } from "../../src/cpsat/response.js";
import type { HttpSolverClient } from "../../src/client.js";

describe("CP-SAT: overtime rules", () => {
  let client: HttpSolverClient;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("weekly overtime multiplier: solver avoids overtime when cheaper option exists", async () => {
    // 5-day week, 8h shifts, 2 members, need 1 per day.
    // With overtime after 24h at 1.5x, solver should spread work to avoid overtime.
    const config = createBaseConfig({
      members: [
        { id: "alice", roles: ["worker"], pay: { hourlyRate: 2000 } },
        { id: "bob", roles: ["worker"], pay: { hourlyRate: 2000 } },
      ],
      shift: { id: "day", startTime: { hours: 9, minutes: 0 }, endTime: { hours: 17, minutes: 0 } },
      schedulingPeriod: {
        dateRange: { start: "2026-02-09", end: "2026-02-13" },
        dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      },
      targetCount: 1,
    });

    const builder = new ModelBuilder({
      ...config,
      ruleConfigs: [
        { name: "minimize-cost" } as CpsatRuleConfigEntry,
        { name: "overtime-weekly-multiplier", after: 24, factor: 1.5 } as CpsatRuleConfigEntry,
      ],
    });
    const { request } = builder.compile();
    const response = await client.solve(request);
    expect(response.status).toBe("OPTIMAL");

    const assignments = decodeAssignments(response.values);
    // Each member should get ~2-3 days to stay under 24h threshold
    const aliceCount = assignments.filter((a) => a.memberId === "alice").length;
    const bobCount = assignments.filter((a) => a.memberId === "bob").length;
    expect(aliceCount).toBeGreaterThan(0);
    expect(bobCount).toBeGreaterThan(0);
    // Neither should have more than 3 days (24h threshold = 3 x 8h days)
    expect(aliceCount).toBeLessThanOrEqual(3);
    expect(bobCount).toBeLessThanOrEqual(3);
  }, 30_000);

  it("weekly overtime multiplier: post-solve cost includes overtime", async () => {
    // Force a single member to work all 5 days = 40h, overtime after 24h
    const config = createBaseConfig({
      members: [{ id: "alice", roles: ["worker"], pay: { hourlyRate: 2000 } }],
      shift: { id: "day", startTime: { hours: 9, minutes: 0 }, endTime: { hours: 17, minutes: 0 } },
      schedulingPeriod: {
        dateRange: { start: "2026-02-09", end: "2026-02-13" },
        dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      },
      targetCount: 1,
    });

    const builder = new ModelBuilder({
      ...config,
      ruleConfigs: [
        { name: "minimize-cost" } as CpsatRuleConfigEntry,
        { name: "overtime-weekly-multiplier", after: 24, factor: 1.5 } as CpsatRuleConfigEntry,
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

    // 40h base: 40 * 2000 = 80000
    // 16h overtime (40-24): 16 * 2000 * 0.5 = 16000
    const alice = cost.byMember.get("alice")!;
    expect(alice.categories.get(COST_CATEGORY.BASE)).toBe(80000);
    expect(alice.categories.get(COST_CATEGORY.OVERTIME)).toBe(16000);
    expect(cost.total).toBe(96000);
  }, 30_000);

  it("weekly overtime surcharge: post-solve cost includes flat surcharge", async () => {
    const config = createBaseConfig({
      members: [{ id: "alice", roles: ["worker"], pay: { hourlyRate: 2000 } }],
      shift: { id: "day", startTime: { hours: 9, minutes: 0 }, endTime: { hours: 17, minutes: 0 } },
      schedulingPeriod: {
        dateRange: { start: "2026-02-09", end: "2026-02-13" },
        dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      },
      targetCount: 1,
    });

    const builder = new ModelBuilder({
      ...config,
      ruleConfigs: [
        { name: "minimize-cost" } as CpsatRuleConfigEntry,
        { name: "overtime-weekly-surcharge", after: 24, amount: 500 } as CpsatRuleConfigEntry,
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

    // 40h base: 80000
    // 16h overtime surcharge: 16 * 500 = 8000
    const alice = cost.byMember.get("alice")!;
    expect(alice.categories.get(COST_CATEGORY.BASE)).toBe(80000);
    expect(alice.categories.get(COST_CATEGORY.OVERTIME)).toBe(8000);
    expect(cost.total).toBe(88000);
  }, 30_000);

  it("tiered overtime multiplier: correct cost across tiers", async () => {
    const config = createBaseConfig({
      members: [{ id: "alice", roles: ["worker"], pay: { hourlyRate: 2000 } }],
      shift: { id: "day", startTime: { hours: 9, minutes: 0 }, endTime: { hours: 17, minutes: 0 } },
      schedulingPeriod: {
        dateRange: { start: "2026-02-09", end: "2026-02-13" },
        dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      },
      targetCount: 1,
    });

    const builder = new ModelBuilder({
      ...config,
      ruleConfigs: [
        { name: "minimize-cost" } as CpsatRuleConfigEntry,
        {
          name: "overtime-tiered-multiplier",
          tiers: [
            { after: 16, factor: 1.5 },
            { after: 32, factor: 2.0 },
          ],
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

    // 40h total, base: 80000
    // Tier 1 (16-32h): 16h * 2000 * 0.5 = 16000
    // Tier 2 (32-40h): 8h * 2000 * 1.0 = 16000
    const alice = cost.byMember.get("alice")!;
    expect(alice.categories.get(COST_CATEGORY.BASE)).toBe(80000);
    expect(alice.categories.get(COST_CATEGORY.OVERTIME)).toBe(32000);
    expect(cost.total).toBe(112000);
  }, 30_000);
});

describe("CP-SAT: salaried members", () => {
  let client: HttpSolverClient;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("solver prefers salaried member over hourly when both available", async () => {
    // Salaried costs 5200000/52 = 100000/week regardless of hours.
    // Hourly at 3000/hr * 8h * 5 days = 120000/week.
    // Solver should load work onto the salaried member (cheaper overall).
    const config = createBaseConfig({
      members: [
        { id: "hourly", roles: ["worker"], pay: { hourlyRate: 3000 } },
        { id: "salaried", roles: ["worker"], pay: { annual: 5200000, hoursPerWeek: 40 } },
      ],
      shift: { id: "day", startTime: { hours: 9, minutes: 0 }, endTime: { hours: 17, minutes: 0 } },
      schedulingPeriod: {
        dateRange: { start: "2026-02-09", end: "2026-02-13" },
        dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      },
      targetCount: 1,
    });

    const builder = new ModelBuilder({
      ...config,
      fairDistribution: false,
      ruleConfigs: [{ name: "minimize-cost" } as CpsatRuleConfigEntry],
    });
    const { request } = builder.compile();
    const response = await client.solve(request);
    expect(response.status).toBe("OPTIMAL");

    const assignments = decodeAssignments(response.values);
    const salariedCount = assignments.filter((a) => a.memberId === "salaried").length;
    const hourlyCount = assignments.filter((a) => a.memberId === "hourly").length;

    // Salaried member should get all or most shifts (they're "free" after activation)
    expect(salariedCount).toBeGreaterThanOrEqual(3);
    expect(hourlyCount).toBeLessThanOrEqual(2);
  }, 30_000);

  it("salaried member cost is weekly salary", async () => {
    const config = createBaseConfig({
      members: [{ id: "carol", roles: ["worker"], pay: { annual: 5200000, hoursPerWeek: 40 } }],
      shift: { id: "day", startTime: { hours: 9, minutes: 0 }, endTime: { hours: 17, minutes: 0 } },
      schedulingPeriod: {
        dateRange: { start: "2026-02-09", end: "2026-02-11" },
        dayOfWeek: ["monday", "tuesday", "wednesday"],
      },
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

    // Weekly salary: 5200000 / 52 = 100000
    const carol = cost.byMember.get("carol")!;
    expect(carol.categories.get(COST_CATEGORY.BASE)).toBe(100000);
    expect(carol.totalCost).toBe(100000);
  }, 30_000);
});
