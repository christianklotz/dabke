import { describe, expect, it } from "vitest";
import {
  TargetPeakConcurrentAssignmentsSchema,
  TARGET_PEAK_CONCURRENT_ASSIGNMENTS_OBJECTIVE_STAGE_ID,
  type TargetPeakConcurrentAssignmentsConfig,
} from "../../src/cpsat/rules/target-peak-concurrent-assignments.js";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import { createBaseConfig } from "./helpers.js";

function createTargetPeakConcurrentAssignmentsRule(config: TargetPeakConcurrentAssignmentsConfig) {
  return TargetPeakConcurrentAssignmentsSchema.parse(config);
}

describe("CP-SAT target-peak-concurrent-assignments rule: schema validation", () => {
  it("accepts role-based scoping", () => {
    expect(() =>
      createTargetPeakConcurrentAssignmentsRule({
        assignments: 5,
        roleIds: ["stylist"],
        priority: "HIGH",
      }),
    ).not.toThrow();
  });

  it("defaults priority to HIGH", () => {
    const parsed = TargetPeakConcurrentAssignmentsSchema.parse({
      assignments: 3,
      roleIds: ["stylist"],
    });

    expect(parsed.priority).toBe("HIGH");
  });

  it("accepts calendar scoping", () => {
    expect(() =>
      createTargetPeakConcurrentAssignmentsRule({
        assignments: 5,
        skillIds: ["productive"],
        dayOfWeek: ["thursday"],
        priority: "MEDIUM",
      }),
    ).not.toThrow();
  });

  it("rejects MANDATORY priority", () => {
    expect(() =>
      TargetPeakConcurrentAssignmentsSchema.parse({
        assignments: 5,
        roleIds: ["stylist"],
        priority: "MANDATORY",
      }),
    ).toThrow(/Invalid option/);
  });
});

describe("CP-SAT target-peak-concurrent-assignments rule: compilation", () => {
  it("emits helper variables and one soft shortfall constraint per scoped day", () => {
    const baseConfig = createBaseConfig({
      roleId: "stylist",
      memberIds: ["alice", "bob", "charlie", "diana"],
      shifts: [
        {
          id: "open",
          startTime: { hours: 10, minutes: 0 },
          endTime: { hours: 19, minutes: 0 },
          roleIds: ["stylist"],
        },
        {
          id: "close",
          startTime: { hours: 11, minutes: 0 },
          endTime: { hours: 20, minutes: 0 },
          roleIds: ["stylist"],
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
      coverage: [
        {
          day: "2024-02-01",
          roleIds: ["stylist"],
          startTime: { hours: 10, minutes: 0 },
          endTime: { hours: 19, minutes: 0 },
          targetCount: 2,
          priority: "MANDATORY",
        },
        {
          day: "2024-02-01",
          roleIds: ["stylist"],
          startTime: { hours: 11, minutes: 0 },
          endTime: { hours: 20, minutes: 0 },
          targetCount: 2,
          priority: "MANDATORY",
        },
      ],
    });

    const builder = new ModelBuilder({
      ...baseConfig,
      coverageBucketMinutes: 60,
      ruleConfigs: [
        {
          name: "target-peak-concurrent-assignments",
          roleIds: ["stylist"],
          assignments: 5,
          priority: "HIGH",
        },
      ],
    });

    const { request } = builder.compile();
    const softConstraints = request.constraints.filter(
      (constraint) =>
        constraint.type === "soft_linear" &&
        constraint.id?.startsWith("rule:target-peak-concurrent-assignments:5:"),
    );
    const helperVars = request.variables.filter((variable) =>
      variable.name.startsWith("rule:target-peak-concurrent-assignments:5:"),
    );

    expect(softConstraints).toHaveLength(1);
    const softConstraint = softConstraints[0];
    expect(softConstraint?.type).toBe("soft_linear");
    if (softConstraint?.type === "soft_linear") {
      expect(softConstraint.stage).toBe(TARGET_PEAK_CONCURRENT_ASSIGNMENTS_OBJECTIVE_STAGE_ID);
    }
    expect(helperVars.some((variable) => variable.name.endsWith(":shortfall"))).toBe(true);
    expect(helperVars.some((variable) => variable.name.endsWith(":witness"))).toBe(true);
    expect(request.objectiveStages?.map((stage) => stage.id)).toEqual([
      TARGET_PEAK_CONCURRENT_ASSIGNMENTS_OBJECTIVE_STAGE_ID,
      "__dabke_unstaged__",
    ]);
  });

  it("rejects explicit objectiveStageOrder while target peak uses a private stage", () => {
    const baseConfig = createBaseConfig({
      roleId: "stylist",
      memberIds: ["alice"],
      shifts: [
        {
          id: "open",
          startTime: { hours: 10, minutes: 0 },
          endTime: { hours: 19, minutes: 0 },
          roleIds: ["stylist"],
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
      coverage: [],
    });

    const builder = new ModelBuilder({
      ...baseConfig,
      objectiveStageOrder: ["custom"],
      ruleConfigs: [
        {
          name: "target-peak-concurrent-assignments",
          roleIds: ["stylist"],
          assignments: 1,
          priority: "HIGH",
        },
      ],
    });

    expect(() => builder.compile()).toThrow(
      "targetPeakConcurrentAssignments cannot be combined with ModelBuilder objectiveStageOrder until the multi-stage objective API is public.",
    );
  });

  it("still emits a shortfall when no eligible assignments can contribute", () => {
    const builder = new ModelBuilder({
      members: [{ id: "alice", roleIds: ["stylist"] }],
      shiftPatterns: [],
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
      coverage: [],
      ruleConfigs: [
        {
          name: "target-peak-concurrent-assignments",
          roleIds: ["stylist"],
          assignments: 5,
          priority: "HIGH",
        },
      ],
    });

    const { request } = builder.compile();
    const shortfallConstraints = request.constraints.filter(
      (constraint) =>
        constraint.type === "soft_linear" &&
        constraint.id?.startsWith("rule:target-peak-concurrent-assignments:5:"),
    );

    expect(shortfallConstraints).toHaveLength(1);
    const shortfallConstraint = shortfallConstraints[0];
    expect(shortfallConstraint?.type).toBe("soft_linear");
    if (shortfallConstraint?.type === "soft_linear") {
      expect(shortfallConstraint.stage).toBe(TARGET_PEAK_CONCURRENT_ASSIGNMENTS_OBJECTIVE_STAGE_ID);
    }
  });
});
