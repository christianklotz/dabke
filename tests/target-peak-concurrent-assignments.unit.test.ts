import { describe, expect, it } from "vitest";
import {
  cover,
  maxConcurrentAssignments,
  schedule,
  shift,
  t,
  targetPeakConcurrentAssignments,
  time,
} from "../src/schedule/index.js";

describe("targetPeakConcurrentAssignments", () => {
  it("creates a rule entry with a soft priority target", () => {
    const rule = targetPeakConcurrentAssignments(5, {
      appliesTo: "chair_stylist",
      priority: "HIGH",
    });

    expect(rule._rule).toBe("target-peak-concurrent-assignments");
    expect(rule.assignments).toBe(5);
    expect(rule.appliesTo).toBe("chair_stylist");
    expect(rule.priority).toBe("HIGH");
  });

  it("supports day-level scoping", () => {
    const rule = targetPeakConcurrentAssignments(5, {
      appliesTo: "stylist",
      dayOfWeek: ["thursday"],
      priority: "MEDIUM",
    });

    expect(rule.dayOfWeek).toEqual(["thursday"]);
    expect(rule.priority).toBe("MEDIUM");
  });
});

describe("schedule compile with targetPeakConcurrentAssignments", () => {
  it("accepts the helper in a const rules tuple", () => {
    const rules = [
      maxConcurrentAssignments(5, { appliesTo: "chair_stylist" }),
      targetPeakConcurrentAssignments(5, { appliesTo: "chair_stylist", priority: "HIGH" }),
    ] as const;

    const s = schedule({
      roleIds: ["stylist"],
      skillIds: ["chair_stylist"],
      times: {
        opening: time({ startTime: t(10), endTime: t(11), dayOfWeek: ["thursday"] }),
        closing: time({ startTime: t(19), endTime: t(20), dayOfWeek: ["thursday"] }),
      },
      coverage: [cover("opening", "chair_stylist", 2), cover("closing", "chair_stylist", 2)],
      shiftPatterns: [
        shift("open", t(10), t(19), { roleIds: ["stylist"], dayOfWeek: ["thursday"] }),
        shift("close", t(11), t(20), { roleIds: ["stylist"], dayOfWeek: ["thursday"] }),
      ],
      rules,
    });

    expect(s).toBeDefined();
  });

  it("compiles a schedule with a peak concurrency target", () => {
    const s = schedule({
      roleIds: ["stylist"],
      skillIds: ["chair_stylist"],
      times: {
        opening: time({ startTime: t(10), endTime: t(11), dayOfWeek: ["thursday"] }),
        closing: time({ startTime: t(19), endTime: t(20), dayOfWeek: ["thursday"] }),
      },
      coverage: [cover("opening", "chair_stylist", 2), cover("closing", "chair_stylist", 2)],
      shiftPatterns: [
        shift("open", t(10), t(19), { roleIds: ["stylist"], dayOfWeek: ["thursday"] }),
        shift("close", t(11), t(20), { roleIds: ["stylist"], dayOfWeek: ["thursday"] }),
      ],
      rules: [
        maxConcurrentAssignments(5, { appliesTo: "chair_stylist" }),
        targetPeakConcurrentAssignments(5, {
          appliesTo: "chair_stylist",
          priority: "HIGH",
        }),
      ],
    });

    const compiled = s
      .with([
        { id: "alice", roleIds: ["stylist"], skillIds: ["chair_stylist"] },
        { id: "bob", roleIds: ["stylist"], skillIds: ["chair_stylist"] },
      ])
      .compile({ dateRange: { start: "2025-02-03", end: "2025-02-09" } });

    expect(compiled.canSolve).toBe(true);
    expect(
      compiled.builder.rules.some((rule) => rule.rule === "target-peak-concurrent-assignments"),
    ).toBe(true);
  });
});
