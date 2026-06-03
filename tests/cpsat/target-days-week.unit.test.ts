import { describe, expect, it } from "vitest";
import {
  TargetDaysWeekSchema,
  type TargetDaysWeekConfig,
} from "../../src/cpsat/rules/target-days-week.js";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import { createBaseConfig } from "./helpers.js";

function createTargetDaysWeekRule(config: TargetDaysWeekConfig) {
  return TargetDaysWeekSchema.parse(config);
}

describe("CP-SAT target-days-week rule: schema validation", () => {
  it("accepts role-based scoping", () => {
    expect(() =>
      createTargetDaysWeekRule({
        days: 4,
        roleIds: ["stylist"],
        priority: "HIGH",
      }),
    ).not.toThrow();
  });

  it("defaults priority to HIGH", () => {
    const parsed = TargetDaysWeekSchema.parse({
      days: 4,
      roleIds: ["stylist"],
    });

    expect(parsed.priority).toBe("HIGH");
  });

  it("rejects MANDATORY priority", () => {
    expect(() =>
      TargetDaysWeekSchema.parse({
        days: 4,
        roleIds: ["stylist"],
        priority: "MANDATORY",
      }),
    ).toThrow(/Invalid option/);
  });
});

describe("CP-SAT target-days-week rule: compilation", () => {
  it("emits under and over soft constraints per scoped week", () => {
    const baseConfig = createBaseConfig({
      roleId: "stylist",
      memberIds: ["alice"],
      schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-11" } },
    });

    const builder = new ModelBuilder({
      ...baseConfig,
      ruleConfigs: [
        {
          name: "target-days-week",
          roleIds: ["stylist"],
          days: 4,
          priority: "HIGH",
        },
      ],
    });

    const { request } = builder.compile();
    const softConstraints = request.constraints.filter(
      (
        constraint,
      ): constraint is Extract<(typeof request.constraints)[number], { type: "soft_linear" }> =>
        constraint.type === "soft_linear" &&
        constraint.id?.startsWith("target-days-week:") === true,
    );

    expect(softConstraints).toHaveLength(2);
    expect(
      softConstraints.some((constraint) => constraint.id?.startsWith("target-days-week:under:")),
    ).toBe(true);
    expect(
      softConstraints.some((constraint) => constraint.id?.startsWith("target-days-week:over:")),
    ).toBe(true);
  });

  it("still emits an under-target constraint when a week has no assignable days", () => {
    const builder = new ModelBuilder({
      members: [{ id: "alice", roleIds: ["stylist"] }],
      shiftPatterns: [
        {
          id: "manager-day",
          roleIds: ["manager"],
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-11" } },
      coverage: [],
      ruleConfigs: [
        {
          name: "target-days-week",
          roleIds: ["stylist"],
          days: 4,
          priority: "HIGH",
        },
      ],
    });

    const { request } = builder.compile();
    const softConstraints = request.constraints.filter(
      (
        constraint,
      ): constraint is Extract<(typeof request.constraints)[number], { type: "soft_linear" }> =>
        constraint.type === "soft_linear" &&
        constraint.id?.startsWith("target-days-week:") === true,
    );
    const underConstraint = softConstraints.find((constraint) =>
      constraint.id?.startsWith("target-days-week:under:"),
    );
    const overConstraint = softConstraints.find((constraint) =>
      constraint.id?.startsWith("target-days-week:over:"),
    );

    expect(softConstraints).toHaveLength(2);
    expect(underConstraint?.rhs).toBe(4);
    expect(underConstraint?.terms).toHaveLength(7);
    expect(overConstraint?.rhs).toBe(4);
    expect(overConstraint?.terms).toHaveLength(7);
  });
});
