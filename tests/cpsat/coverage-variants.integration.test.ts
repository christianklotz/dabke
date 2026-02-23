import { describe, it, expect, beforeAll } from "vitest";
import { schedule, t, time, cover, shift, weekdays, weekend } from "../../src/schedule.js";
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
      const s = schedule({
        roleIds: ["waiter"] as const,
        times: { dinner: time({ startTime: t(17), endTime: t(22) }) },
        coverage: [cover("dinner", "waiter", { count: 3 }, { count: 1, dates: ["2025-02-05"] })],
        shiftPatterns: [shift("evening", t(17), t(22))],
      });

      const compiled = s
        .with([
          { id: "alice", roleIds: ["waiter"] },
          { id: "bob", roleIds: ["waiter"] },
          { id: "charlie", roleIds: ["waiter"] },
        ])
        .compile({ dateRange: { start: "2025-02-04", end: "2025-02-06" } });

      expect(compiled.canSolve).toBe(true);

      const response = await client.solve(compiled.request);
      expect(response.status).toBe("OPTIMAL");

      const assignments = decodeAssignments(response.values);

      const feb4 = assignments.filter((a) => a.day === "2025-02-04");
      expect(feb4).toHaveLength(3);

      const feb5 = assignments.filter((a) => a.day === "2025-02-05");
      expect(feb5).toHaveLength(1);

      const feb6 = assignments.filter((a) => a.day === "2025-02-06");
      expect(feb6).toHaveLength(3);
    }, 30_000);
  });

  describe("increase from default", () => {
    it("increases staffing on a specific date above the default", async () => {
      const s = schedule({
        roleIds: ["waiter"] as const,
        times: { dinner: time({ startTime: t(17), endTime: t(22) }) },
        coverage: [cover("dinner", "waiter", { count: 2 }, { count: 4, dates: ["2025-02-05"] })],
        shiftPatterns: [shift("evening", t(17), t(22))],
      });

      const compiled = s
        .with([
          { id: "alice", roleIds: ["waiter"] },
          { id: "bob", roleIds: ["waiter"] },
          { id: "charlie", roleIds: ["waiter"] },
          { id: "diana", roleIds: ["waiter"] },
        ])
        .compile({ dateRange: { start: "2025-02-04", end: "2025-02-06" } });

      expect(compiled.canSolve).toBe(true);

      const response = await client.solve(compiled.request);
      expect(response.status).toBe("OPTIMAL");

      const assignments = decodeAssignments(response.values);

      const feb4 = assignments.filter((a) => a.day === "2025-02-04");
      expect(feb4).toHaveLength(2);

      const feb5 = assignments.filter((a) => a.day === "2025-02-05");
      expect(feb5).toHaveLength(4);

      const feb6 = assignments.filter((a) => a.day === "2025-02-06");
      expect(feb6).toHaveLength(2);
    }, 30_000);
  });

  describe("weekday vs weekend with holiday override", () => {
    it("applies three-tier variant: weekday, weekend, specific date", async () => {
      const s = schedule({
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

      const compiled = s
        .with([
          { id: "a", roleIds: ["waiter"] },
          { id: "b", roleIds: ["waiter"] },
          { id: "c", roleIds: ["waiter"] },
          { id: "d", roleIds: ["waiter"] },
          { id: "e", roleIds: ["waiter"] },
          { id: "f", roleIds: ["waiter"] },
        ])
        .compile({ dateRange: { start: "2025-02-07", end: "2025-02-09" } });

      expect(compiled.canSolve).toBe(true);

      const response = await client.solve(compiled.request);
      expect(response.status).toBe("OPTIMAL");

      const assignments = decodeAssignments(response.values);

      const fri = assignments.filter((a) => a.day === "2025-02-07");
      expect(fri).toHaveLength(2);

      const sat = assignments.filter((a) => a.day === "2025-02-08");
      expect(sat).toHaveLength(6);

      const sun = assignments.filter((a) => a.day === "2025-02-09");
      expect(sun).toHaveLength(4);
    }, 30_000);
  });

  describe("no default variant", () => {
    it("only emits coverage for days matching a scoped variant", async () => {
      const s = schedule({
        roleIds: ["waiter"] as const,
        times: { brunch: time({ startTime: t(10), endTime: t(14) }) },
        coverage: [cover("brunch", "waiter", { count: 2, dayOfWeek: weekend })],
        shiftPatterns: [shift("brunch_shift", t(10), t(14))],
      });

      const compiled = s
        .with([
          { id: "alice", roleIds: ["waiter"] },
          { id: "bob", roleIds: ["waiter"] },
        ])
        .compile({ dateRange: { start: "2025-02-07", end: "2025-02-09" } });

      expect(compiled.canSolve).toBe(true);

      const response = await client.solve(compiled.request);
      expect(response.status).toBe("OPTIMAL");

      const assignments = decodeAssignments(response.values);

      const fri = assignments.filter((a) => a.day === "2025-02-07");
      expect(fri).toHaveLength(0);

      const sat = assignments.filter((a) => a.day === "2025-02-08");
      const sun = assignments.filter((a) => a.day === "2025-02-09");
      expect(sat).toHaveLength(2);
      expect(sun).toHaveLength(2);
    }, 30_000);
  });

  describe("mixed variant and simple coverage", () => {
    it("variant and simple cover for different roles compose independently", async () => {
      const s = schedule({
        roleIds: ["waiter", "manager"] as const,
        times: { dinner: time({ startTime: t(17), endTime: t(22) }) },
        coverage: [
          cover("dinner", "waiter", { count: 2 }, { count: 1, dates: ["2025-02-05"] }),
          cover("dinner", "manager", 1),
        ],
        shiftPatterns: [shift("evening", t(17), t(22))],
      });

      const compiled = s
        .with([
          { id: "alice", roleIds: ["waiter"] },
          { id: "bob", roleIds: ["waiter"] },
          { id: "charlie", roleIds: ["manager"] },
        ])
        .compile({ dateRange: { start: "2025-02-04", end: "2025-02-06" } });

      expect(compiled.canSolve).toBe(true);

      const response = await client.solve(compiled.request);
      expect(response.status).toBe("OPTIMAL");

      const assignments = decodeAssignments(response.values);

      const feb4 = assignments.filter((a) => a.day === "2025-02-04");
      expect(feb4).toHaveLength(3);

      const feb5 = assignments.filter((a) => a.day === "2025-02-05");
      expect(feb5).toHaveLength(2);
      expect(feb5.filter((a) => a.memberId === "charlie")).toHaveLength(1);

      const feb6 = assignments.filter((a) => a.day === "2025-02-06");
      expect(feb6).toHaveLength(3);
    }, 30_000);
  });

  describe("variant with semantic time variants", () => {
    it("combines time variants with coverage variants", async () => {
      const s = schedule({
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

      const compiled = s
        .with([
          { id: "alice", roleIds: ["waiter"] },
          { id: "bob", roleIds: ["waiter"] },
        ])
        .compile({ dateRange: { start: "2025-02-07", end: "2025-02-08" } });

      expect(compiled.canSolve).toBe(true);

      const response = await client.solve(compiled.request);
      expect(response.status).toBe("OPTIMAL");

      const assignments = decodeAssignments(response.values);

      const fri = assignments.filter((a) => a.day === "2025-02-07");
      expect(fri).toHaveLength(1);

      const sat = assignments.filter((a) => a.day === "2025-02-08");
      expect(sat).toHaveLength(2);
    }, 30_000);
  });
});
