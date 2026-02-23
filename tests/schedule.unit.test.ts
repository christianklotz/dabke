import { describe, it, expect } from "vitest";
import {
  schedule,
  partialSchedule,
  Schedule,
  t,
  time,
  cover,
  shift,
  defineRule,
  maxHoursPerDay,
  maxHoursPerWeek,
  minHoursPerDay,
  minHoursPerWeek,
  maxShiftsPerDay,
  maxConsecutiveDays,
  minConsecutiveDays,
  minRestBetweenShifts,
  preference,
  preferLocation,
  timeOff,
  assignTogether,
  weekdays,
  weekend,
} from "../src/schedule.js";
import type { RuleEntry } from "../src/schedule.js";

// ============================================================================
// t() helper
// ============================================================================

describe("t()", () => {
  it("creates TimeOfDay with hours only", () => {
    expect(t(9)).toEqual({ hours: 9, minutes: 0 });
  });

  it("creates TimeOfDay with hours and minutes", () => {
    expect(t(17, 30)).toEqual({ hours: 17, minutes: 30 });
  });
});

// ============================================================================
// Constants
// ============================================================================

describe("weekdays / weekend", () => {
  it("weekdays is Mon-Fri", () => {
    expect(weekdays).toEqual(["monday", "tuesday", "wednesday", "thursday", "friday"]);
  });

  it("weekend is Sat-Sun", () => {
    expect(weekend).toEqual(["saturday", "sunday"]);
  });
});

// ============================================================================
// time()
// ============================================================================

describe("time()", () => {
  it("creates a simple SemanticTimeDef from a single entry", () => {
    const result = time({ startTime: t(12), endTime: t(15) });
    expect(result).toEqual({
      startTime: { hours: 12, minutes: 0 },
      endTime: { hours: 15, minutes: 0 },
    });
  });

  it("creates SemanticTimeVariant[] from multiple entries", () => {
    const result = time(
      { startTime: t(17), endTime: t(21) },
      { startTime: t(18), endTime: t(22), dayOfWeek: weekend },
    );
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    const variants = result as unknown as Array<Record<string, unknown>>;
    expect(variants[0]).toEqual({ startTime: t(17), endTime: t(21) });
    expect(variants[1]).toEqual({ startTime: t(18), endTime: t(22), dayOfWeek: weekend });
  });

  it("creates variant array from a single scoped entry (no default)", () => {
    const result = time({ startTime: t(16), endTime: t(18), dayOfWeek: ["friday"] });
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });

  it("supports date-scoped entries", () => {
    const result = time(
      { startTime: t(17), endTime: t(21) },
      { startTime: t(15), endTime: t(19), dates: ["2024-12-24"] },
    );
    expect(Array.isArray(result)).toBe(true);
    const variants = result as unknown as Array<Record<string, unknown>>;
    expect(variants[1]).toEqual({
      startTime: t(15),
      endTime: t(19),
      dates: ["2024-12-24"],
    });
  });

  it("throws on multiple default entries", () => {
    expect(() =>
      time({ startTime: t(12), endTime: t(15) }, { startTime: t(13), endTime: t(16) }),
    ).toThrow("at most one default entry");
  });
});

// ============================================================================
// cover()
// ============================================================================

describe("cover()", () => {
  it("creates a coverage entry with defaults", () => {
    const entry = cover("lunch", "waiter", 2);
    expect(entry._type).toBe("coverage");
    expect(entry.timeName).toBe("lunch");
    expect(entry.target).toBe("waiter");
    expect(entry.count).toBe(2);
    expect(entry.options).toEqual({});
  });

  it("passes through options", () => {
    const entry = cover("lunch", "waiter", 3, {
      dayOfWeek: weekend,
      priority: "HIGH",
    });
    expect(entry.options.dayOfWeek).toEqual(weekend);
    expect(entry.options.priority).toBe("HIGH");
  });

  it("supports array target for OR logic", () => {
    const entry = cover("lunch", ["manager", "supervisor"], 1);
    expect(entry.target).toEqual(["manager", "supervisor"]);
  });

  it("supports skills option", () => {
    const entry = cover("lunch", "waiter", 1, { skillIds: ["senior"] });
    expect(entry.options.skillIds).toEqual(["senior"]);
  });

  it("creates a variant coverage entry", () => {
    const entry = cover("dinner", "waiter", { count: 3 }, { count: 1, dates: ["2025-12-24"] });
    expect(entry._type).toBe("coverage");
    expect(entry.timeName).toBe("dinner");
    expect(entry.target).toBe("waiter");
    expect(entry.variants).toHaveLength(2);
    expect(entry.variants![0]).toEqual({ count: 3 });
    expect(entry.variants![1]).toEqual({ count: 1, dates: ["2025-12-24"] });
  });

  it("creates variant entry with dayOfWeek scoping", () => {
    const entry = cover(
      "dinner",
      "waiter",
      { count: 2, dayOfWeek: weekdays },
      { count: 4, dayOfWeek: weekend },
      { count: 6, dates: ["2025-12-31"] },
    );
    expect(entry.variants).toHaveLength(3);
  });

  it("creates variant entry with array target", () => {
    const entry = cover(
      "lunch",
      ["manager", "supervisor"],
      { count: 1 },
      { count: 2, dayOfWeek: weekend },
    );
    expect(entry.target).toEqual(["manager", "supervisor"]);
    expect(entry.variants).toHaveLength(2);
  });

  it("throws on multiple default variants", () => {
    expect(() => cover("lunch", "waiter", { count: 2 }, { count: 3 })).toThrow(
      "at most one default variant",
    );
  });

  it("allows a single default variant", () => {
    const entry = cover("lunch", "waiter", { count: 2 });
    expect(entry.variants).toHaveLength(1);
    expect(entry.variants![0]).toEqual({ count: 2 });
  });

  it("allows no default variant (scoped-only)", () => {
    const entry = cover(
      "lunch",
      "waiter",
      { count: 2, dayOfWeek: weekdays },
      { count: 3, dayOfWeek: weekend },
    );
    expect(entry.variants).toHaveLength(2);
  });
});

// ============================================================================
// shift()
// ============================================================================

describe("shift()", () => {
  it("creates a shift pattern", () => {
    const sp = shift("morning", t(11, 30), t(15));
    expect(sp.id).toBe("morning");
    expect(sp.startTime).toEqual(t(11, 30));
    expect(sp.endTime).toEqual(t(15));
    expect(sp.roleIds).toBeUndefined();
    expect(sp.dayOfWeek).toBeUndefined();
    expect(sp.locationId).toBeUndefined();
  });

  it("passes through options as flat fields", () => {
    const sp = shift("kitchen", t(6), t(14), {
      roleIds: ["chef", "prep_cook"],
      dayOfWeek: weekdays,
      locationId: "kitchen",
    });
    expect(sp.roleIds).toEqual(["chef", "prep_cook"]);
    expect(sp.dayOfWeek).toEqual(weekdays);
    expect(sp.locationId).toBe("kitchen");
  });
});

// ============================================================================
// Rule functions
// ============================================================================

describe("rule functions", () => {
  it("maxHoursPerDay creates a rule entry", () => {
    const rule = maxHoursPerDay(10);
    expect(rule._type).toBe("rule");
    expect(rule._rule).toBe("max-hours-day");
    expect(rule.hours).toBe(10);
  });

  it("maxHoursPerWeek with scoping", () => {
    const rule = maxHoursPerWeek(20, { appliesTo: "student" });
    expect(rule._rule).toBe("max-hours-week");
    expect(rule.hours).toBe(20);
    expect(rule.appliesTo).toBe("student");
  });

  it("minHoursPerDay", () => {
    const rule = minHoursPerDay(6);
    expect(rule._rule).toBe("min-hours-day");
    expect(rule.hours).toBe(6);
  });

  it("minHoursPerWeek", () => {
    const rule = minHoursPerWeek(30, { priority: "HIGH" });
    expect(rule._rule).toBe("min-hours-week");
    expect(rule.hours).toBe(30);
    expect(rule.priority).toBe("HIGH");
  });

  it("maxShiftsPerDay", () => {
    const rule = maxShiftsPerDay(1);
    expect(rule._rule).toBe("max-shifts-day");
    expect(rule.shifts).toBe(1);
  });

  it("maxConsecutiveDays", () => {
    const rule = maxConsecutiveDays(5);
    expect(rule._rule).toBe("max-consecutive-days");
    expect(rule.days).toBe(5);
  });

  it("minConsecutiveDays", () => {
    const rule = minConsecutiveDays(3);
    expect(rule._rule).toBe("min-consecutive-days");
    expect(rule.days).toBe(3);
  });

  it("minRestBetweenShifts", () => {
    const rule = minRestBetweenShifts(10);
    expect(rule._rule).toBe("min-rest-between-shifts");
    expect(rule.hours).toBe(10);
  });

  it("preference", () => {
    const rule = preference("high", { appliesTo: "waiter" });
    expect(rule._rule).toBe("assignment-priority");
    expect(rule.preference).toBe("high");
    expect(rule.appliesTo).toBe("waiter");
  });

  it("preferLocation", () => {
    const rule = preferLocation("terrace", { appliesTo: "alice" });
    expect(rule._rule).toBe("location-preference");
    expect(rule.locationId).toBe("terrace");
    expect(rule.appliesTo).toBe("alice");
  });

  it("timeOff with dayOfWeek", () => {
    const rule = timeOff({ appliesTo: "mauro", dayOfWeek: weekend });
    expect(rule._rule).toBe("time-off");
    expect(rule.appliesTo).toBe("mauro");
    expect(rule.dayOfWeek).toEqual(weekend);
  });

  it("timeOff with partial day (from)", () => {
    const rule = timeOff({ appliesTo: "student", dayOfWeek: ["wednesday"], from: t(14) });
    expect(rule.from).toEqual(t(14));
  });

  it("timeOff with partial day (until)", () => {
    const rule = timeOff({ appliesTo: "alice", dayOfWeek: ["monday"], until: t(12) });
    expect(rule.until).toEqual(t(12));
  });

  it("timeOff with both from and until", () => {
    const rule = timeOff({ appliesTo: "bob", dayOfWeek: ["friday"], from: t(14), until: t(18) });
    expect(rule.from).toEqual(t(14));
    expect(rule.until).toEqual(t(18));
  });

  it("assignTogether", () => {
    const rule = assignTogether(["alice", "bob"], { priority: "HIGH" });
    expect(rule._rule).toBe("assign-together");
    expect(rule.members).toEqual(["alice", "bob"]);
    expect(rule.priority).toBe("HIGH");
  });
});

// ============================================================================
// defineRule
// ============================================================================

/** No-op rule factory for testing custom rule registration. */
function noopFactory(_config: Record<string, unknown>) {
  return { compile() {} };
}

describe("defineRule()", () => {
  function debugRule(flag: boolean): RuleEntry {
    return defineRule("debug", { flag });
  }

  it("creates a RuleEntry with _type and _rule", () => {
    const rule = debugRule(true);
    expect(rule._type).toBe("rule");
    expect(rule._rule).toBe("debug");
    expect(rule.flag).toBe(true);
  });

  it("passes through fields", () => {
    const rule = defineRule("debug", { flag: true, count: 5, label: "test" });
    expect(rule.flag).toBe(true);
    expect(rule.count).toBe(5);
    expect(rule.label).toBe("test");
  });

  it("custom rule compiles with registered factory", () => {
    let factoryCalled = false;
    const s = schedule({
      roleIds: ["waiter"],
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [debugRule(true)],
      ruleFactories: {
        debug: (config) => {
          factoryCalled = true;
          expect(config.flag).toBe(true);
          return { compile() {} };
        },
      },
    });
    const compiled = s
      .with([{ id: "alice", roleIds: ["waiter"] }])
      .compile({ dateRange: { start: "2025-02-03", end: "2025-02-07" } });
    expect(compiled.canSolve).toBe(true);
    expect(factoryCalled).toBe(true);
  });

  it("custom rule with resolver", () => {
    let resolverCalled = false;
    const rule = defineRule("debug", { flag: true }, (ctx) => {
      resolverCalled = true;
      expect(ctx.roles).toContain("waiter");
      expect(ctx.memberIds).toContain("alice");
      return { name: "debug", flag: true, priority: "MANDATORY" };
    });

    const s = schedule({
      roleIds: ["waiter"],
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [rule],
      ruleFactories: { debug: noopFactory },
    });
    s.with([{ id: "alice", roleIds: ["waiter"] }]).compile({
      dateRange: { start: "2025-02-03", end: "2025-02-07" },
    });
    expect(resolverCalled).toBe(true);
  });

  it("custom rule without resolver uses default appliesTo resolution", () => {
    let capturedConfig: Record<string, unknown> | undefined;
    const rule = defineRule("debug", { flag: true, appliesTo: "waiter", priority: "MANDATORY" });

    const s = schedule({
      roleIds: ["waiter"],
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [rule],
      ruleFactories: {
        debug: (config) => {
          capturedConfig = config;
          return { compile() {} };
        },
      },
    });
    s.with([{ id: "alice", roleIds: ["waiter"] }]).compile({
      dateRange: { start: "2025-02-03", end: "2025-02-07" },
    });
    expect(capturedConfig).toBeDefined();
    // appliesTo "waiter" resolved through scoping to concrete memberIds
    expect(capturedConfig!.memberIds).toEqual(["alice"]);
    // appliesTo itself is stripped
    expect(capturedConfig!.appliesTo).toBeUndefined();
  });

  it("custom rules compose with built-in rules", () => {
    const s = schedule({
      roleIds: ["waiter"],
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [maxHoursPerDay(10), debugRule(true)],
      ruleFactories: { debug: noopFactory },
    });
    const compiled = s
      .with([{ id: "alice", roleIds: ["waiter"] }])
      .compile({ dateRange: { start: "2025-02-03", end: "2025-02-07" } });
    expect(compiled.canSolve).toBe(true);
    // Built-in max-hours-day + custom debug rule
    expect(compiled.builder.rules.length).toBeGreaterThanOrEqual(2);
  });

  it("custom factories merge across schedules", () => {
    const base = partialSchedule({
      roleIds: ["waiter"],
      ruleFactories: { debug: noopFactory },
    });
    const extra = partialSchedule({
      rules: [debugRule(false)],
      ruleFactories: { debug: noopFactory },
    });
    // Same factory reference — merges fine
    const merged = base.with(extra);
    expect(merged.ruleNames).toContain("debug");
  });

  it("throws on conflicting factory registrations", () => {
    const a = partialSchedule({
      roleIds: ["waiter"],
      ruleFactories: { debug: noopFactory },
    });
    const b = partialSchedule({
      ruleFactories: { debug: () => ({ compile() {} }) },
    });
    expect(() => a.with(b)).toThrow('Rule factory "debug" already registered');
  });

  it("throws if custom factory name collides with built-in", () => {
    expect(() =>
      partialSchedule({
        roleIds: ["waiter"],
        ruleFactories: { "max-hours-day": noopFactory },
      }),
    ).toThrow("conflicts with a built-in rule");
  });
});

// ============================================================================
// schedule() - validation
// ============================================================================

describe("schedule() validation", () => {
  const minConfig = () => ({
    roleIds: ["waiter"] as const,
    times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
    coverage: [cover("lunch", "waiter", 1)],
    shiftPatterns: [shift("lunch_shift", t(12), t(15))],
  });

  it("creates a Schedule", () => {
    const s = schedule(minConfig());
    expect(s).toBeInstanceOf(Schedule);
  });

  it("exposes inspection getters", () => {
    const s = schedule(minConfig());
    expect(s.roleIds).toEqual(["waiter"]);
    expect(s.skillIds).toEqual([]);
    expect(s.timeNames).toEqual(["lunch"]);
    expect(s.shiftPatternIds).toEqual(["lunch_shift"]);
  });

  it("throws if role and skill overlap", () => {
    expect(() =>
      schedule({
        ...minConfig(),
        roleIds: ["waiter"] as const,
        skillIds: ["waiter"] as const,
      }),
    ).toThrow("both a role and a skill");
  });

  it("throws if shift pattern references unknown role", () => {
    expect(() =>
      schedule({
        ...minConfig(),
        shiftPatterns: [shift("s", t(9), t(17), { roleIds: ["chef"] })],
      }),
    ).toThrow('unknown role "chef"');
  });

  it("throws if coverage references unknown target", () => {
    expect(() =>
      schedule({
        roleIds: ["waiter"] as const,
        times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
        coverage: [cover("lunch", "chef" as "waiter", 1)],
        shiftPatterns: [shift("s", t(12), t(15))],
      }),
    ).toThrow('unknown target "chef"');
  });

  it("throws if coverage OR group references non-role", () => {
    expect(() =>
      schedule({
        roleIds: ["waiter"] as const,
        skillIds: ["senior"] as const,
        times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
        coverage: [cover("lunch", ["waiter", "senior"] as unknown as ["waiter", "waiter"], 1)],
        shiftPatterns: [shift("s", t(12), t(15))],
      }),
    ).toThrow("not a declared role");
  });

  it("throws if coverage skill filter references unknown skill", () => {
    expect(() =>
      schedule({
        roleIds: ["waiter"] as const,
        skillIds: ["senior"] as const,
        times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
        coverage: [cover("lunch", "waiter", 1, { skillIds: ["unknown" as "senior"] })],
        shiftPatterns: [shift("s", t(12), t(15))],
      }),
    ).toThrow('skill filter "unknown"');
  });
});

// ============================================================================
// schedule().compile() - translation
// ============================================================================

describe("schedule().compile()", () => {
  const venue = schedule({
    roleIds: ["waiter", "runner", "manager"],
    skillIds: ["senior", "keyholder"],

    times: {
      lunch: time({ startTime: t(12), endTime: t(15) }),
      dinner: time(
        { startTime: t(17), endTime: t(21) },
        { startTime: t(18), endTime: t(22), dayOfWeek: weekend },
      ),
    },

    coverage: [
      cover("lunch", "waiter", 2, { dayOfWeek: weekdays }),
      cover("lunch", "waiter", 3, { dayOfWeek: weekend }),
      cover("lunch", "manager", 1),
      cover("dinner", ["manager", "runner"] as const, 1),
      cover("dinner", "keyholder", 1),
      cover("lunch", "waiter", 1, { skillIds: ["senior"] }),
    ],

    shiftPatterns: [
      shift("morning", t(11, 30), t(15)),
      shift("evening", t(17), t(22)),
      shift("full_day", t(11, 30), t(22)),
      shift("kitchen", t(6), t(14), { roleIds: ["runner"], locationId: "kitchen" }),
    ],

    rules: [
      maxHoursPerDay(10),
      maxHoursPerWeek(48),
      maxHoursPerWeek(20, { appliesTo: "senior" }),
      minRestBetweenShifts(10),
      preference("high", { appliesTo: "waiter" }),
      timeOff({ appliesTo: "mauro", dayOfWeek: weekend }),
      assignTogether(["alice", "bob"], { priority: "HIGH" }),
    ],

    weekStartsOn: "monday",
  });

  const memberList = [
    { id: "alice", roleIds: ["waiter"], skillIds: ["senior"] },
    { id: "bob", roleIds: ["waiter"] },
    { id: "charlie", roleIds: ["runner"] },
    { id: "mauro", roleIds: ["manager"], skillIds: ["keyholder"] },
  ];

  const dateRange = { start: "2025-02-03", end: "2025-02-09" };

  it("produces a CompilationResult", () => {
    const ready = venue.with(memberList);
    const compiled = ready.compile({ dateRange });

    expect(compiled).toHaveProperty("request");
    expect(compiled).toHaveProperty("validation");
    expect(compiled).toHaveProperty("canSolve");
    expect(compiled).toHaveProperty("builder");
  });

  it("has correct shift patterns", () => {
    const ready = venue.with(memberList);
    const compiled = ready.compile({ dateRange });

    expect(compiled.builder.shiftPatterns).toHaveLength(4);
    const kitchen = compiled.builder.shiftPatterns.find((p) => p.id === "kitchen");
    expect(kitchen).toBeDefined();
    expect(kitchen!.roleIds).toEqual(["runner"]);
    expect(kitchen!.locationId).toBe("kitchen");
  });

  it("resolves coverage to concrete requirements", () => {
    const ready = venue.with(memberList);
    const compiled = ready.compile({ dateRange });

    expect(compiled.builder.coverage.length).toBeGreaterThan(0);

    for (const cov of compiled.builder.coverage) {
      expect(cov.day).toBeDefined();
      expect(cov.startTime).toBeDefined();
      expect(cov.endTime).toBeDefined();
      expect(cov.targetCount).toBeGreaterThan(0);
      expect(cov.priority).toBeDefined();
    }
  });

  it("applies dayOfWeek filter from config", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    });

    const ready = s.with([{ id: "alice", roleIds: ["waiter"] }]);
    const compiled = ready.compile({
      dateRange: { start: "2025-02-03", end: "2025-02-09" },
    });

    // Only weekdays should be in the days (5 days, not 7)
    expect(compiled.builder.days).toHaveLength(5);
  });
});

// ============================================================================
// .with() - merge behavior
// ============================================================================

describe(".with() merge behavior", () => {
  it("merges roles (union)", () => {
    const a = partialSchedule({ roleIds: ["waiter"] });
    const b = partialSchedule({ roleIds: ["bartender"] });
    const merged = a.with(b);
    expect(merged.roleIds).toContain("waiter");
    expect(merged.roleIds).toContain("bartender");
  });

  it("deduplicates roles", () => {
    const a = partialSchedule({ roleIds: ["waiter"] });
    const b = partialSchedule({ roleIds: ["waiter", "bartender"] });
    const merged = a.with(b);
    expect(merged.roleIds.filter((r) => r === "waiter")).toHaveLength(1);
  });

  it("merges skills (union)", () => {
    const a = partialSchedule({ roleIds: ["waiter"], skillIds: ["senior"] });
    const b = partialSchedule({ roleIds: ["bartender"], skillIds: ["keyholder"] });
    const merged = a.with(b);
    expect(merged.skillIds).toContain("senior");
    expect(merged.skillIds).toContain("keyholder");
  });

  it("errors on time name collision", () => {
    const a = partialSchedule({
      roleIds: ["waiter"],
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
    });
    const b = partialSchedule({
      roleIds: ["bartender"],
      times: { lunch: time({ startTime: t(11), endTime: t(14) }) },
    });
    expect(() => a.with(b)).toThrow('Time name "lunch"');
  });

  it("errors on shift pattern ID collision", () => {
    const a = partialSchedule({
      roleIds: ["waiter"],
      shiftPatterns: [shift("morning", t(8), t(14))],
    });
    const b = partialSchedule({
      roleIds: ["bartender"],
      shiftPatterns: [shift("morning", t(9), t(15))],
    });
    expect(() => a.with(b)).toThrow('Shift pattern ID "morning"');
  });

  it("errors on duplicate member ID", () => {
    const a = partialSchedule({
      roleIds: ["waiter"],
      members: [{ id: "alice", roleIds: ["waiter"] }],
    });
    expect(() => a.with([{ id: "alice", roleIds: ["waiter"] }])).toThrow(
      'Duplicate member ID "alice"',
    );
  });

  it("merges rules additively", () => {
    const a = partialSchedule({
      roleIds: ["waiter"],
      rules: [maxHoursPerDay(10)],
    });
    const b = partialSchedule({
      roleIds: ["waiter"],
      rules: [maxHoursPerWeek(48)],
    });
    const merged = a.with(b);
    expect(merged.ruleNames).toContain("max-hours-day");
    expect(merged.ruleNames).toContain("max-hours-week");
  });

  it("merges rules from another schedule", () => {
    const s = partialSchedule({ roleIds: ["waiter"] });
    const merged = s.with(partialSchedule({ rules: [maxHoursPerDay(10), maxHoursPerWeek(48)] }));
    expect(merged.ruleNames).toEqual(["max-hours-day", "max-hours-week"]);
  });

  it("merges shift patterns from another schedule", () => {
    const s = partialSchedule({ roleIds: ["waiter"] });
    const merged = s.with(partialSchedule({ shiftPatterns: [shift("morning", t(8), t(14))] }));
    expect(merged.shiftPatternIds).toEqual(["morning"]);
  });

  it("merges coverage from another schedule", () => {
    const base = schedule({
      roleIds: ["waiter"],
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      shiftPatterns: [shift("lunch_shift", t(12), t(15))],
      coverage: [cover("lunch", "waiter", 1)],
    });
    const extra = schedule({
      roleIds: ["waiter"],
      times: { dinner: time({ startTime: t(18), endTime: t(22) }) },
      coverage: [cover("dinner", "waiter", 2)],
      shiftPatterns: [shift("dinner_shift", t(18), t(22))],
    });
    const merged = base.with(extra);
    const ready = merged.with([
      { id: "alice", roleIds: ["waiter"] },
      { id: "bob", roleIds: ["waiter"] },
    ]);
    const compiled = ready.compile({ dateRange: { start: "2025-02-03", end: "2025-02-07" } });
    expect(compiled.canSolve).toBe(true);
  });

  it("does not mutate the original schedule", () => {
    const original = partialSchedule({ roleIds: ["waiter"] });
    const merged = original.with(partialSchedule({ roleIds: ["bartender"] }));
    expect(original.roleIds).toEqual(["waiter"]);
    expect(merged.roleIds).toContain("bartender");
  });

  it("errors on conflicting dayOfWeek", () => {
    const a = partialSchedule({ roleIds: ["waiter"], dayOfWeek: weekdays });
    const b = partialSchedule({ roleIds: ["bartender"], dayOfWeek: weekend });
    expect(() => a.with(b)).toThrow("different dayOfWeek filters");
  });

  it("accepts matching dayOfWeek", () => {
    const a = partialSchedule({ roleIds: ["waiter"], dayOfWeek: weekdays });
    const b = partialSchedule({ roleIds: ["bartender"], dayOfWeek: weekdays });
    const merged = a.with(b);
    expect(merged.roleIds).toContain("waiter");
    expect(merged.roleIds).toContain("bartender");
  });

  it("accepts matching dayOfWeek in different order", () => {
    const a = partialSchedule({
      roleIds: ["waiter"],
      dayOfWeek: ["monday", "wednesday", "friday"],
    });
    const b = partialSchedule({
      roleIds: ["bartender"],
      dayOfWeek: ["friday", "monday", "wednesday"],
    });
    const merged = a.with(b);
    expect(merged.roleIds).toContain("waiter");
    expect(merged.roleIds).toContain("bartender");
  });

  it("adopts dayOfWeek from incoming when base has none", () => {
    const a = partialSchedule({ roleIds: ["waiter"] });
    const b = partialSchedule({ roleIds: ["bartender"], dayOfWeek: weekdays });
    const merged = a.with(b);
    expect(merged.roleIds).toContain("bartender");
  });

  it("errors on conflicting weekStartsOn", () => {
    const a = partialSchedule({ roleIds: ["waiter"], weekStartsOn: "monday" });
    const b = partialSchedule({ roleIds: ["bartender"], weekStartsOn: "sunday" });
    expect(() => a.with(b)).toThrow("different weekStartsOn values");
  });

  it("accepts matching weekStartsOn", () => {
    const a = partialSchedule({ roleIds: ["waiter"], weekStartsOn: "monday" });
    const b = partialSchedule({ roleIds: ["bartender"], weekStartsOn: "monday" });
    const merged = a.with(b);
    expect(merged.roleIds).toContain("waiter");
    expect(merged.roleIds).toContain("bartender");
  });
});

// ============================================================================
// Composition patterns
// ============================================================================

describe("composition patterns", () => {
  it("reusable rule groups", () => {
    const laborLaw = partialSchedule({
      rules: [
        maxHoursPerDay(10),
        maxHoursPerWeek(48),
        minRestBetweenShifts(11),
        maxConsecutiveDays(6),
      ],
    });

    const venue = schedule({
      roleIds: ["waiter"],
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("lunch_shift", t(12), t(15))],
    });

    const full = venue.with(laborLaw);
    expect(full.ruleNames).toEqual([
      "max-hours-day",
      "max-hours-week",
      "min-rest-between-shifts",
      "max-consecutive-days",
    ]);
  });

  it("multi-area venue", () => {
    const bar = schedule({
      roleIds: ["bartender"],
      times: { happy_hour: time({ startTime: t(16), endTime: t(19) }) },
      coverage: [cover("happy_hour", "bartender", 2)],
      shiftPatterns: [shift("bar_shift", t(16), t(23))],
    });

    const dining = schedule({
      roleIds: ["waiter"],
      times: { dinner: time({ startTime: t(18), endTime: t(22) }) },
      coverage: [cover("dinner", "waiter", 5)],
      shiftPatterns: [shift("dinner_shift", t(17, 30), t(22, 30))],
    });

    const restaurant = partialSchedule({
      roleIds: ["manager"],
      rules: [maxHoursPerDay(10)],
    }).with(bar, dining);

    expect(restaurant.roleIds).toContain("manager");
    expect(restaurant.roleIds).toContain("bartender");
    expect(restaurant.roleIds).toContain("waiter");
    expect(restaurant.timeNames).toContain("happy_hour");
    expect(restaurant.timeNames).toContain("dinner");
    expect(restaurant.shiftPatternIds).toContain("bar_shift");
    expect(restaurant.shiftPatternIds).toContain("dinner_shift");
    expect(restaurant.ruleNames).toContain("max-hours-day");
  });
});

// ============================================================================
// Runtime validation (via .with())
// ============================================================================

describe("runtime validation", () => {
  const s = schedule({
    roleIds: ["waiter"] as const,
    skillIds: ["senior"] as const,
    times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
    coverage: [cover("lunch", "waiter", 1)],
    shiftPatterns: [shift("s", t(12), t(15))],
    rules: [maxHoursPerDay(8, { appliesTo: "waiter" })],
  });

  it("throws if member ID collides with a role", () => {
    expect(() => s.with([{ id: "waiter", roleIds: ["waiter"] }])).toThrow(
      "collides with a declared role",
    );
  });

  it("throws if member ID collides with a skill", () => {
    expect(() => s.with([{ id: "senior", roleIds: ["waiter"] }])).toThrow(
      "collides with a declared skill",
    );
  });

  it("throws if member references unknown role", () => {
    expect(() => s.with([{ id: "alice", roleIds: ["waitr"] }])).toThrow('unknown role "waitr"');
  });

  it("throws if member references unknown skill", () => {
    expect(() => s.with([{ id: "alice", roleIds: ["waiter"], skillIds: ["senoir"] }])).toThrow(
      'unknown skill "senoir"',
    );
  });

  it("throws on duplicate member IDs", () => {
    expect(() =>
      s.with([
        { id: "alice", roleIds: ["waiter"] },
        { id: "alice", roleIds: ["waiter"] },
      ]),
    ).toThrow('Duplicate member ID "alice"');
  });
});

// ============================================================================
// Compile-time rule validation
// ============================================================================

describe("compile-time rule validation", () => {
  it("throws if appliesTo target is unknown at compile time", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [maxHoursPerDay(8, { appliesTo: "nonexistent" })],
    });

    const ready = s.with([{ id: "alice", roleIds: ["waiter"] }]);
    expect(() => ready.compile({ dateRange: { start: "2025-02-03", end: "2025-02-09" } })).toThrow(
      'appliesTo target "nonexistent"',
    );
  });

  it("throws if appliesTo spans multiple namespaces at compile time", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      skillIds: ["senior"] as const,
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [maxHoursPerDay(8, { appliesTo: ["waiter", "senior"] })],
    });

    const ready = s.with([{ id: "alice", roleIds: ["waiter"], skillIds: ["senior"] }]);
    expect(() => ready.compile({ dateRange: { start: "2025-02-03", end: "2025-02-09" } })).toThrow(
      "span multiple namespaces",
    );
  });

  it("throws if assignTogether references unknown member ID at compile time", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [assignTogether(["alice", "bbo"], { priority: "HIGH" })],
    });

    const ready = s.with([
      { id: "alice", roleIds: ["waiter"] },
      { id: "bob", roleIds: ["waiter"] },
    ]);
    expect(() => ready.compile({ dateRange: { start: "2025-02-03", end: "2025-02-09" } })).toThrow(
      'unknown member "bbo"',
    );
  });

  it("throws if timeOff has no time scope at compile time", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [timeOff({ appliesTo: "alice" })],
    });

    const ready = s.with([{ id: "alice", roleIds: ["waiter"] }]);
    expect(() => ready.compile({ dateRange: { start: "2025-02-03", end: "2025-02-09" } })).toThrow(
      "requires at least one time scope",
    );
  });
});

// ============================================================================
// Full end-to-end: config structure matches what ModelBuilder expects
// ============================================================================

describe("end-to-end config structure", () => {
  it("produces a config compatible with ModelBuilder", () => {
    const s = schedule({
      roleIds: ["waiter", "manager"],
      skillIds: ["senior"],

      times: {
        lunch: time({ startTime: t(12), endTime: t(15) }),
      },

      coverage: [cover("lunch", "waiter", 2), cover("lunch", "senior", 1)],

      shiftPatterns: [shift("lunch_shift", t(12), t(15))],

      rules: [maxHoursPerDay(10), maxHoursPerWeek(48), minRestBetweenShifts(10)],
    });

    const ready = s.with([
      { id: "alice", roleIds: ["waiter"], skillIds: ["senior"] },
      { id: "bob", roleIds: ["waiter"] },
      { id: "charlie", roleIds: ["manager"] },
    ]);

    const compiled = ready.compile({
      dateRange: { start: "2025-02-10", end: "2025-02-14" },
    });

    expect(compiled.canSolve).toBe(true);
    expect(compiled.builder.members).toHaveLength(3);
    expect(compiled.builder.shiftPatterns).toHaveLength(1);
    expect(compiled.builder.shiftPatterns[0]!.id).toBe("lunch_shift");
    expect(compiled.builder.coverage.length).toBeGreaterThan(0);

    // Verify coverage has skill-based entries
    const skillCoverage = compiled.builder.coverage.filter(
      (c) => "skillIds" in c && c.skillIds?.includes("senior"),
    );
    expect(skillCoverage.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Variant coverage through schedule
// ============================================================================

describe("variant coverage", () => {
  it("resolves variant coverage through schedule", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { dinner: time({ startTime: t(17), endTime: t(22) }) },
      coverage: [cover("dinner", "waiter", { count: 3 }, { count: 1, dates: ["2025-02-05"] })],
      shiftPatterns: [shift("evening", t(17), t(22))],
    });

    const ready = s.with([
      { id: "alice", roleIds: ["waiter"] },
      { id: "bob", roleIds: ["waiter"] },
      { id: "charlie", roleIds: ["waiter"] },
    ]);

    const compiled = ready.compile({
      dateRange: { start: "2025-02-03", end: "2025-02-07" },
    });

    // 5 days of coverage
    expect(compiled.builder.coverage).toHaveLength(5);

    // Feb 5 should have count=1, all others count=3
    const feb5 = compiled.builder.coverage.find((c) => c.day === "2025-02-05");
    const others = compiled.builder.coverage.filter((c) => c.day !== "2025-02-05");

    expect(feb5?.targetCount).toBe(1);
    for (const c of others) {
      expect(c.targetCount).toBe(3);
    }
  });

  it("resolves variant with dayOfWeek scoping", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { dinner: time({ startTime: t(17), endTime: t(22) }) },
      coverage: [
        cover(
          "dinner",
          "waiter",
          { count: 2, dayOfWeek: weekdays },
          { count: 4, dayOfWeek: weekend },
        ),
      ],
      shiftPatterns: [shift("evening", t(17), t(22))],
    });

    const ready = s.with([
      { id: "a", roleIds: ["waiter"] },
      { id: "b", roleIds: ["waiter"] },
      { id: "c", roleIds: ["waiter"] },
      { id: "d", roleIds: ["waiter"] },
    ]);

    const compiled = ready.compile({
      dateRange: { start: "2025-02-03", end: "2025-02-09" },
    });

    const weekdayCoverage = compiled.builder.coverage.filter(
      (c) => c.day >= "2025-02-03" && c.day <= "2025-02-07",
    );
    const weekendCoverage = compiled.builder.coverage.filter(
      (c) => c.day === "2025-02-08" || c.day === "2025-02-09",
    );

    for (const c of weekdayCoverage) {
      expect(c.targetCount).toBe(2);
    }
    for (const c of weekendCoverage) {
      expect(c.targetCount).toBe(4);
    }
  });

  it("resolves variant with skill-only target", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      skillIds: ["keyholder"] as const,
      times: { opening: time({ startTime: t(6), endTime: t(8) }) },
      coverage: [cover("opening", "keyholder", { count: 1 }, { count: 2, dayOfWeek: weekend })],
      shiftPatterns: [shift("morning", t(6), t(8))],
    });

    const ready = s.with([
      { id: "alice", roleIds: ["waiter"], skillIds: ["keyholder"] },
      { id: "bob", roleIds: ["waiter"], skillIds: ["keyholder"] },
    ]);

    const compiled = ready.compile({
      dateRange: { start: "2025-02-07", end: "2025-02-08" },
    });

    expect(compiled.builder.coverage).toHaveLength(2);

    const fri = compiled.builder.coverage.find((c) => c.day === "2025-02-07");
    const sat = compiled.builder.coverage.find((c) => c.day === "2025-02-08");

    expect(fri?.targetCount).toBe(1);
    expect(sat?.targetCount).toBe(2);
    expect(fri?.skillIds).toEqual(["keyholder"]);
  });

  it("resolves variant with OR-role target", () => {
    const s = schedule({
      roleIds: ["manager", "supervisor"] as const,
      times: { service: time({ startTime: t(11), endTime: t(22) }) },
      coverage: [
        cover("service", ["manager", "supervisor"], { count: 1 }, { count: 2, dayOfWeek: weekend }),
      ],
      shiftPatterns: [shift("full", t(11), t(22))],
    });

    const ready = s.with([
      { id: "alice", roleIds: ["manager"] },
      { id: "bob", roleIds: ["supervisor"] },
    ]);

    const compiled = ready.compile({
      dateRange: { start: "2025-02-07", end: "2025-02-08" },
    });

    expect(compiled.builder.coverage).toHaveLength(2);

    const fri = compiled.builder.coverage.find((c) => c.day === "2025-02-07");
    const sat = compiled.builder.coverage.find((c) => c.day === "2025-02-08");

    expect(fri?.targetCount).toBe(1);
    expect(sat?.targetCount).toBe(2);
    expect(fri?.roleIds).toEqual(["manager", "supervisor"]);
  });

  it("emits no coverage for days without matching variant", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { dinner: time({ startTime: t(17), endTime: t(22) }) },
      coverage: [cover("dinner", "waiter", { count: 4, dayOfWeek: weekend })],
      shiftPatterns: [shift("evening", t(17), t(22))],
    });

    const ready = s.with([{ id: "alice", roleIds: ["waiter"] }]);

    const compiled = ready.compile({
      dateRange: { start: "2025-02-03", end: "2025-02-07" },
    });

    expect(compiled.builder.coverage).toHaveLength(0);
  });

  it("can mix variant and simple coverage for different roles", () => {
    const s = schedule({
      roleIds: ["waiter", "manager"] as const,
      times: { dinner: time({ startTime: t(17), endTime: t(22) }) },
      coverage: [
        cover("dinner", "waiter", { count: 2 }, { count: 4, dayOfWeek: weekend }),
        cover("dinner", "manager", 1),
      ],
      shiftPatterns: [shift("evening", t(17), t(22))],
    });

    const ready = s.with([
      { id: "a", roleIds: ["waiter"] },
      { id: "b", roleIds: ["waiter"] },
      { id: "c", roleIds: ["waiter"] },
      { id: "d", roleIds: ["waiter"] },
      { id: "m", roleIds: ["manager"] },
    ]);

    const compiled = ready.compile({
      dateRange: { start: "2025-02-07", end: "2025-02-08" },
    });

    // Variant waiter coverage: 2 entries (one per day)
    // Simple manager coverage: 2 entries (one per day)
    expect(compiled.builder.coverage).toHaveLength(4);

    const waiterFri = compiled.builder.coverage.find(
      (c) => c.day === "2025-02-07" && c.roleIds?.includes("waiter"),
    );
    const waiterSat = compiled.builder.coverage.find(
      (c) => c.day === "2025-02-08" && c.roleIds?.includes("waiter"),
    );
    const managerFri = compiled.builder.coverage.find(
      (c) => c.day === "2025-02-07" && c.roleIds?.includes("manager"),
    );

    expect(waiterFri?.targetCount).toBe(2);
    expect(waiterSat?.targetCount).toBe(4);
    expect(managerFri?.targetCount).toBe(1);
  });
});
