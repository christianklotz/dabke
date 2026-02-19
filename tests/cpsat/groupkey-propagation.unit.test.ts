import { describe, it, expect } from "vitest";
import { defineSemanticTimes } from "../../src/cpsat/semantic-time.js";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import {
  ValidationReporterImpl,
  summarizeValidation,
} from "../../src/cpsat/validation-reporter.js";
import type { TimeOfDay } from "../../src/types.js";
import type { SolverResponse } from "../../src/client.types.js";

const t = (hours: number, minutes = 0): TimeOfDay => ({ hours, minutes });

describe("groupKey propagation", () => {
  it("should propagate groupKey from coverage through to validation passed items", () => {
    const times = defineSemanticTimes({
      weekday_open: { startTime: t(9), endTime: t(18) },
    });

    const coverage = times.coverage([
      {
        semanticTime: "weekday_open",
        roles: ["staff"],
        targetCount: 2,
        dayOfWeek: ["monday", "tuesday"],
      },
    ]);

    // 2026-02-02 is Monday, 2026-02-03 is Tuesday
    const days = ["2026-02-02", "2026-02-03"];
    const resolved = times.resolve(coverage, days);

    // Check that resolved coverage has groupKey
    expect(resolved[0]?.groupKey).toBe("2x staff during weekday_open (mon, tue)");
    expect(resolved[1]?.groupKey).toBe("2x staff during weekday_open (mon, tue)");

    const reporter = new ValidationReporterImpl();

    const builder = new ModelBuilder({
      members: [
        { id: "alice", roles: ["staff"] },
        { id: "bob", roles: ["staff"] },
      ],
      shiftPatterns: [{ id: "day_shift", startTime: t(9), endTime: t(18) }],
      schedulingPeriod: { dateRange: { start: "2026-02-02", end: "2026-02-03" } },
      coverage: resolved,
      reporter,
    });

    builder.compile();

    // Simulate an OPTIMAL solution where all coverage constraints are met
    const response: SolverResponse = {
      status: "OPTIMAL",
      values: {},
      softViolations: [],
    };

    reporter.analyzeSolution(response);

    const validation = reporter.getValidation();

    // All passed items should have the same groupKey
    expect(validation.passed.length).toBeGreaterThan(0);
    for (const passed of validation.passed) {
      expect(passed.groupKey).toBe("2x staff during weekday_open (mon, tue)");
    }

    // When summarized, they should all be grouped together
    const summaries = summarizeValidation(validation);
    expect(summaries.length).toBe(1);
    expect(summaries[0]?.groupKey).toBe("2x staff during weekday_open (mon, tue)");
    expect(summaries[0]?.status).toBe("passed");
    // With 15-minute buckets, 9:00-18:00 = 9 hours = 36 slots per day, 2 days = 72 slots
    expect(summaries[0]?.passedCount).toBe(72);
  });

  it("should create separate groups for different coverage requirements", () => {
    const times = defineSemanticTimes({
      morning: { startTime: t(9), endTime: t(12) },
      afternoon: { startTime: t(14), endTime: t(17) },
    });

    const coverage = times.coverage([
      { semanticTime: "morning", roles: ["staff"], targetCount: 1 },
      { semanticTime: "afternoon", roles: ["staff"], targetCount: 2 },
    ]);

    const days = ["2026-02-02"];
    const resolved = times.resolve(coverage, days);

    const reporter = new ValidationReporterImpl();

    const builder = new ModelBuilder({
      members: [
        { id: "alice", roles: ["staff"] },
        { id: "bob", roles: ["staff"] },
      ],
      shiftPatterns: [{ id: "day_shift", startTime: t(9), endTime: t(17) }],
      schedulingPeriod: { dateRange: { start: "2026-02-02", end: "2026-02-02" } },
      coverage: resolved,
      reporter,
    });

    builder.compile();

    const response: SolverResponse = {
      status: "OPTIMAL",
      values: {},
      softViolations: [],
    };

    reporter.analyzeSolution(response);

    const validation = reporter.getValidation();
    const summaries = summarizeValidation(validation);

    // Should have 2 groups - one for morning, one for afternoon
    expect(summaries.length).toBe(2);

    const morningGroup = summaries.find((s) => s.groupKey === "1x staff during morning");
    const afternoonGroup = summaries.find((s) => s.groupKey === "2x staff during afternoon");

    expect(morningGroup).toBeDefined();
    expect(afternoonGroup).toBeDefined();
    expect(morningGroup?.status).toBe("passed");
    expect(afternoonGroup?.status).toBe("passed");
  });

  it("should not create ungrouped items when using semantic time coverage", () => {
    const times = defineSemanticTimes({
      working_hours: { startTime: t(9), endTime: t(17) },
    });

    const coverage = times.coverage([
      { semanticTime: "working_hours", roles: ["staff"], targetCount: 2 },
    ]);

    const days = ["2026-02-02", "2026-02-03", "2026-02-04"];
    const resolved = times.resolve(coverage, days);

    const reporter = new ValidationReporterImpl();

    const builder = new ModelBuilder({
      members: [
        { id: "alice", roles: ["staff"] },
        { id: "bob", roles: ["staff"] },
      ],
      shiftPatterns: [{ id: "day_shift", startTime: t(9), endTime: t(17) }],
      schedulingPeriod: { dateRange: { start: "2026-02-02", end: "2026-02-04" } },
      coverage: resolved,
      reporter,
    });

    builder.compile();

    const response: SolverResponse = {
      status: "OPTIMAL",
      values: {},
      softViolations: [],
    };

    reporter.analyzeSolution(response);

    const validation = reporter.getValidation();
    const summaries = summarizeValidation(validation);

    // Should have exactly 1 group
    expect(summaries.length).toBe(1);
    // And it should NOT be an "ungrouped:" key
    expect(summaries[0]?.groupKey).not.toContain("ungrouped:");
    expect(summaries[0]?.groupKey).toBe("2x staff during working_hours");
  });
});
