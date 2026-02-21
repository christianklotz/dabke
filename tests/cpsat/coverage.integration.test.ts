import { describe, it, expect, beforeAll } from "vitest";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import { getSolverClient, decodeAssignments } from "./helpers.js";

/**
 * Integration tests for coverage requirements.
 *
 * Coverage requirements define staffing needs for specific time periods.
 * They can be specified by role, skills, or both.
 */
describe("Coverage requirements (integration)", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  describe("Overlapping coverage", () => {
    it("handles overlapping coverage periods for same role", async () => {
      // Scenario: Dinner (5pm-10pm) needs 2 bar staff
      //           Happy hour (5pm-6pm) needs 2 bar staff
      // During 5-6pm overlap: should need max(2,2) = 2 (not 4)
      const builder = new ModelBuilder({
        members: [
          { id: "bar1", roleIds: ["bar"] },
          { id: "bar2", roleIds: ["bar"] },
          { id: "bar3", roleIds: ["bar"] },
        ],
        shiftPatterns: [
          {
            id: "evening",
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 22, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            roleIds: ["bar"],
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 22, minutes: 0 },
            targetCount: 2,
            priority: "MANDATORY",
          },
          {
            day: "2024-01-01",
            roleIds: ["bar"],
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 18, minutes: 0 },
            targetCount: 2,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      expect(assignments.length).toBeGreaterThanOrEqual(2);
    }, 30_000);

    it("handles overlapping coverage for different roles", async () => {
      const builder = new ModelBuilder({
        members: [
          { id: "waiter1", roleIds: ["waiter"] },
          { id: "waiter2", roleIds: ["waiter"] },
          { id: "bar1", roleIds: ["bar"] },
        ],
        shiftPatterns: [
          {
            id: "evening",
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 22, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            roleIds: ["waiter"],
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 22, minutes: 0 },
            targetCount: 2,
            priority: "MANDATORY",
          },
          {
            day: "2024-01-01",
            roleIds: ["bar"],
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 22, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      expect(assignments).toHaveLength(3);

      const waiterAssignments = assignments.filter((a) => a?.memberId?.startsWith("waiter"));
      const barAssignments = assignments.filter((a) => a?.memberId?.startsWith("bar"));

      expect(waiterAssignments).toHaveLength(2);
      expect(barAssignments).toHaveLength(1);
    }, 30_000);

    it("handles adjacent non-overlapping coverage periods", async () => {
      const builder = new ModelBuilder({
        members: [
          { id: "waiter1", roleIds: ["waiter"], skillIds: ["can_close"] },
          { id: "waiter2", roleIds: ["waiter"] },
        ],
        shiftPatterns: [
          {
            id: "evening",
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 23, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            roleIds: ["waiter"],
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 22, minutes: 0 },
            targetCount: 2,
            priority: "MANDATORY",
          },
          {
            day: "2024-01-01",
            roleIds: ["waiter"],
            skillIds: ["can_close"],
            startTime: { hours: 22, minutes: 0 },
            endTime: { hours: 23, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      expect(assignments).toHaveLength(2);
    }, 30_000);

    it("handles staggered overlapping shifts", async () => {
      const builder = new ModelBuilder({
        members: [
          { id: "emp1", roleIds: ["waiter"] },
          { id: "emp2", roleIds: ["waiter"] },
          { id: "emp3", roleIds: ["waiter"] },
        ],
        shiftPatterns: [
          {
            id: "early",
            startTime: { hours: 7, minutes: 30 },
            endTime: { hours: 17, minutes: 30 },
          },
          {
            id: "mid",
            startTime: { hours: 10, minutes: 0 },
            endTime: { hours: 20, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            roleIds: ["waiter"],
            startTime: { hours: 7, minutes: 30 },
            endTime: { hours: 10, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-01-01",
            roleIds: ["waiter"],
            startTime: { hours: 10, minutes: 0 },
            endTime: { hours: 16, minutes: 0 },
            targetCount: 2,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      expect(assignments.length).toBeGreaterThanOrEqual(2);
    }, 30_000);

    it("handles fully contained coverage period", async () => {
      const builder = new ModelBuilder({
        members: [
          { id: "emp1", roleIds: ["waiter"] },
          { id: "emp2", roleIds: ["waiter"] },
          { id: "emp3", roleIds: ["waiter"] },
        ],
        shiftPatterns: [
          {
            id: "full",
            startTime: { hours: 8, minutes: 0 },
            endTime: { hours: 20, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            roleIds: ["waiter"],
            startTime: { hours: 8, minutes: 0 },
            endTime: { hours: 20, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-01-01",
            roleIds: ["waiter"],
            startTime: { hours: 12, minutes: 0 },
            endTime: { hours: 14, minutes: 0 },
            targetCount: 2,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      expect(assignments.length).toBeGreaterThanOrEqual(2);
    }, 30_000);
  });

  describe("Skill-based coverage", () => {
    it("assigns members matching skill-only coverage requirement", async () => {
      const builder = new ModelBuilder({
        members: [
          { id: "alice", roleIds: ["server"], skillIds: ["keyholder"] },
          { id: "bob", roleIds: ["server"] },
          { id: "charlie", roleIds: ["chef"], skillIds: ["keyholder"] },
        ],
        shiftPatterns: [
          {
            id: "opening",
            startTime: { hours: 7, minutes: 0 },
            endTime: { hours: 15, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            skillIds: ["keyholder"],
            startTime: { hours: 7, minutes: 0 },
            endTime: { hours: 15, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      expect(assignments).toHaveLength(1);
      expect(["alice", "charlie"]).toContain(assignments[0]?.memberId);
    }, 30_000);

    it("assigns members matching role AND skills combination", async () => {
      const builder = new ModelBuilder({
        members: [
          { id: "alice", roleIds: ["server"], skillIds: ["keyholder"] },
          { id: "bob", roleIds: ["server"] },
          { id: "charlie", roleIds: ["chef"], skillIds: ["keyholder"] },
        ],
        shiftPatterns: [
          {
            id: "opening",
            startTime: { hours: 7, minutes: 0 },
            endTime: { hours: 15, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            roleIds: ["server"],
            skillIds: ["keyholder"],
            startTime: { hours: 7, minutes: 0 },
            endTime: { hours: 15, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      expect(assignments).toHaveLength(1);
      expect(assignments[0]?.memberId).toBe("alice");
    }, 30_000);

    it("requires ALL skills when multiple skills specified (AND logic)", async () => {
      const builder = new ModelBuilder({
        members: [
          {
            id: "alice",
            roleIds: ["server"],
            skillIds: ["keyholder", "senior"],
          },
          { id: "bob", roleIds: ["server"], skillIds: ["keyholder"] },
          { id: "charlie", roleIds: ["server"], skillIds: ["senior"] },
        ],
        shiftPatterns: [
          {
            id: "shift",
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            skillIds: ["keyholder", "senior"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      expect(assignments).toHaveLength(1);
      expect(assignments[0]?.memberId).toBe("alice");
    }, 30_000);

    it("returns infeasible when no members match skill-only requirement", async () => {
      const builder = new ModelBuilder({
        members: [
          { id: "alice", roleIds: ["server"] },
          { id: "bob", roleIds: ["server"] },
        ],
        shiftPatterns: [
          {
            id: "shift",
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            skillIds: ["keyholder"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("INFEASIBLE");
    }, 30_000);

    it("returns infeasible when no members match role + skills combination", async () => {
      const builder = new ModelBuilder({
        members: [
          { id: "alice", roleIds: ["server"] },
          { id: "bob", roleIds: ["chef"], skillIds: ["keyholder"] },
        ],
        shiftPatterns: [
          {
            id: "shift",
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            roleIds: ["server"],
            skillIds: ["keyholder"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("INFEASIBLE");
    }, 30_000);

    it("handles mixed coverage - role-only, skill-only, and combined", async () => {
      const builder = new ModelBuilder({
        members: [
          { id: "alice", roleIds: ["server"], skillIds: ["keyholder"] },
          { id: "bob", roleIds: ["server"] },
          { id: "charlie", roleIds: ["chef"], skillIds: ["keyholder"] },
        ],
        shiftPatterns: [
          {
            id: "shift",
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            roleIds: ["server"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-01-01",
            skillIds: ["keyholder"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      expect(assignments.length).toBeGreaterThanOrEqual(1);
    }, 30_000);

    it("skill-only coverage respects shift pattern role restrictions", async () => {
      const builder = new ModelBuilder({
        members: [
          { id: "alice", roleIds: ["server"], skillIds: ["keyholder"] },
          { id: "charlie", roleIds: ["chef"], skillIds: ["keyholder"] },
        ],
        shiftPatterns: [
          {
            id: "opening",
            roleIds: ["server"],
            startTime: { hours: 7, minutes: 0 },
            endTime: { hours: 15, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            skillIds: ["keyholder"],
            startTime: { hours: 7, minutes: 0 },
            endTime: { hours: 15, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      expect(assignments).toHaveLength(1);
      expect(assignments[0]?.memberId).toBe("alice");
    }, 30_000);

    it("handles soft priority skill-only coverage", async () => {
      const builder = new ModelBuilder({
        members: [
          { id: "alice", roleIds: ["server"] },
          { id: "bob", roleIds: ["server"], skillIds: ["keyholder"] },
        ],
        shiftPatterns: [
          {
            id: "shift",
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            roleIds: ["server"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-01-01",
            skillIds: ["keyholder"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "HIGH",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      expect(assignments).toHaveLength(1);
      expect(assignments[0]?.memberId).toBe("bob");
    }, 30_000);

    it("multiple members can satisfy skill-only coverage with higher target count", async () => {
      const builder = new ModelBuilder({
        members: [
          { id: "alice", roleIds: ["server"], skillIds: ["keyholder"] },
          { id: "bob", roleIds: ["server"], skillIds: ["keyholder"] },
          { id: "charlie", roleIds: ["server"] },
        ],
        shiftPatterns: [
          {
            id: "shift",
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            skillIds: ["keyholder"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 2,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      expect(assignments).toHaveLength(2);
      const assignedIds = assignments.map((a) => a?.memberId).toSorted();
      expect(assignedIds).toEqual(["alice", "bob"]);
    }, 30_000);
  });
});
