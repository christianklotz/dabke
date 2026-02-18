import { beforeAll, describe, expect, it } from "vitest";
import { getSolverClient } from "./helpers.js";
import {
  defineSchedule,
  t,
  time,
  cover,
  shift,
  minimizeCost,
  dayMultiplier,
  daySurcharge,
  timeSurcharge,
  weekend,
  ModelBuilder,
  parseSolverResponse,
  calculateScheduleCost,
  COST_CATEGORY,
} from "../../src/index.js";
import type { HttpSolverClient } from "../../src/client.js";

describe("CP-SAT: end-to-end cost calculation", () => {
  let client: HttpSolverClient;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("full v2 API cost flow with multiple rules", async () => {
    const restaurant = defineSchedule({
      roles: ["waiter"],
      times: {
        lunch: time({ start: t(12), end: t(15) }),
      },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("lunch_shift", t(12), t(15))],
      rules: [
        minimizeCost(),
        dayMultiplier(1.5, { dayOfWeek: weekend }),
        daySurcharge(100, { dayOfWeek: weekend }),
      ],
    });

    // Feb 14 2026 = Saturday
    const config = restaurant.createSchedulerConfig({
      schedulingPeriod: { dateRange: { start: "2026-02-14", end: "2026-02-14" } },
      members: [{ id: "alice", roles: ["waiter"], pay: { hourlyRate: 2000 } }],
    });

    const builder = new ModelBuilder(config);
    const { request, canSolve } = builder.compile();
    expect(canSolve).toBe(true);

    const response = await client.solve(request);
    expect(response.status).toBe("OPTIMAL");

    const result = parseSolverResponse(response);
    expect(result.assignments).toHaveLength(1);

    const cost = calculateScheduleCost(result.assignments, {
      employees: config.employees,
      shiftPatterns: config.shiftPatterns,
      rules: builder.rules,
    });

    // 3 hours at 2000/hr = 6000 base
    // 3 hours * 2000 * 0.5 = 3000 multiplier premium
    // 3 hours * 100 = 300 surcharge premium
    const alice = cost.byEmployee.get("alice")!;
    expect(alice.categories.get(COST_CATEGORY.BASE)).toBe(6000);
    expect(alice.categories.get(COST_CATEGORY.PREMIUM)).toBe(3300);
    expect(cost.total).toBe(9300);
    expect(cost.byDay.get("2026-02-14")).toBe(9300);
  }, 30_000);

  it("solver prefers cheaper employee with cost optimization", async () => {
    const shop = defineSchedule({
      roles: ["clerk"],
      times: {
        shift: time({ start: t(9), end: t(17) }),
      },
      coverage: [cover("shift", "clerk", 1)],
      shiftPatterns: [shift("day", t(9), t(17))],
      rules: [minimizeCost()],
    });

    const config = shop.createSchedulerConfig({
      schedulingPeriod: { dateRange: { start: "2026-02-09", end: "2026-02-09" } },
      members: [
        { id: "expensive", roles: ["clerk"], pay: { hourlyRate: 5000 } },
        { id: "cheap", roles: ["clerk"], pay: { hourlyRate: 1500 } },
      ],
    });

    const builder = new ModelBuilder(config);
    const { request } = builder.compile();
    const response = await client.solve(request);
    expect(response.status).toBe("OPTIMAL");

    const result = parseSolverResponse(response);
    const assignedEmployees = result.assignments.map((a) => a.employeeId);
    expect(assignedEmployees).toContain("cheap");
    expect(assignedEmployees).not.toContain("expensive");

    const cost = calculateScheduleCost(result.assignments, {
      employees: config.employees,
      shiftPatterns: config.shiftPatterns,
      rules: builder.rules,
    });

    // 8 hours * 1500 = 12000
    expect(cost.total).toBe(12000);
  }, 30_000);

  it("timeSurcharge affects cost correctly for night shift", async () => {
    const bar = defineSchedule({
      roles: ["bartender"],
      times: {
        night: time({ start: t(20), end: t(23) }),
      },
      coverage: [cover("night", "bartender", 1)],
      shiftPatterns: [shift("evening", t(20), t(23))],
      rules: [minimizeCost(), timeSurcharge(500, { from: t(22), until: t(6) })],
    });

    const config = bar.createSchedulerConfig({
      schedulingPeriod: { dateRange: { start: "2026-02-09", end: "2026-02-09" } },
      members: [{ id: "mike", roles: ["bartender"], pay: { hourlyRate: 2000 } }],
    });

    const builder = new ModelBuilder(config);
    const { request } = builder.compile();
    const response = await client.solve(request);
    expect(response.status).toBe("OPTIMAL");

    const result = parseSolverResponse(response);
    const cost = calculateScheduleCost(result.assignments, {
      employees: config.employees,
      shiftPatterns: config.shiftPatterns,
      rules: builder.rules,
    });

    // Base: 3 * 2000 = 6000
    // Night surcharge: 1 hour (22:00-23:00) * 500 = 500
    const mike = cost.byEmployee.get("mike")!;
    expect(mike.categories.get(COST_CATEGORY.BASE)).toBe(6000);
    expect(mike.categories.get(COST_CATEGORY.PREMIUM)).toBe(500);
    expect(cost.total).toBe(6500);
  }, 30_000);
});
