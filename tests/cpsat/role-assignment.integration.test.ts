import { describe, it, expect, beforeAll } from "vitest";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import { getSolverClient, decodeAssignments } from "./helpers.js";

describe("Role-based shift assignment (integration)", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("assigns any member to shifts with no roles", async () => {
    const builder = new ModelBuilder({
      members: [
        { id: "alice", roles: ["server"] },
        { id: "bob", roles: ["chef"] },
      ],
      shiftPatterns: [
        {
          id: "generic_shift",
          // No roles - anyone can work
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
      coverage: [
        {
          day: "2024-01-01",
          roles: ["server"], // Coverage still needs a role for tracking
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

    // Should have exactly 1 assignment (coverage requires 1)
    expect(assignments).toHaveLength(1);
    // Either alice or bob could be assigned since no role restriction on pattern
    expect(["alice", "bob"]).toContain(assignments[0]?.memberId);
  }, 30_000);

  it("only assigns members with matching role to role-restricted shifts", async () => {
    const builder = new ModelBuilder({
      members: [
        { id: "alice", roles: ["server"] },
        { id: "bob", roles: ["chef"] },
      ],
      shiftPatterns: [
        {
          id: "server_shift",
          roles: ["server"], // Only servers
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
      coverage: [
        {
          day: "2024-01-01",
          roles: ["server"],
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

    // Only alice (server) should be assigned
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.memberId).toBe("alice");
  }, 30_000);

  it("assigns members with any matching role to multi-role shifts", async () => {
    const builder = new ModelBuilder({
      members: [
        { id: "alice", roles: ["server"] },
        { id: "bob", roles: ["runner"] },
        { id: "charlie", roles: ["chef"] },
      ],
      shiftPatterns: [
        {
          id: "floor_shift",
          roles: ["server", "runner"], // Servers OR runners
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
      coverage: [
        // Need 1 server and 1 runner - both can work the floor_shift
        {
          day: "2024-01-01",
          roles: ["server"],
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
          targetCount: 1,
          priority: "MANDATORY",
        },
        {
          day: "2024-01-01",
          roles: ["runner"],
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

    // Alice (server) and Bob (runner) should be assigned, not Charlie (chef)
    expect(assignments).toHaveLength(2);
    const assignedIds = assignments.map((a) => a?.memberId).toSorted();
    expect(assignedIds).toEqual(["alice", "bob"]);
  }, 30_000);

  it("returns infeasible when no members match required role", async () => {
    const builder = new ModelBuilder({
      members: [
        { id: "alice", roles: ["chef"] },
        { id: "bob", roles: ["chef"] },
      ],
      shiftPatterns: [
        {
          id: "server_shift",
          roles: ["server"], // Only servers - but we have no servers!
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
      coverage: [
        {
          day: "2024-01-01",
          roles: ["server"],
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
          targetCount: 1,
          priority: "MANDATORY",
        },
      ],
    });

    const { request } = builder.compile();
    const response = await client.solve(request);

    // Should be infeasible - no one can work the server shift
    expect(response.status).toBe("INFEASIBLE");
  }, 30_000);

  it("allows multi-role member to work shift matching any of their roles", async () => {
    const builder = new ModelBuilder({
      members: [
        { id: "alice", roles: ["server", "host"] }, // Multi-role
        { id: "bob", roles: ["chef"] },
      ],
      shiftPatterns: [
        {
          id: "host_shift",
          roles: ["host"],
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
      coverage: [
        {
          day: "2024-01-01",
          roles: ["host"],
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

    // Alice should be assigned (has host role)
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.memberId).toBe("alice");
  }, 30_000);

  it("handles mixed patterns - some with roles, some without", async () => {
    const builder = new ModelBuilder({
      members: [
        { id: "alice", roles: ["server"] },
        { id: "bob", roles: ["chef"] },
      ],
      shiftPatterns: [
        {
          id: "morning",
          roles: ["server"], // Only servers
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 13, minutes: 0 },
        },
        {
          id: "afternoon",
          // No roles - anyone
          startTime: { hours: 13, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
      coverage: [
        {
          day: "2024-01-01",
          roles: ["server"],
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 13, minutes: 0 },
          targetCount: 1,
          priority: "MANDATORY",
        },
        {
          day: "2024-01-01",
          roles: ["chef"],
          startTime: { hours: 13, minutes: 0 },
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

    // Should have 2 assignments
    expect(assignments).toHaveLength(2);

    // Morning should be Alice (server-only)
    const morningAssignment = assignments.find((a) => a?.shiftPatternId === "morning");
    expect(morningAssignment?.memberId).toBe("alice");

    // Afternoon can be either (no role restriction) - but Bob makes sense for chef coverage
    const afternoonAssignment = assignments.find((a) => a?.shiftPatternId === "afternoon");
    expect(afternoonAssignment).toBeDefined();
  }, 30_000);
});
