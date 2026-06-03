import { describe, expect, it } from "vitest";
import {
  cover,
  maxConcurrentAssignments,
  schedule,
  shift,
  t,
  time,
} from "../src/schedule/index.js";

describe("maxConcurrentAssignments", () => {
  it("creates a rule entry with full-day defaults", () => {
    const rule = maxConcurrentAssignments(5, { appliesTo: "chair_stylist" });
    expect(rule._rule).toBe("max-concurrent-assignments");
    expect(rule.assignments).toBe(5);
    expect(rule.appliesTo).toBe("chair_stylist");
  });

  it("supports partial-day windows", () => {
    const rule = maxConcurrentAssignments(2, {
      appliesTo: "stylist",
      startTime: t(10),
      endTime: t(19),
      priority: "HIGH",
    });
    expect(rule.startTime).toEqual(t(10));
    expect(rule.endTime).toEqual(t(19));
    expect(rule.priority).toBe("HIGH");
  });
});

describe("schedule compile with maxConcurrentAssignments", () => {
  it("accepts the helper in a const rules tuple", () => {
    const rules = [maxConcurrentAssignments(2, { appliesTo: "chair_stylist" })] as const;

    const s = schedule({
      roleIds: ["stylist"],
      skillIds: ["chair_stylist"],
      times: {
        trading: time({ startTime: t(10), endTime: t(19) }),
      },
      coverage: [cover("trading", "chair_stylist", 2)],
      shiftPatterns: [shift("day", t(10), t(19))],
      rules,
    });

    expect(s).toBeDefined();
  });

  it("compiles a schedule with a physical capacity cap", () => {
    const s = schedule({
      roleIds: ["stylist"],
      skillIds: ["chair_stylist"],
      times: {
        trading: time({ startTime: t(10), endTime: t(19) }),
      },
      coverage: [cover("trading", "chair_stylist", 2)],
      shiftPatterns: [shift("day", t(10), t(19))],
      rules: [maxConcurrentAssignments(2, { appliesTo: "chair_stylist" })],
    });

    const compiled = s
      .with([
        { id: "alice", roleIds: ["stylist"], skillIds: ["chair_stylist"] },
        { id: "bob", roleIds: ["stylist"], skillIds: ["chair_stylist"] },
      ])
      .compile({ dateRange: { start: "2025-02-03", end: "2025-02-03" } });

    expect(compiled.canSolve).toBe(true);
    expect(compiled.builder.rules.some((rule) => rule.rule === "max-concurrent-assignments")).toBe(
      true,
    );
  });
});
