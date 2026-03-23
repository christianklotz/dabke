import { describe, expect, it } from "vitest";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import { createBaseConfig } from "./helpers.js";

/**
 * Extract soft_linear constraints matching a prefix from the compiled request.
 */
function getSoftConstraints(
  request: { constraints: Array<{ type: string; id?: string }> },
  prefix: string,
) {
  return request.constraints.filter(
    (c) => c.type === "soft_linear" && c.id?.startsWith(prefix),
  );
}

describe("CP-SAT: must-assign rule (unit)", () => {
  it("compiles a soft constraint per member per week", () => {
    const baseConfig = createBaseConfig({
      roleId: "waiter",
      memberIds: ["alice", "bob"],
      schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-09" } },
    });

    const builder = new ModelBuilder({
      ...baseConfig,
      ruleConfigs: [{ name: "must-assign", memberIds: ["alice"] }],
    });

    const { request } = builder.compile();

    const aliceConstraints = getSoftConstraints(request, "must-assign:alice:");
    expect(aliceConstraints.length).toBeGreaterThanOrEqual(1);

    const bobConstraints = getSoftConstraints(request, "must-assign:bob:");
    expect(bobConstraints.length).toBe(0);
  });

  it("always produces a soft constraint (never hard)", () => {
    const baseConfig = createBaseConfig({
      roleId: "waiter",
      memberIds: ["alice"],
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
    });

    const builder = new ModelBuilder({
      ...baseConfig,
      ruleConfigs: [{ name: "must-assign", memberIds: ["alice"] }],
    });

    const { request } = builder.compile();

    const softConstraints = getSoftConstraints(request, "must-assign:alice:");
    expect(softConstraints.length).toBe(1);

    // No hard constraints should be added beyond the baseline
    const baselineBuilder = new ModelBuilder({ ...baseConfig, ruleConfigs: [] });
    const baselineRequest = baselineBuilder.compile().request;
    const hardConstraintDelta =
      request.constraints.filter((c) => c.type === "linear").length -
      baselineRequest.constraints.filter((c) => c.type === "linear").length;
    expect(hardConstraintDelta).toBe(0);
  });

  it("supports role-based scoping", () => {
    const baseConfig = createBaseConfig({
      roleIds: ["waiter", "runner"],
      members: [
        { id: "alice", roleIds: ["waiter"] },
        { id: "bob", roleIds: ["runner"] },
      ],
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
    });

    const builder = new ModelBuilder({
      ...baseConfig,
      ruleConfigs: [{ name: "must-assign", roleIds: ["waiter"] }],
    });

    const { request } = builder.compile();

    const aliceConstraints = getSoftConstraints(request, "must-assign:alice:");
    const bobConstraints = getSoftConstraints(request, "must-assign:bob:");

    expect(aliceConstraints.length).toBe(1);
    expect(bobConstraints.length).toBe(0);
  });

  it("tracks constraint for validation reporting", () => {
    const baseConfig = createBaseConfig({
      roleId: "waiter",
      memberIds: ["alice"],
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
    });

    const builder = new ModelBuilder({
      ...baseConfig,
      ruleConfigs: [{ name: "must-assign", memberIds: ["alice"] }],
    });

    builder.compile();

    const tracked = (
      builder.reporter as {
        getTrackedConstraints?: () => Array<{ rule?: string; description: string }>;
      }
    )
      .getTrackedConstraints?.() ?? [];
    const mustAssignTracked = tracked.filter((c) => c.rule === "must-assign");
    expect(mustAssignTracked.length).toBe(1);
    expect(mustAssignTracked[0]!.description).toContain("staffing obligation");
  });

  it("produces one constraint per week in a multi-week period", () => {
    const baseConfig = createBaseConfig({
      roleId: "waiter",
      memberIds: ["alice"],
      schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-16" } },
    });

    const builder = new ModelBuilder({
      ...baseConfig,
      ruleConfigs: [{ name: "must-assign", memberIds: ["alice"] }],
    });

    const { request } = builder.compile();

    const mustAssignConstraints = getSoftConstraints(request, "must-assign:alice:");
    // 12 days starting Monday Feb 5 = 2 full weeks (Feb 5-11, Feb 12-16)
    expect(mustAssignConstraints.length).toBe(2);
  });

  it("yields gracefully when member has full-week time-off", () => {
    const baseConfig = createBaseConfig({
      roleId: "waiter",
      memberIds: ["alice", "bob"],
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
      targetCount: 1,
    });

    const builder = new ModelBuilder({
      ...baseConfig,
      ruleConfigs: [
        { name: "must-assign", memberIds: ["bob"] },
        {
          name: "time-off",
          memberIds: ["bob"],
          dateRange: { start: "2024-02-01", end: "2024-02-01" },
          priority: "MANDATORY",
        },
      ],
    });

    const { canSolve } = builder.compile();

    // Schedule should still be solvable (must-assign is soft, time-off blocks bob)
    expect(canSolve).toBe(true);
  });
});
