import { describe, it, expect, beforeAll } from "vitest";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import { resolveAssignments } from "../../src/cpsat/response.js";
import { getSolverClient, decodeAssignments } from "./helpers.js";

/**
 * Integration tests for ShiftPattern dayOfWeek restrictions.
 *
 * Tests that shift patterns with day-of-week restrictions are only
 * used on the specified days by the solver.
 */
describe("ShiftPattern dayOfWeek restriction (integration)", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("uses correct shift pattern for Saturday (shorter day)", async () => {
    // Scenario: Cafe open weekdays 9-18, Saturday 9-14
    // Full shift available weekdays only, Saturday shift available Saturday only
    const builder = new ModelBuilder({
      members: [
        { id: "alice", roles: ["staff"] },
        { id: "bob", roles: ["staff"] },
      ],
      shiftPatterns: [
        // Full shift for weekdays only
        {
          id: "full_shift",
          startTime: { hours: 8, minutes: 30 },
          endTime: { hours: 18, minutes: 30 },
          dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
        },
        // Short shift for Saturday only
        {
          id: "saturday_shift",
          startTime: { hours: 8, minutes: 30 },
          endTime: { hours: 14, minutes: 30 },
          dayOfWeek: ["saturday"],
        },
      ],
      schedulingPeriod: {
        // 2026-02-06 is Friday, 2026-02-07 is Saturday
        dateRange: { start: "2026-02-06", end: "2026-02-07" },
      },
      coverage: [
        // Friday: 9-18 needs 1 staff
        {
          day: "2026-02-06",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 18, minutes: 0 },
          roleIds: ["staff"],
          targetCount: 1,
          priority: "MANDATORY",
        },
        // Saturday: 9-14 needs 1 staff
        {
          day: "2026-02-07",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 14, minutes: 0 },
          roleIds: ["staff"],
          targetCount: 1,
          priority: "MANDATORY",
        },
      ],
    });

    const { request } = builder.compile();
    const response = await client.solve(request);

    expect(response.status).toBe("OPTIMAL");

    const rawAssignments = decodeAssignments(response.values);
    expect(rawAssignments).toHaveLength(2);

    // Resolve to get actual times
    const resolved = resolveAssignments(
      rawAssignments.map((a) => ({
        memberId: a.memberId!,
        shiftPatternId: a.shiftPatternId!,
        day: a.day!,
      })),
      builder.shiftPatterns,
    );

    // Friday assignment should be full shift (8:30-18:30)
    const fridayAssignment = resolved.find((a) => a.day === "2026-02-06");
    expect(fridayAssignment).toBeDefined();
    expect(fridayAssignment?.startTime).toEqual({ hours: 8, minutes: 30 });
    expect(fridayAssignment?.endTime).toEqual({ hours: 18, minutes: 30 });

    // Saturday assignment should be short shift (8:30-14:30)
    const saturdayAssignment = resolved.find((a) => a.day === "2026-02-07");
    expect(saturdayAssignment).toBeDefined();
    expect(saturdayAssignment?.startTime).toEqual({ hours: 8, minutes: 30 });
    expect(saturdayAssignment?.endTime).toEqual({ hours: 14, minutes: 30 });
  }, 30_000);

  it("realistic cafe scenario with different Saturday hours", async () => {
    // Based on cafeRealisticRota eval scenario
    const builder = new ModelBuilder({
      members: [
        { id: "martina", roles: ["staff"] },
        { id: "diana", roles: ["staff"] },
        { id: "kholoud", roles: ["staff"], skills: ["student"] },
        { id: "milroy", roles: ["staff"] },
        { id: "shruti", roles: ["staff"] },
        { id: "mauro", roles: ["staff"], skills: ["no_weekends"] },
      ],
      shiftPatterns: [
        // Full shift for weekdays
        {
          id: "full_shift",
          startTime: { hours: 8, minutes: 30 },
          endTime: { hours: 18, minutes: 30 },
          dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
        },
        // Saturday shift (shorter day)
        {
          id: "saturday_shift",
          startTime: { hours: 8, minutes: 30 },
          endTime: { hours: 14, minutes: 30 },
          dayOfWeek: ["saturday"],
        },
        // AM half shift - available weekdays only for split coverage
        {
          id: "am_shift",
          startTime: { hours: 8, minutes: 30 },
          endTime: { hours: 14, minutes: 30 },
          dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
        },
        // PM half shift - weekdays only
        {
          id: "pm_shift",
          startTime: { hours: 13, minutes: 30 },
          endTime: { hours: 18, minutes: 30 },
          dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
        },
      ],
      schedulingPeriod: {
        // 2026-02-02 is Monday, 2026-02-07 is Saturday
        // Closed Sunday
        dateRange: { start: "2026-02-02", end: "2026-02-07" },
        dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
      },
      coverage: [
        // Monday: 1 staff 9-18
        {
          day: "2026-02-02",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 18, minutes: 0 },
          roleIds: ["staff"],
          targetCount: 1,
          priority: "MANDATORY",
        },
        // Tue-Fri: 2 staff 9-18
        {
          day: "2026-02-03",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 18, minutes: 0 },
          roleIds: ["staff"],
          targetCount: 2,
          priority: "MANDATORY",
        },
        {
          day: "2026-02-04",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 18, minutes: 0 },
          roleIds: ["staff"],
          targetCount: 2,
          priority: "MANDATORY",
        },
        {
          day: "2026-02-05",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 18, minutes: 0 },
          roleIds: ["staff"],
          targetCount: 2,
          priority: "MANDATORY",
        },
        {
          day: "2026-02-06",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 18, minutes: 0 },
          roleIds: ["staff"],
          targetCount: 2,
          priority: "MANDATORY",
        },
        // Saturday: 2 staff 9-14
        {
          day: "2026-02-07",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 14, minutes: 0 },
          roleIds: ["staff"],
          targetCount: 2,
          priority: "MANDATORY",
        },
      ],
      ruleConfigs: [
        {
          name: "max-hours-week",
          hours: 20,
          skillIds: ["student"],
          priority: "MANDATORY",
        },
        { name: "max-hours-week", hours: 48, priority: "MANDATORY" },
        {
          name: "time-off",

          priority: "MANDATORY",
          dayOfWeek: ["saturday", "sunday"],
          skillIds: ["no_weekends"],
        },
      ],
    });

    const { request, validation } = builder.compile();

    // Should have no validation errors
    expect(validation.errors).toHaveLength(0);

    const response = await client.solve(request);
    expect(response.status).toBe("OPTIMAL");

    const rawAssignments = decodeAssignments(response.values);
    const resolved = resolveAssignments(
      rawAssignments.map((a) => ({
        memberId: a.memberId!,
        shiftPatternId: a.shiftPatternId!,
        day: a.day!,
      })),
      builder.shiftPatterns,
    );

    // Verify Saturday assignments use the short shift
    const saturdayAssignments = resolved.filter((a) => a.day === "2026-02-07");
    expect(saturdayAssignments.length).toBe(2);

    for (const assignment of saturdayAssignments) {
      expect(assignment.endTime).toEqual({ hours: 14, minutes: 30 });
      // Mauro should not be assigned on Saturday (no_weekends skill)
      expect(assignment.memberId).not.toBe("mauro");
    }

    // Verify weekday assignments don't use Saturday shift
    const weekdayAssignments = resolved.filter((a) => a.day !== "2026-02-07");
    for (const assignment of weekdayAssignments) {
      // Should be either full shift (18:30) or PM shift (18:30) or AM shift (14:30)
      const endHour = assignment.endTime.hours;
      expect([14, 18]).toContain(endHour);
    }
  }, 60_000);

  it("pattern without dayOfWeek can be used on any day", async () => {
    const builder = new ModelBuilder({
      members: [{ id: "alice", roles: ["staff"] }],
      shiftPatterns: [
        // Pattern available on any day
        {
          id: "any_day_shift",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      ],
      schedulingPeriod: {
        // Include weekend
        dateRange: { start: "2026-02-07", end: "2026-02-08" },
      },
      coverage: [
        {
          day: "2026-02-07", // Saturday
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
          roleIds: ["staff"],
          targetCount: 1,
          priority: "MANDATORY",
        },
        {
          day: "2026-02-08", // Sunday
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
          roleIds: ["staff"],
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

  it("reports infeasible when no patterns available for a day", async () => {
    const builder = new ModelBuilder({
      members: [{ id: "alice", roles: ["staff"] }],
      shiftPatterns: [
        // Only available on weekdays
        {
          id: "weekday_only",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
          dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
        },
      ],
      schedulingPeriod: {
        // Saturday only - no patterns available
        dateRange: { start: "2026-02-07", end: "2026-02-07" },
      },
      coverage: [
        {
          day: "2026-02-07",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 14, minutes: 0 },
          roleIds: ["staff"],
          targetCount: 1,
          priority: "MANDATORY",
        },
      ],
    });

    const { request, validation } = builder.compile();

    // Should have a validation error about no patterns
    expect(validation.errors.length).toBeGreaterThan(0);

    // If we try to solve anyway, it should be infeasible
    const response = await client.solve(request);
    expect(response.status).toBe("INFEASIBLE");
  }, 30_000);
});
