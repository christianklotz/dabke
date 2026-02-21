import { describe, it, expect } from "vitest";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";

describe("Overnight coverage bucket lookups", () => {
  it("should find patterns for overnight coverage (18:00-06:00)", () => {
    const builder = new ModelBuilder({
      members: [{ id: "alice", roleIds: ["staff"] }],
      shiftPatterns: [
        {
          id: "night_shift",
          startTime: { hours: 18, minutes: 0 },
          endTime: { hours: 6, minutes: 0 },
          roleIds: ["staff"],
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
      coverage: [
        {
          day: "2024-01-01",
          roleIds: ["staff"],
          startTime: { hours: 18, minutes: 0 },
          endTime: { hours: 6, minutes: 0 },
          targetCount: 1,
          priority: "MANDATORY",
        },
      ],
    });

    const result = builder.compile();

    expect(result.canSolve).toBe(true);
    expect(result.validation.errors).toHaveLength(0);
  });

  it("should find patterns for late-night coverage (22:00-07:00)", () => {
    const builder = new ModelBuilder({
      members: [{ id: "alice", roleIds: ["staff"] }],
      shiftPatterns: [
        {
          id: "night_shift",
          startTime: { hours: 22, minutes: 0 },
          endTime: { hours: 7, minutes: 0 },
          roleIds: ["staff"],
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
      coverage: [
        {
          day: "2024-01-01",
          roleIds: ["staff"],
          startTime: { hours: 22, minutes: 0 },
          endTime: { hours: 7, minutes: 0 },
          targetCount: 1,
          priority: "MANDATORY",
        },
      ],
    });

    const result = builder.compile();

    expect(result.canSolve).toBe(true);
    expect(result.validation.errors).toHaveLength(0);
  });

  it("should handle coverage starting at midnight (00:00-06:00) with overnight pattern", () => {
    const builder = new ModelBuilder({
      members: [{ id: "alice", roleIds: ["staff"] }],
      shiftPatterns: [
        {
          id: "night_shift",
          startTime: { hours: 20, minutes: 0 },
          endTime: { hours: 8, minutes: 0 },
          roleIds: ["staff"],
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
      coverage: [
        {
          day: "2024-01-01",
          roleIds: ["staff"],
          startTime: { hours: 0, minutes: 0 },
          endTime: { hours: 6, minutes: 0 },
          targetCount: 1,
          priority: "MANDATORY",
        },
      ],
    });

    const result = builder.compile();

    expect(result.canSolve).toBe(true);
    expect(result.validation.errors).toHaveLength(0);
  });

  it("should handle multiple overlapping overnight patterns", () => {
    const builder = new ModelBuilder({
      members: [
        { id: "alice", roleIds: ["staff"] },
        { id: "bob", roleIds: ["staff"] },
      ],
      shiftPatterns: [
        {
          id: "evening_shift",
          startTime: { hours: 16, minutes: 0 },
          endTime: { hours: 0, minutes: 0 }, // ends at midnight
          roleIds: ["staff"],
        },
        {
          id: "night_shift",
          startTime: { hours: 22, minutes: 0 },
          endTime: { hours: 6, minutes: 0 },
          roleIds: ["staff"],
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
      coverage: [
        {
          day: "2024-01-01",
          roleIds: ["staff"],
          startTime: { hours: 23, minutes: 0 },
          endTime: { hours: 5, minutes: 0 },
          targetCount: 1,
          priority: "MANDATORY",
        },
      ],
    });

    const result = builder.compile();

    expect(result.canSolve).toBe(true);
    expect(result.validation.errors).toHaveLength(0);
  });
});
