import { describe, expect, it } from "vitest";
import { schedule, shift, t, targetDaysPerWeek, time, cover } from "../src/schedule/index.js";

describe("targetDaysPerWeek", () => {
  it("creates a rule entry with a soft priority target", () => {
    const rule = targetDaysPerWeek(4, {
      appliesTo: "stylist",
      priority: "HIGH",
    });

    expect(rule._rule).toBe("target-days-week");
    expect(rule.days).toBe(4);
    expect(rule.appliesTo).toBe("stylist");
    expect(rule.priority).toBe("HIGH");
  });
});

describe("schedule compile with targetDaysPerWeek", () => {
  it("accepts the helper in a const rules tuple", () => {
    const rules = [targetDaysPerWeek(4, { appliesTo: "stylist", priority: "HIGH" })] as const;

    const s = schedule({
      roleIds: ["stylist"],
      skillIds: [],
      times: {
        trading: time({ startTime: t(9), endTime: t(17) }),
      },
      coverage: [cover("trading", "stylist", 1)],
      shiftPatterns: [shift("day", t(9), t(17), { roleIds: ["stylist"] })],
      rules,
    });

    expect(s).toBeDefined();
  });

  it("compiles a schedule with a weekly day target", () => {
    const s = schedule({
      roleIds: ["stylist"],
      skillIds: [],
      times: {
        trading: time({ startTime: t(9), endTime: t(17) }),
      },
      coverage: [cover("trading", "stylist", 1)],
      shiftPatterns: [shift("day", t(9), t(17), { roleIds: ["stylist"] })],
      rules: [targetDaysPerWeek(4, { appliesTo: "stylist", priority: "HIGH" })],
    });

    const compiled = s
      .with([{ id: "alice", roleIds: ["stylist"] }])
      .compile({ dateRange: { start: "2025-02-03", end: "2025-02-09" } });

    expect(compiled.canSolve).toBe(true);
    expect(compiled.builder.rules.some((rule) => rule.rule === "target-days-week")).toBe(true);
  });
});
