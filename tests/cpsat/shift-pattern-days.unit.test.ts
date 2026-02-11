import { describe, it, expect } from "vitest";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import type { TimeOfDay } from "../../src/types.js";

const t = (hours: number, minutes = 0): TimeOfDay => ({ hours, minutes });

describe("ShiftPattern daysOfWeek restriction", () => {
  it("should only create assignment variables for patterns available on that day", () => {
    const builder = new ModelBuilder({
      employees: [{ id: "alice", roleIds: ["staff"] }],
      shiftPatterns: [
        // Full shift only available on weekdays
        {
          id: "full_shift",
          startTime: t(9),
          endTime: t(18),
          daysOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
        },
        // Saturday shift only available on Saturday
        {
          id: "saturday_shift",
          startTime: t(9),
          endTime: t(14),
          daysOfWeek: ["saturday"],
        },
      ],
      schedulingPeriod: {
        // 2026-02-06 is Friday, 2026-02-07 is Saturday
        dateRange: { start: "2026-02-06", end: "2026-02-07" },
      },
      coverage: [
        {
          day: "2026-02-06",
          startTime: t(9),
          endTime: t(18),
          roleIds: ["staff"],
          targetCount: 1,
          priority: "MANDATORY",
        },
        {
          day: "2026-02-07",
          startTime: t(9),
          endTime: t(14),
          roleIds: ["staff"],
          targetCount: 1,
          priority: "MANDATORY",
        },
      ],
    });

    const result = builder.compile();

    // Should have no errors - coverage can be met
    expect(result.validation.errors).toHaveLength(0);
    expect(result.canSolve).toBe(true);

    // Check that the correct variables were created
    const request = result.request;
    const boolVars = request.variables.filter((v) => v.type === "bool").map((v) => v.name);

    // Friday should only have full_shift assignment variable
    expect(boolVars).toContain("assign:alice:full_shift:2026-02-06");
    expect(boolVars).not.toContain("assign:alice:saturday_shift:2026-02-06");

    // Saturday should only have saturday_shift assignment variable
    expect(boolVars).toContain("assign:alice:saturday_shift:2026-02-07");
    expect(boolVars).not.toContain("assign:alice:full_shift:2026-02-07");
  });

  it("should report error when no patterns are available for coverage on a day", () => {
    const builder = new ModelBuilder({
      employees: [{ id: "alice", roleIds: ["staff"] }],
      shiftPatterns: [
        // Only weekday shift
        {
          id: "weekday_shift",
          startTime: t(9),
          endTime: t(18),
          daysOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
        },
      ],
      schedulingPeriod: {
        // 2026-02-07 is Saturday - no patterns available
        dateRange: { start: "2026-02-07", end: "2026-02-07" },
      },
      coverage: [
        {
          day: "2026-02-07",
          startTime: t(9),
          endTime: t(14),
          roleIds: ["staff"],
          targetCount: 1,
          priority: "MANDATORY",
        },
      ],
    });

    const result = builder.compile();

    // Should report an error because no patterns are available on Saturday
    expect(result.validation.errors.length).toBeGreaterThan(0);
  });

  it("should allow patterns without daysOfWeek restriction on any day", () => {
    const builder = new ModelBuilder({
      employees: [{ id: "alice", roleIds: ["staff"] }],
      shiftPatterns: [
        // Pattern available any day (no daysOfWeek restriction)
        { id: "any_shift", startTime: t(9), endTime: t(17) },
      ],
      schedulingPeriod: {
        // Week including Saturday and Sunday
        dateRange: { start: "2026-02-02", end: "2026-02-08" },
      },
      coverage: [
        {
          day: "2026-02-02",
          startTime: t(9),
          endTime: t(17),
          roleIds: ["staff"],
          targetCount: 1,
          priority: "MANDATORY",
        }, // Monday
        {
          day: "2026-02-07",
          startTime: t(9),
          endTime: t(17),
          roleIds: ["staff"],
          targetCount: 1,
          priority: "MANDATORY",
        }, // Saturday
      ],
    });

    const result = builder.compile();

    expect(result.validation.errors).toHaveLength(0);
    expect(result.canSolve).toBe(true);

    // Check that assignment variables exist for both days
    const boolVars = result.request.variables.filter((v) => v.type === "bool").map((v) => v.name);
    expect(boolVars).toContain("assign:alice:any_shift:2026-02-02");
    expect(boolVars).toContain("assign:alice:any_shift:2026-02-07");
  });

  it("should correctly filter patterns in coverage constraint building", () => {
    const builder = new ModelBuilder({
      employees: [
        { id: "alice", roleIds: ["staff"] },
        { id: "bob", roleIds: ["staff"] },
      ],
      shiftPatterns: [
        // Full shift for weekdays only
        {
          id: "full_shift",
          startTime: t(8, 30),
          endTime: t(18, 30),
          daysOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
        },
        // Short shift for Saturday only
        {
          id: "saturday_shift",
          startTime: t(8, 30),
          endTime: t(14, 30),
          daysOfWeek: ["saturday"],
        },
        // AM half shift - available all days
        {
          id: "am_shift",
          startTime: t(8, 30),
          endTime: t(14, 30),
        },
      ],
      schedulingPeriod: {
        // 2026-02-07 is Saturday
        dateRange: { start: "2026-02-07", end: "2026-02-07" },
      },
      coverage: [
        // Coverage 8:30-14:30 on Saturday
        {
          day: "2026-02-07",
          startTime: t(8, 30),
          endTime: t(14, 30),
          roleIds: ["staff"],
          targetCount: 2,
          priority: "MANDATORY",
        },
      ],
    });

    const result = builder.compile();

    // Should compile without errors
    expect(result.validation.errors).toHaveLength(0);
    expect(result.canSolve).toBe(true);

    // full_shift should NOT have an assignment variable for Saturday
    const boolVars = result.request.variables.filter((v) => v.type === "bool").map((v) => v.name);
    expect(boolVars).not.toContain("assign:alice:full_shift:2026-02-07");
    expect(boolVars).not.toContain("assign:bob:full_shift:2026-02-07");

    // saturday_shift and am_shift SHOULD have assignment variables for Saturday
    expect(boolVars).toContain("assign:alice:saturday_shift:2026-02-07");
    expect(boolVars).toContain("assign:alice:am_shift:2026-02-07");
    expect(boolVars).toContain("assign:bob:saturday_shift:2026-02-07");
    expect(boolVars).toContain("assign:bob:am_shift:2026-02-07");
  });
});
