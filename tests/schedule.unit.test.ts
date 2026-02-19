import { describe, it, expect } from "vitest";
import {
  defineSchedule,
  t,
  time,
  cover,
  shift,
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
    const result = time({ start: t(12), end: t(15) });
    expect(result).toEqual({
      startTime: { hours: 12, minutes: 0 },
      endTime: { hours: 15, minutes: 0 },
    });
  });

  it("creates SemanticTimeVariant[] from multiple entries", () => {
    const result = time(
      { start: t(17), end: t(21) },
      { start: t(18), end: t(22), dayOfWeek: weekend },
    );
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    const variants = result as unknown as Array<Record<string, unknown>>;
    expect(variants[0]).toEqual({ startTime: t(17), endTime: t(21) });
    expect(variants[1]).toEqual({ startTime: t(18), endTime: t(22), dayOfWeek: weekend });
  });

  it("creates variant array from a single scoped entry (no default)", () => {
    const result = time({ start: t(16), end: t(18), dayOfWeek: ["friday"] });
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });

  it("supports date-scoped entries", () => {
    const result = time(
      { start: t(17), end: t(21) },
      { start: t(15), end: t(19), dates: ["2024-12-24"] },
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
    expect(() => time({ start: t(12), end: t(15) }, { start: t(13), end: t(16) })).toThrow(
      "at most one default entry",
    );
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
    const entry = cover("lunch", "waiter", 1, { skills: ["senior"] });
    expect(entry.options.skills).toEqual(["senior"]);
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
    expect(sp.roles).toBeUndefined();
    expect(sp.dayOfWeek).toBeUndefined();
    expect(sp.locationId).toBeUndefined();
  });

  it("passes through options as flat fields", () => {
    const sp = shift("kitchen", t(6), t(14), {
      roles: ["chef", "prep_cook"],
      dayOfWeek: weekdays,
      locationId: "kitchen",
    });
    expect(sp.roles).toEqual(["chef", "prep_cook"]);
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
// defineSchedule() - validation
// ============================================================================

describe("defineSchedule() validation", () => {
  const minConfig = () => ({
    roles: ["waiter"] as const,
    times: { lunch: time({ start: t(12), end: t(15) }) },
    coverage: [cover("lunch", "waiter", 1)],
    shiftPatterns: [shift("lunch_shift", t(12), t(15))],
  });

  it("creates a ScheduleDefinition", () => {
    const def = defineSchedule(minConfig());
    expect(def).toHaveProperty("createSchedulerConfig");
    expect(typeof def.createSchedulerConfig).toBe("function");
  });

  it("throws if role and skill overlap", () => {
    expect(() =>
      defineSchedule({
        ...minConfig(),
        roles: ["waiter"] as const,
        skills: ["waiter"] as const,
      }),
    ).toThrow("both a role and a skill");
  });

  it("throws if shift pattern references unknown role", () => {
    expect(() =>
      defineSchedule({
        ...minConfig(),
        shiftPatterns: [shift("s", t(9), t(17), { roles: ["chef"] })],
      }),
    ).toThrow('unknown role "chef"');
  });

  it("throws if coverage references unknown target", () => {
    expect(() =>
      defineSchedule({
        roles: ["waiter"] as const,
        times: { lunch: time({ start: t(12), end: t(15) }) },
        coverage: [cover("lunch", "chef" as "waiter", 1)],
        shiftPatterns: [shift("s", t(12), t(15))],
      }),
    ).toThrow('unknown target "chef"');
  });

  it("throws if coverage OR group references non-role", () => {
    expect(() =>
      defineSchedule({
        roles: ["waiter"] as const,
        skills: ["senior"] as const,
        times: { lunch: time({ start: t(12), end: t(15) }) },
        // "senior" is a skill, not a role, so this should throw at runtime
        coverage: [cover("lunch", ["waiter", "senior"] as unknown as ["waiter", "waiter"], 1)],
        shiftPatterns: [shift("s", t(12), t(15))],
      }),
    ).toThrow("not a declared role");
  });

  it("throws if coverage skill filter references unknown skill", () => {
    expect(() =>
      defineSchedule({
        roles: ["waiter"] as const,
        skills: ["senior"] as const,
        times: { lunch: time({ start: t(12), end: t(15) }) },
        coverage: [cover("lunch", "waiter", 1, { skills: ["unknown" as "senior"] })],
        shiftPatterns: [shift("s", t(12), t(15))],
      }),
    ).toThrow('skill filter "unknown"');
  });
});

// ============================================================================
// defineSchedule().createSchedulerConfig() - translation
// ============================================================================

describe("createSchedulerConfig()", () => {
  const schedule = defineSchedule({
    roles: ["waiter", "runner", "manager"],
    skills: ["senior", "keyholder"],

    times: {
      lunch: time({ start: t(12), end: t(15) }),
      dinner: time({ start: t(17), end: t(21) }, { start: t(18), end: t(22), dayOfWeek: weekend }),
    },

    coverage: [
      cover("lunch", "waiter", 2, { dayOfWeek: weekdays }),
      cover("lunch", "waiter", 3, { dayOfWeek: weekend }),
      cover("lunch", "manager", 1),
      cover("dinner", ["manager", "runner"] as const, 1),
      cover("dinner", "keyholder", 1),
      cover("lunch", "waiter", 1, { skills: ["senior"] }),
    ],

    shiftPatterns: [
      shift("morning", t(11, 30), t(15)),
      shift("evening", t(17), t(22)),
      shift("full_day", t(11, 30), t(22)),
      shift("kitchen", t(6), t(14), { roles: ["runner"], locationId: "kitchen" }),
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

  const members = [
    { id: "alice", roles: ["waiter"], skills: ["senior"] },
    { id: "bob", roles: ["waiter"] },
    { id: "charlie", roles: ["runner"] },
    { id: "mauro", roles: ["manager"], skills: ["keyholder"] },
  ];

  const period = {
    dateRange: { start: "2025-02-03", end: "2025-02-09" },
  };

  it("produces a ModelBuilderConfig", () => {
    const config = schedule.createSchedulerConfig({
      schedulingPeriod: period,
      members,
    });

    expect(config.members).toHaveLength(4);
    expect(config.shiftPatterns).toHaveLength(4);
    expect(config.weekStartsOn).toBe("monday");
  });

  it("translates members correctly", () => {
    const config = schedule.createSchedulerConfig({
      schedulingPeriod: period,
      members,
    });

    expect(config.members[0]).toEqual({
      id: "alice",
      roles: ["waiter"],
      skills: ["senior"],
    });
    expect(config.members[3]).toEqual({
      id: "mauro",
      roles: ["manager"],
      skills: ["keyholder"],
    });
  });

  it("translates shift patterns correctly", () => {
    const config = schedule.createSchedulerConfig({
      schedulingPeriod: period,
      members,
    });

    const kitchen = config.shiftPatterns.find((p) => p.id === "kitchen");
    expect(kitchen).toBeDefined();
    expect(kitchen!.roles).toEqual(["runner"]);
    expect(kitchen!.locationId).toBe("kitchen");
  });

  it("resolves coverage to concrete requirements", () => {
    const config = schedule.createSchedulerConfig({
      schedulingPeriod: period,
      members,
    });

    // Should have concrete coverage for each day
    expect(config.coverage.length).toBeGreaterThan(0);

    // Check that all coverage entries have required fields
    for (const cov of config.coverage) {
      expect(cov.day).toBeDefined();
      expect(cov.startTime).toBeDefined();
      expect(cov.endTime).toBeDefined();
      expect(cov.targetCount).toBeGreaterThan(0);
      expect(cov.priority).toBeDefined();
    }
  });

  it("translates rules with appliesTo role scope", () => {
    const config = schedule.createSchedulerConfig({
      schedulingPeriod: period,
      members,
    });

    const maxHoursWeekRules = config.ruleConfigs!.filter((r) => r.name === "max-hours-week");
    expect(maxHoursWeekRules.length).toBe(2);

    // Global rule
    const globalRule = maxHoursWeekRules.find(
      (r) => !("roleIds" in r) && !("skillIds" in r) && !("memberIds" in r),
    );
    expect(globalRule).toBeDefined();

    // Scoped to "senior" skill
    const seniorRule = maxHoursWeekRules.find((r) => "skillIds" in r);
    expect(seniorRule).toBeDefined();
  });

  it("translates timeOff rules with required time scope", () => {
    const config = schedule.createSchedulerConfig({
      schedulingPeriod: period,
      members,
    });

    const timeOffRules = config.ruleConfigs!.filter((r) => r.name === "time-off");
    expect(timeOffRules.length).toBe(1);
    const rule = timeOffRules[0]!;
    expect(rule).toHaveProperty("dayOfWeek");
  });

  it("translates timeOff with from only", () => {
    const def = defineSchedule({
      roles: ["waiter"] as const,
      times: { lunch: time({ start: t(12), end: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [timeOff({ appliesTo: "alice", dayOfWeek: ["wednesday"], from: t(14) })],
    });

    const config = def.createSchedulerConfig({
      schedulingPeriod: period,
      members: [{ id: "alice", roles: ["waiter"] }],
    });

    const rule = config.ruleConfigs!.find((r) => r.name === "time-off")!;
    expect(rule).toHaveProperty("startTime", t(14));
    expect(rule).toHaveProperty("endTime", { hours: 23, minutes: 59 });
  });

  it("translates timeOff with until only", () => {
    const def = defineSchedule({
      roles: ["waiter"] as const,
      times: { lunch: time({ start: t(12), end: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [timeOff({ appliesTo: "alice", dayOfWeek: ["monday"], until: t(12) })],
    });

    const config = def.createSchedulerConfig({
      schedulingPeriod: period,
      members: [{ id: "alice", roles: ["waiter"] }],
    });

    const rule = config.ruleConfigs!.find((r) => r.name === "time-off")!;
    expect(rule).toHaveProperty("startTime", { hours: 0, minutes: 0 });
    expect(rule).toHaveProperty("endTime", t(12));
  });

  it("translates timeOff with both from and until", () => {
    const def = defineSchedule({
      roles: ["waiter"] as const,
      times: { lunch: time({ start: t(12), end: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [timeOff({ appliesTo: "bob", dayOfWeek: ["friday"], from: t(14), until: t(18) })],
    });

    const config = def.createSchedulerConfig({
      schedulingPeriod: period,
      members: [{ id: "bob", roles: ["waiter"] }],
    });

    const rule = config.ruleConfigs!.find((r) => r.name === "time-off")!;
    expect(rule).toHaveProperty("startTime", t(14));
    expect(rule).toHaveProperty("endTime", t(18));
  });

  it("translates assignTogether rules", () => {
    const config = schedule.createSchedulerConfig({
      schedulingPeriod: period,
      members,
    });

    const assignRules = config.ruleConfigs!.filter((r) => r.name === "assign-together");
    expect(assignRules.length).toBe(1);
  });

  it("translates preference rules", () => {
    const config = schedule.createSchedulerConfig({
      schedulingPeriod: period,
      members,
    });

    const prefRules = config.ruleConfigs!.filter((r) => r.name === "assignment-priority");
    expect(prefRules.length).toBe(1);
  });

  it("resolves appliesTo with member IDs", () => {
    const def = defineSchedule({
      roles: ["waiter"] as const,
      times: { lunch: time({ start: t(12), end: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [maxHoursPerDay(8, { appliesTo: "alice" })],
    });

    const config = def.createSchedulerConfig({
      schedulingPeriod: period,
      members: [{ id: "alice", roles: ["waiter"] }],
    });

    const rule = config.ruleConfigs!.find((r) => r.name === "max-hours-day");
    expect(rule).toBeDefined();
    expect(rule).toHaveProperty("memberIds", ["alice"]);
  });

  it("applies default priority of MANDATORY", () => {
    const def = defineSchedule({
      roles: ["waiter"] as const,
      times: { lunch: time({ start: t(12), end: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [maxHoursPerDay(8)],
    });

    const config = def.createSchedulerConfig({
      schedulingPeriod: period,
      members: [{ id: "alice", roles: ["waiter"] }],
    });

    const rule = config.ruleConfigs!.find((r) => r.name === "max-hours-day");
    expect(rule).toHaveProperty("priority", "MANDATORY");
  });

  it("merges runtime rules", () => {
    const def = defineSchedule({
      roles: ["waiter"] as const,
      times: { lunch: time({ start: t(12), end: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [maxHoursPerDay(10)],
    });

    const config = def.createSchedulerConfig({
      schedulingPeriod: period,
      members: [{ id: "alice", roles: ["waiter"] }],
      runtimeRules: [
        timeOff({
          appliesTo: "alice",
          dateRange: { start: "2025-02-05", end: "2025-02-07" },
        }),
      ],
    });

    expect(config.ruleConfigs!.length).toBe(2);
    const toRule = config.ruleConfigs!.find((r) => r.name === "time-off");
    expect(toRule).toBeDefined();
  });

  it("applies dayOfWeek filter from config", () => {
    const def = defineSchedule({
      roles: ["waiter"] as const,
      times: { lunch: time({ start: t(12), end: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    });

    const config = def.createSchedulerConfig({
      schedulingPeriod: {
        dateRange: { start: "2025-02-03", end: "2025-02-09" },
      },
      members: [{ id: "alice", roles: ["waiter"] }],
    });

    // The scheduling period should have the dayOfWeek filter
    expect(config.schedulingPeriod.dayOfWeek).toEqual([
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
    ]);
  });
});

// ============================================================================
// Runtime validation
// ============================================================================

describe("runtime validation", () => {
  const def = defineSchedule({
    roles: ["waiter"] as const,
    skills: ["senior"] as const,
    times: { lunch: time({ start: t(12), end: t(15) }) },
    coverage: [cover("lunch", "waiter", 1)],
    shiftPatterns: [shift("s", t(12), t(15))],
    rules: [maxHoursPerDay(8, { appliesTo: "waiter" })],
  });

  const period = { dateRange: { start: "2025-02-03", end: "2025-02-09" } };

  it("throws if member ID collides with a role", () => {
    expect(() =>
      def.createSchedulerConfig({
        schedulingPeriod: period,
        members: [{ id: "waiter", roles: ["waiter"] }],
      }),
    ).toThrow("collides with a declared role");
  });

  it("throws if member ID collides with a skill", () => {
    expect(() =>
      def.createSchedulerConfig({
        schedulingPeriod: period,
        members: [{ id: "senior", roles: ["waiter"] }],
      }),
    ).toThrow("collides with a declared skill");
  });

  it("throws if appliesTo target is unknown", () => {
    const def2 = defineSchedule({
      roles: ["waiter"] as const,
      times: { lunch: time({ start: t(12), end: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [maxHoursPerDay(8, { appliesTo: "nonexistent" })],
    });

    expect(() =>
      def2.createSchedulerConfig({
        schedulingPeriod: period,
        members: [{ id: "alice", roles: ["waiter"] }],
      }),
    ).toThrow('appliesTo target "nonexistent"');
  });

  it("throws if appliesTo spans multiple namespaces", () => {
    const def2 = defineSchedule({
      roles: ["waiter"] as const,
      skills: ["senior"] as const,
      times: { lunch: time({ start: t(12), end: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [maxHoursPerDay(8, { appliesTo: ["waiter", "senior"] })],
    });

    expect(() =>
      def2.createSchedulerConfig({
        schedulingPeriod: period,
        members: [{ id: "alice", roles: ["waiter"], skills: ["senior"] }],
      }),
    ).toThrow("span multiple namespaces");
  });

  it("throws if assignTogether references unknown member ID", () => {
    const def2 = defineSchedule({
      roles: ["waiter"] as const,
      times: { lunch: time({ start: t(12), end: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [assignTogether(["alice", "bbo"], { priority: "HIGH" })],
    });

    expect(() =>
      def2.createSchedulerConfig({
        schedulingPeriod: period,
        members: [
          { id: "alice", roles: ["waiter"] },
          { id: "bob", roles: ["waiter"] },
        ],
      }),
    ).toThrow('unknown member "bbo"');
  });

  it("throws if member references unknown role", () => {
    expect(() =>
      def.createSchedulerConfig({
        schedulingPeriod: period,
        members: [{ id: "alice", roles: ["waitr"] }],
      }),
    ).toThrow('unknown role "waitr"');
  });

  it("throws if member references unknown skill", () => {
    expect(() =>
      def.createSchedulerConfig({
        schedulingPeriod: period,
        members: [{ id: "alice", roles: ["waiter"], skills: ["senoir"] }],
      }),
    ).toThrow('unknown skill "senoir"');
  });

  it("throws on duplicate member IDs", () => {
    expect(() =>
      def.createSchedulerConfig({
        schedulingPeriod: period,
        members: [
          { id: "alice", roles: ["waiter"] },
          { id: "alice", roles: ["waiter"] },
        ],
      }),
    ).toThrow('Duplicate member ID "alice"');
  });

  it("throws if timeOff has no time scope", () => {
    const def2 = defineSchedule({
      roles: ["waiter"] as const,
      times: { lunch: time({ start: t(12), end: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [timeOff({ appliesTo: "alice" })],
    });

    expect(() =>
      def2.createSchedulerConfig({
        schedulingPeriod: period,
        members: [{ id: "alice", roles: ["waiter"] }],
      }),
    ).toThrow("requires at least one time scope");
  });
});

// ============================================================================
// Full end-to-end: config structure matches what ModelBuilder expects
// ============================================================================

describe("end-to-end config structure", () => {
  it("produces a config compatible with ModelBuilder", () => {
    const def = defineSchedule({
      roles: ["waiter", "manager"],
      skills: ["senior"],

      times: {
        lunch: time({ start: t(12), end: t(15) }),
      },

      coverage: [cover("lunch", "waiter", 2), cover("lunch", "senior", 1)],

      shiftPatterns: [shift("lunch_shift", t(12), t(15))],

      rules: [maxHoursPerDay(10), maxHoursPerWeek(48), minRestBetweenShifts(10)],
    });

    const config = def.createSchedulerConfig({
      schedulingPeriod: {
        dateRange: { start: "2025-02-10", end: "2025-02-14" },
      },
      members: [
        { id: "alice", roles: ["waiter"], skills: ["senior"] },
        { id: "bob", roles: ["waiter"] },
        { id: "charlie", roles: ["manager"] },
      ],
    });

    // Verify structure
    expect(config.members).toHaveLength(3);
    expect(config.shiftPatterns).toHaveLength(1);
    expect(config.shiftPatterns[0]!.id).toBe("lunch_shift");
    expect(config.coverage.length).toBeGreaterThan(0);
    expect(config.ruleConfigs).toHaveLength(3);
    expect(config.ruleConfigs![0]!.name).toBe("max-hours-day");
    expect(config.ruleConfigs![1]!.name).toBe("max-hours-week");
    expect(config.ruleConfigs![2]!.name).toBe("min-rest-between-shifts");

    // Verify coverage has skill-based entries
    const skillCoverage = config.coverage.filter(
      (c) => "skills" in c && c.skills?.includes("senior"),
    );
    expect(skillCoverage.length).toBeGreaterThan(0);
  });
});
