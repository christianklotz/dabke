import { describe, it, expect, beforeAll } from "vitest";
import { defineSchedule, t, time, cover, shift, weekdays, weekend } from "../../src/schedule.js";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import { getSolverClient, decodeAssignments } from "./helpers.js";

/**
 * Integration tests for variant coverage requirements.
 *
 * Variant coverage uses most-specific-wins resolution (dates > dayOfWeek > default)
 * so a single cover() call can express different staffing levels for different days,
 * including decreasing below the default on specific dates.
 */
describe("Variant coverage (integration)", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  describe("decrease from default", () => {
    it("reduces staffing on a specific date below the default", async () => {
      // Scenario: normally need 3 waiters, but only 1 on a specific date.
      // This is the key scenario that simple cover() cannot express.
      const schedule = defineSchedule({
        roleIds: ["waiter"] as const,
        times: { dinner: time({ startTime: t(17), endTime: t(22) }) },
        coverage: [cover("dinner", "waiter", { count: 3 }, { count: 1, dates: ["2025-02-05"] })],
        shiftPatterns: [shift("evening", t(17), t(22))],
      });

      const config = schedule.createSchedulerConfig({
        schedulingPeriod: { dateRange: { start: "2025-02-04", end: "2025-02-06" } },
        members: [
          { id: "alice", roleIds: ["waiter"] },
          { id: "bob", roleIds: ["waiter"] },
          { id: "charlie", roleIds: ["waiter"] },
        ],
      });

      const builder = new ModelBuilder(config);
      const { request, canSolve } = builder.compile();
      expect(canSolve).toBe(true);

      const response = await client.solve(request);
      expect(response.status).toBe("OPTIMAL");

      const assignments = decodeAssignments(response.values);

      // Feb 4 (default): 3 waiters
      const feb4 = assignments.filter((a) => a.day === "2025-02-04");
      expect(feb4).toHaveLength(3);

      // Feb 5 (override): exactly 1 waiter
      const feb5 = assignments.filter((a) => a.day === "2025-02-05");
      expect(feb5).toHaveLength(1);

      // Feb 6 (default): 3 waiters
      const feb6 = assignments.filter((a) => a.day === "2025-02-06");
      expect(feb6).toHaveLength(3);
    }, 30_000);
  });

  describe("increase from default", () => {
    it("increases staffing on a specific date above the default", async () => {
      // Scenario: normally need 2 waiters, but 4 on New Year's Eve.
      const schedule = defineSchedule({
        roleIds: ["waiter"] as const,
        times: { dinner: time({ startTime: t(17), endTime: t(22) }) },
        coverage: [cover("dinner", "waiter", { count: 2 }, { count: 4, dates: ["2025-02-05"] })],
        shiftPatterns: [shift("evening", t(17), t(22))],
      });

      const config = schedule.createSchedulerConfig({
        schedulingPeriod: { dateRange: { start: "2025-02-04", end: "2025-02-06" } },
        members: [
          { id: "alice", roleIds: ["waiter"] },
          { id: "bob", roleIds: ["waiter"] },
          { id: "charlie", roleIds: ["waiter"] },
          { id: "diana", roleIds: ["waiter"] },
        ],
      });

      const builder = new ModelBuilder(config);
      const { request, canSolve } = builder.compile();
      expect(canSolve).toBe(true);

      const response = await client.solve(request);
      expect(response.status).toBe("OPTIMAL");

      const assignments = decodeAssignments(response.values);

      // Feb 4 (default): 2 waiters
      const feb4 = assignments.filter((a) => a.day === "2025-02-04");
      expect(feb4).toHaveLength(2);

      // Feb 5 (override): 4 waiters
      const feb5 = assignments.filter((a) => a.day === "2025-02-05");
      expect(feb5).toHaveLength(4);

      // Feb 6 (default): 2 waiters
      const feb6 = assignments.filter((a) => a.day === "2025-02-06");
      expect(feb6).toHaveLength(2);
    }, 30_000);
  });

  describe("weekday vs weekend with holiday override", () => {
    it("applies three-tier variant: weekday, weekend, specific date", async () => {
      // Scenario: 2 on weekdays, 4 on weekends, 6 on a specific Saturday
      const schedule = defineSchedule({
        roleIds: ["waiter"] as const,
        times: { dinner: time({ startTime: t(17), endTime: t(22) }) },
        coverage: [
          cover(
            "dinner",
            "waiter",
            { count: 2, dayOfWeek: weekdays },
            { count: 4, dayOfWeek: weekend },
            { count: 6, dates: ["2025-02-08"] },
          ),
        ],
        shiftPatterns: [shift("evening", t(17), t(22))],
      });

      const config = schedule.createSchedulerConfig({
        // 2025-02-07 Fri, 2025-02-08 Sat, 2025-02-09 Sun
        schedulingPeriod: { dateRange: { start: "2025-02-07", end: "2025-02-09" } },
        members: [
          { id: "a", roleIds: ["waiter"] },
          { id: "b", roleIds: ["waiter"] },
          { id: "c", roleIds: ["waiter"] },
          { id: "d", roleIds: ["waiter"] },
          { id: "e", roleIds: ["waiter"] },
          { id: "f", roleIds: ["waiter"] },
        ],
      });

      const builder = new ModelBuilder(config);
      const { request, canSolve } = builder.compile();
      expect(canSolve).toBe(true);

      const response = await client.solve(request);
      expect(response.status).toBe("OPTIMAL");

      const assignments = decodeAssignments(response.values);

      // Friday (weekday): 2
      const fri = assignments.filter((a) => a.day === "2025-02-07");
      expect(fri).toHaveLength(2);

      // Saturday (date override beats dayOfWeek): 6
      const sat = assignments.filter((a) => a.day === "2025-02-08");
      expect(sat).toHaveLength(6);

      // Sunday (weekend): 4
      const sun = assignments.filter((a) => a.day === "2025-02-09");
      expect(sun).toHaveLength(4);
    }, 30_000);
  });

  describe("no default variant", () => {
    it("only emits coverage for days matching a scoped variant", async () => {
      // Scenario: coverage only on weekends, nothing on weekdays
      const schedule = defineSchedule({
        roleIds: ["waiter"] as const,
        times: { brunch: time({ startTime: t(10), endTime: t(14) }) },
        coverage: [cover("brunch", "waiter", { count: 2, dayOfWeek: weekend })],
        shiftPatterns: [shift("brunch_shift", t(10), t(14))],
      });

      const config = schedule.createSchedulerConfig({
        // 2025-02-07 Fri, 2025-02-08 Sat, 2025-02-09 Sun
        schedulingPeriod: { dateRange: { start: "2025-02-07", end: "2025-02-09" } },
        members: [
          { id: "alice", roleIds: ["waiter"] },
          { id: "bob", roleIds: ["waiter"] },
        ],
      });

      const builder = new ModelBuilder(config);
      const { request, canSolve } = builder.compile();
      expect(canSolve).toBe(true);

      const response = await client.solve(request);
      expect(response.status).toBe("OPTIMAL");

      const assignments = decodeAssignments(response.values);

      // Friday: no coverage, no assignments
      const fri = assignments.filter((a) => a.day === "2025-02-07");
      expect(fri).toHaveLength(0);

      // Saturday and Sunday: 2 each
      const sat = assignments.filter((a) => a.day === "2025-02-08");
      const sun = assignments.filter((a) => a.day === "2025-02-09");
      expect(sat).toHaveLength(2);
      expect(sun).toHaveLength(2);
    }, 30_000);
  });

  describe("mixed variant and simple coverage", () => {
    it("variant and simple cover for different roles compose independently", async () => {
      // Waiter coverage varies by day (variant form)
      // Manager coverage is constant (simple form)
      const schedule = defineSchedule({
        roleIds: ["waiter", "manager"] as const,
        times: { dinner: time({ startTime: t(17), endTime: t(22) }) },
        coverage: [
          cover("dinner", "waiter", { count: 2 }, { count: 1, dates: ["2025-02-05"] }),
          cover("dinner", "manager", 1),
        ],
        shiftPatterns: [shift("evening", t(17), t(22))],
      });

      const config = schedule.createSchedulerConfig({
        schedulingPeriod: { dateRange: { start: "2025-02-04", end: "2025-02-06" } },
        members: [
          { id: "alice", roleIds: ["waiter"] },
          { id: "bob", roleIds: ["waiter"] },
          { id: "charlie", roleIds: ["manager"] },
        ],
      });

      const builder = new ModelBuilder(config);
      const { request, canSolve } = builder.compile();
      expect(canSolve).toBe(true);

      const response = await client.solve(request);
      expect(response.status).toBe("OPTIMAL");

      const assignments = decodeAssignments(response.values);

      // Feb 4: 2 waiters + 1 manager = 3
      const feb4 = assignments.filter((a) => a.day === "2025-02-04");
      expect(feb4).toHaveLength(3);

      // Feb 5: 1 waiter (decreased) + 1 manager = 2
      const feb5 = assignments.filter((a) => a.day === "2025-02-05");
      expect(feb5).toHaveLength(2);
      expect(feb5.filter((a) => a.memberId === "charlie")).toHaveLength(1);

      // Feb 6: 2 waiters + 1 manager = 3
      const feb6 = assignments.filter((a) => a.day === "2025-02-06");
      expect(feb6).toHaveLength(3);
    }, 30_000);
  });

  describe("variant with semantic time variants", () => {
    it("combines time variants with coverage variants", async () => {
      // Dinner starts later on weekends AND needs more staff
      const schedule = defineSchedule({
        roleIds: ["waiter"] as const,
        times: {
          dinner: time(
            { startTime: t(17), endTime: t(22) },
            { startTime: t(18), endTime: t(23), dayOfWeek: weekend },
          ),
        },
        coverage: [cover("dinner", "waiter", { count: 1 }, { count: 2, dayOfWeek: weekend })],
        shiftPatterns: [
          shift("evening_wd", t(17), t(22), { dayOfWeek: [...weekdays] }),
          shift("evening_we", t(18), t(23), { dayOfWeek: [...weekend] }),
        ],
      });

      const config = schedule.createSchedulerConfig({
        // 2025-02-07 Fri, 2025-02-08 Sat
        schedulingPeriod: { dateRange: { start: "2025-02-07", end: "2025-02-08" } },
        members: [
          { id: "alice", roleIds: ["waiter"] },
          { id: "bob", roleIds: ["waiter"] },
        ],
      });

      const builder = new ModelBuilder(config);
      const { request, canSolve } = builder.compile();
      expect(canSolve).toBe(true);

      const response = await client.solve(request);
      expect(response.status).toBe("OPTIMAL");

      const assignments = decodeAssignments(response.values);

      // Friday: 1 waiter
      const fri = assignments.filter((a) => a.day === "2025-02-07");
      expect(fri).toHaveLength(1);

      // Saturday: 2 waiters
      const sat = assignments.filter((a) => a.day === "2025-02-08");
      expect(sat).toHaveLength(2);
    }, 30_000);
  });
});
