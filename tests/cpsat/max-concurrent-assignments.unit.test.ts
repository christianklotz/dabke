import { describe, expect, it } from "vitest";
import {
  MaxConcurrentAssignmentsSchema,
  type MaxConcurrentAssignmentsConfig,
} from "../../src/cpsat/rules/max-concurrent-assignments.js";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import { createBaseConfig } from "./helpers.js";

function createMaxConcurrentAssignmentsRule(config: MaxConcurrentAssignmentsConfig) {
  return MaxConcurrentAssignmentsSchema.parse(config);
}

function getSoftConstraints(
  request: { constraints: Array<{ type: string; id?: string }> },
  prefix: string,
) {
  return request.constraints.filter((c) => c.type === "soft_linear" && c.id?.startsWith(prefix));
}

describe("CP-SAT max-concurrent-assignments rule: schema validation", () => {
  it("accepts role-based scoping", () => {
    expect(() =>
      createMaxConcurrentAssignmentsRule({
        assignments: 5,
        roleIds: ["stylist"],
        priority: "MANDATORY",
      }),
    ).not.toThrow();
  });

  it("accepts a partial-day window when both boundaries are provided", () => {
    expect(() =>
      createMaxConcurrentAssignmentsRule({
        assignments: 2,
        skillIds: ["productive"],
        startTime: { hours: 10, minutes: 0 },
        endTime: { hours: 19, minutes: 0 },
        priority: "HIGH",
      }),
    ).not.toThrow();
  });

  it("rejects a partial-day window with only startTime", () => {
    expect(() =>
      createMaxConcurrentAssignmentsRule({
        assignments: 2,
        memberIds: ["alice"],
        startTime: { hours: 10, minutes: 0 },
        priority: "MANDATORY",
      } as MaxConcurrentAssignmentsConfig),
    ).toThrow("Both startTime and endTime must be provided together");
  });
});

describe("CP-SAT max-concurrent-assignments rule: compilation", () => {
  it("emits one soft constraint per exact overlap segment", () => {
    const baseConfig = createBaseConfig({
      roleId: "stylist",
      memberIds: ["alice", "bob"],
      shift: {
        id: "day",
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
    });

    const builder = new ModelBuilder({
      ...baseConfig,
      coverageBucketMinutes: 60,
      ruleConfigs: [
        {
          name: "max-concurrent-assignments",
          roleIds: ["stylist"],
          assignments: 1,
          priority: "HIGH",
        },
      ],
    });

    const { request } = builder.compile();
    const constraints = getSoftConstraints(request, "rule:max-concurrent-assignments:");

    expect(constraints).toHaveLength(1);
  });

  it("does not merge non-overlapping shifts that share a coverage bucket", () => {
    const builder = new ModelBuilder({
      members: [{ id: "alice", roleIds: ["stylist"] }],
      shiftPatterns: [
        {
          id: "first",
          roleIds: ["stylist"],
          startTime: { hours: 10, minutes: 0 },
          endTime: { hours: 10, minutes: 5 },
        },
        {
          id: "second",
          roleIds: ["stylist"],
          startTime: { hours: 10, minutes: 5 },
          endTime: { hours: 10, minutes: 10 },
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
      coverageBucketMinutes: 60,
      coverage: [
        {
          day: "2024-02-01",
          roleIds: ["stylist"],
          startTime: { hours: 10, minutes: 0 },
          endTime: { hours: 10, minutes: 5 },
          targetCount: 1,
          priority: "MANDATORY",
        },
        {
          day: "2024-02-01",
          roleIds: ["stylist"],
          startTime: { hours: 10, minutes: 5 },
          endTime: { hours: 10, minutes: 10 },
          targetCount: 1,
          priority: "MANDATORY",
        },
      ],
      ruleConfigs: [
        {
          name: "max-concurrent-assignments",
          roleIds: ["stylist"],
          assignments: 1,
          priority: "HIGH",
        },
      ],
    });

    const { request } = builder.compile();
    const constraints = getSoftConstraints(request, "rule:max-concurrent-assignments:");

    expect(constraints).toHaveLength(2);
  });

  it("tracks after-midnight overlap for overnight shifts", () => {
    const builder = new ModelBuilder({
      members: [
        { id: "alice", roleIds: ["stylist"] },
        { id: "bob", roleIds: ["stylist"] },
      ],
      shiftPatterns: [
        {
          id: "overnight_a",
          roleIds: ["stylist"],
          startTime: { hours: 23, minutes: 0 },
          endTime: { hours: 7, minutes: 0 },
        },
        {
          id: "overnight_b",
          roleIds: ["stylist"],
          startTime: { hours: 23, minutes: 0 },
          endTime: { hours: 7, minutes: 0 },
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
      coverageBucketMinutes: 60,
      coverage: [
        {
          day: "2024-02-01",
          roleIds: ["stylist"],
          startTime: { hours: 23, minutes: 0 },
          endTime: { hours: 7, minutes: 0 },
          targetCount: 2,
          priority: "MANDATORY",
        },
      ],
      ruleConfigs: [
        {
          name: "max-concurrent-assignments",
          roleIds: ["stylist"],
          assignments: 1,
          priority: "HIGH",
        },
      ],
    });

    const { request } = builder.compile();
    const constraints = getSoftConstraints(request, "rule:max-concurrent-assignments:");

    expect(constraints).toHaveLength(1);

    const tracked =
      (
        builder.reporter as {
          getTrackedConstraints?: () => Array<{ rule?: string; description: string }>;
        }
      ).getTrackedConstraints?.() ?? [];
    const overnightTracked = tracked.filter(
      (constraint) => constraint.rule === "max-concurrent-assignments",
    );

    expect(overnightTracked).toHaveLength(1);
    expect(overnightTracked[0]?.description).toContain("23:00-07:00");
  });

  it("tracks validation constraints under the new rule name", () => {
    const baseConfig = createBaseConfig({
      roleId: "stylist",
      memberIds: ["alice", "bob"],
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
    });

    const builder = new ModelBuilder({
      ...baseConfig,
      ruleConfigs: [
        {
          name: "max-concurrent-assignments",
          roleIds: ["stylist"],
          assignments: 1,
          priority: "MANDATORY",
        },
      ],
    });

    builder.compile();

    const tracked =
      (
        builder.reporter as {
          getTrackedConstraints?: () => Array<{ rule?: string; description: string }>;
        }
      ).getTrackedConstraints?.() ?? [];
    const concurrentTracked = tracked.filter((c) => c.rule === "max-concurrent-assignments");

    expect(concurrentTracked.length).toBeGreaterThan(0);
    expect(concurrentTracked[0]!.description).toContain("Max 1 concurrent assignment");
  });
});
