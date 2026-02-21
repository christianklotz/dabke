import { describe, it, expect } from "vitest";
import { parseSolverResponse, resolveAssignments } from "../../src/cpsat/response.js";
import type { SolverResponse } from "../../src/client.types.js";
import type { ShiftPattern } from "../../src/cpsat/types.js";

describe("parseSolverResponse", () => {
  it("should extract assignments from optimal response", () => {
    const response: SolverResponse = {
      status: "OPTIMAL",
      values: {
        "assign:alice:morning:2026-01-10": 1,
        "assign:bob:evening:2026-01-10": 1,
        "assign:alice:morning:2026-01-11": 0,
        "shift:morning:2026-01-10": 1,
      },
      statistics: { solveTimeMs: 100 },
    };

    const result = parseSolverResponse(response);

    expect(result.status).toBe("OPTIMAL");
    expect(result.assignments).toHaveLength(2);
    expect(result.assignments).toContainEqual({
      memberId: "alice",
      shiftPatternId: "morning",
      day: "2026-01-10",
    });
    expect(result.assignments).toContainEqual({
      memberId: "bob",
      shiftPatternId: "evening",
      day: "2026-01-10",
    });
    expect(result.statistics?.solveTimeMs).toBe(100);
  });

  it("should handle feasible response", () => {
    const response: SolverResponse = {
      status: "FEASIBLE",
      values: {
        "assign:emp1:shift1:2026-01-10": 1,
      },
    };

    const result = parseSolverResponse(response);

    expect(result.status).toBe("FEASIBLE");
    expect(result.assignments).toHaveLength(1);
  });

  it("should return empty assignments for infeasible response", () => {
    const response: SolverResponse = {
      status: "INFEASIBLE",
    };

    const result = parseSolverResponse(response);

    expect(result.status).toBe("INFEASIBLE");
    expect(result.assignments).toHaveLength(0);
  });

  it("should return empty assignments for error response", () => {
    const response: SolverResponse = {
      status: "ERROR",
      error: "Something went wrong",
    };

    const result = parseSolverResponse(response);

    expect(result.status).toBe("ERROR");
    expect(result.assignments).toHaveLength(0);
    expect(result.error).toBe("Something went wrong");
  });

  it("should handle member IDs with underscores", () => {
    const response: SolverResponse = {
      status: "OPTIMAL",
      values: {
        "assign:john_doe:morning_shift:2026-01-10": 1,
      },
    };

    const result = parseSolverResponse(response);

    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]).toEqual({
      memberId: "john_doe",
      shiftPatternId: "morning_shift",
      day: "2026-01-10",
    });
  });

  it("should skip non-assignment variables", () => {
    const response: SolverResponse = {
      status: "OPTIMAL",
      values: {
        "shift:morning:2026-01-10": 1,
        "works:alice:2026-01-10": 1,
        "assign:alice:morning:2026-01-10": 1,
      },
    };

    const result = parseSolverResponse(response);

    expect(result.assignments).toHaveLength(1);
  });

  it("should skip malformed variable names", () => {
    const response: SolverResponse = {
      status: "OPTIMAL",
      values: {
        "assign:": 1,
        "assign:a": 1,
        "assign:a:b": 1, // no date
        "assign:a:b:c:d": 1, // too many parts
        "assign:alice:morning:2026-01-10": 1,
      },
    };

    const result = parseSolverResponse(response);

    expect(result.assignments).toHaveLength(1);
  });

  it("should skip invalid date format", () => {
    const response: SolverResponse = {
      status: "OPTIMAL",
      values: {
        "assign:alice:morning:not-a-date": 1,
        "assign:alice:morning:2026-01-10": 1,
      },
    };

    const result = parseSolverResponse(response);

    expect(result.assignments).toHaveLength(1);
  });

  it("should handle empty values", () => {
    const response: SolverResponse = {
      status: "OPTIMAL",
      values: {},
    };

    const result = parseSolverResponse(response);

    expect(result.status).toBe("OPTIMAL");
    expect(result.assignments).toHaveLength(0);
  });

  it("should handle undefined values", () => {
    const response: SolverResponse = {
      status: "OPTIMAL",
    };

    const result = parseSolverResponse(response);

    expect(result.status).toBe("OPTIMAL");
    expect(result.assignments).toHaveLength(0);
  });
});

describe("resolveAssignments", () => {
  const shiftPatterns: ShiftPattern[] = [
    {
      id: "morning",
      roleIds: ["staff"],
      startTime: { hours: 9, minutes: 0 },
      endTime: { hours: 13, minutes: 0 },
    },
    {
      id: "evening",
      roleIds: ["staff"],
      startTime: { hours: 17, minutes: 0 },
      endTime: { hours: 21, minutes: 0 },
    },
  ];

  it("should resolve assignments to concrete times", () => {
    const assignments = [
      { memberId: "alice", shiftPatternId: "morning", day: "2026-01-10" },
      { memberId: "bob", shiftPatternId: "evening", day: "2026-01-10" },
    ];

    const resolved = resolveAssignments(assignments, shiftPatterns);

    expect(resolved).toHaveLength(2);
    expect(resolved).toContainEqual({
      memberId: "alice",
      day: "2026-01-10",
      startTime: { hours: 9, minutes: 0 },
      endTime: { hours: 13, minutes: 0 },
    });
    expect(resolved).toContainEqual({
      memberId: "bob",
      day: "2026-01-10",
      startTime: { hours: 17, minutes: 0 },
      endTime: { hours: 21, minutes: 0 },
    });
  });

  it("should skip assignments with unknown pattern IDs", () => {
    const assignments = [
      { memberId: "alice", shiftPatternId: "unknown", day: "2026-01-10" },
      { memberId: "bob", shiftPatternId: "morning", day: "2026-01-10" },
    ];

    const resolved = resolveAssignments(assignments, shiftPatterns);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.memberId).toBe("bob");
  });

  it("should handle empty assignments", () => {
    const resolved = resolveAssignments([], shiftPatterns);
    expect(resolved).toHaveLength(0);
  });

  it("should handle empty patterns", () => {
    const assignments = [{ memberId: "alice", shiftPatternId: "morning", day: "2026-01-10" }];

    const resolved = resolveAssignments(assignments, []);
    expect(resolved).toHaveLength(0);
  });
});
