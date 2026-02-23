import { describe, it, expect } from "vitest";
import {
  schedule,
  t,
  time,
  cover,
  shift,
  minimizeCost,
  dayMultiplier,
  daySurcharge,
  timeSurcharge,
  overtimeMultiplier,
  overtimeSurcharge,
  dailyOvertimeMultiplier,
  dailyOvertimeSurcharge,
  tieredOvertimeMultiplier,
  weekend,
} from "../../src/index.js";
import { calculateScheduleCost, COST_CATEGORY } from "../../src/cpsat/cost.js";
import type { ShiftAssignment } from "../../src/cpsat/response.js";

// ============================================================================
// factory functions produce correct RuleEntry
// ============================================================================

describe("cost rule factory functions", () => {
  it("minimizeCost() produces correct RuleEntry", () => {
    const rule = minimizeCost();
    expect(rule._type).toBe("rule");
    expect(rule._rule).toBe("minimize-cost");
  });

  it("minimizeCost() with options", () => {
    const rule = minimizeCost({ dayOfWeek: ["monday", "tuesday"] });
    expect(rule._rule).toBe("minimize-cost");
    expect(rule.dayOfWeek).toEqual(["monday", "tuesday"]);
  });

  it("dayMultiplier() produces correct RuleEntry", () => {
    const rule = dayMultiplier(1.5, { dayOfWeek: weekend });
    expect(rule._type).toBe("rule");
    expect(rule._rule).toBe("day-cost-multiplier");
    expect(rule.factor).toBe(1.5);
    expect(rule.dayOfWeek).toEqual(weekend);
  });

  it("daySurcharge() produces correct RuleEntry", () => {
    const rule = daySurcharge(500, { dayOfWeek: weekend });
    expect(rule._type).toBe("rule");
    expect(rule._rule).toBe("day-cost-surcharge");
    expect(rule.amountPerHour).toBe(500);
  });

  it("timeSurcharge() produces correct RuleEntry", () => {
    const rule = timeSurcharge(200, { from: t(22), until: t(6) });
    expect(rule._type).toBe("rule");
    expect(rule._rule).toBe("time-cost-surcharge");
    expect(rule.amountPerHour).toBe(200);
    expect(rule.window).toEqual({ from: t(22), until: t(6) });
  });

  it("timeSurcharge() with options", () => {
    const rule = timeSurcharge(200, { from: t(22), until: t(6) }, { appliesTo: "alice" });
    expect(rule._rule).toBe("time-cost-surcharge");
    expect(rule.appliesTo).toBe("alice");
  });

  it("overtimeMultiplier() produces correct RuleEntry", () => {
    const rule = overtimeMultiplier({ after: 40, factor: 1.5 });
    expect(rule._type).toBe("rule");
    expect(rule._rule).toBe("overtime-weekly-multiplier");
    expect(rule.after).toBe(40);
    expect(rule.factor).toBe(1.5);
  });

  it("overtimeSurcharge() produces correct RuleEntry", () => {
    const rule = overtimeSurcharge({ after: 40, amount: 1000 });
    expect(rule._type).toBe("rule");
    expect(rule._rule).toBe("overtime-weekly-surcharge");
    expect(rule.after).toBe(40);
    expect(rule.amount).toBe(1000);
  });

  it("dailyOvertimeMultiplier() produces correct RuleEntry", () => {
    const rule = dailyOvertimeMultiplier({ after: 8, factor: 1.5 });
    expect(rule._type).toBe("rule");
    expect(rule._rule).toBe("overtime-daily-multiplier");
    expect(rule.after).toBe(8);
    expect(rule.factor).toBe(1.5);
  });

  it("dailyOvertimeSurcharge() produces correct RuleEntry", () => {
    const rule = dailyOvertimeSurcharge({ after: 8, amount: 500 });
    expect(rule._type).toBe("rule");
    expect(rule._rule).toBe("overtime-daily-surcharge");
    expect(rule.after).toBe(8);
    expect(rule.amount).toBe(500);
  });

  it("tieredOvertimeMultiplier() produces correct RuleEntry", () => {
    const rule = tieredOvertimeMultiplier([
      { after: 40, factor: 1.5 },
      { after: 48, factor: 2.0 },
    ]);
    expect(rule._type).toBe("rule");
    expect(rule._rule).toBe("overtime-tiered-multiplier");
    expect(rule.tiers).toEqual([
      { after: 40, factor: 1.5 },
      { after: 48, factor: 2.0 },
    ]);
  });
});

// ============================================================================
// Pay validation
// ============================================================================

describe("pay validation", () => {
  const dateRange = { start: "2026-02-09", end: "2026-02-15" };

  it("throws when cost rules present but members lack pay", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [minimizeCost()],
    });

    expect(() =>
      s
        .with([
          { id: "alice", roleIds: ["waiter"], pay: { hourlyRate: 2500 } },
          { id: "bob", roleIds: ["waiter"] },
        ])
        .compile({ dateRange }),
    ).toThrow("Missing pay: bob");
  });

  it("throws listing all members missing pay", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [dayMultiplier(1.5)],
    });

    expect(() =>
      s
        .with([
          { id: "alice", roleIds: ["waiter"] },
          { id: "bob", roleIds: ["waiter"] },
        ])
        .compile({ dateRange }),
    ).toThrow("Missing pay: alice, bob");
  });

  it("throws when overtime rules present but members lack pay", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [overtimeMultiplier({ after: 40, factor: 1.5 })],
    });

    expect(() => s.with([{ id: "alice", roleIds: ["waiter"] }]).compile({ dateRange })).toThrow(
      "Missing pay: alice",
    );
  });

  it("allows salaried pay with cost rules", () => {
    const s = schedule({
      roleIds: ["waiter", "manager"] as const,
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [minimizeCost()],
    });

    expect(() =>
      s
        .with([
          { id: "alice", roleIds: ["waiter"], pay: { hourlyRate: 2500 } },
          { id: "carol", roleIds: ["manager"], pay: { annual: 5200000, hoursPerWeek: 40 } },
        ])
        .compile({ dateRange }),
    ).not.toThrow();
  });

  it("does not throw when all members have pay", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [minimizeCost()],
    });

    expect(() =>
      s
        .with([{ id: "alice", roleIds: ["waiter"], pay: { hourlyRate: 2500 } }])
        .compile({ dateRange }),
    ).not.toThrow();
  });

  it("does not throw when no cost rules present", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("s", t(12), t(15))],
      rules: [],
    });

    expect(() =>
      s.with([{ id: "alice", roleIds: ["waiter"] }]).compile({ dateRange }),
    ).not.toThrow();
  });
});

// ============================================================================
// calculateScheduleCost
// ============================================================================

describe("calculateScheduleCost", () => {
  it("computes correct totals for hourly members", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("lunch_shift", t(12), t(15))],
      rules: [minimizeCost()],
    });

    const compiled = s
      .with([{ id: "alice", roleIds: ["waiter"], pay: { hourlyRate: 2000 } }])
      .compile({ dateRange: { start: "2026-02-09", end: "2026-02-09" } });

    const assignments: ShiftAssignment[] = [
      { memberId: "alice", shiftPatternId: "lunch_shift", day: "2026-02-09" },
    ];

    const cost = calculateScheduleCost(assignments, {
      members: compiled.builder.members,
      shiftPatterns: compiled.builder.shiftPatterns,
      rules: compiled.builder.rules,
    });

    // 3 hours * 2000/hr = 6000
    expect(cost.total).toBe(6000);
    const alice = cost.byMember.get("alice")!;
    expect(alice.categories.get(COST_CATEGORY.BASE)).toBe(6000);
    expect(alice.totalCost).toBe(6000);
    expect(alice.totalHours).toBe(3);
    expect(cost.byDay.get("2026-02-09")).toBe(6000);
  });

  it("includes premium costs from dayMultiplier", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("lunch_shift", t(12), t(15))],
      rules: [minimizeCost(), dayMultiplier(1.5, { dayOfWeek: ["saturday"] })],
    });

    const compiled = s
      .with([{ id: "alice", roleIds: ["waiter"], pay: { hourlyRate: 2000 } }])
      .compile({ dateRange: { start: "2026-02-14", end: "2026-02-14" } });

    const assignments: ShiftAssignment[] = [
      { memberId: "alice", shiftPatternId: "lunch_shift", day: "2026-02-14" },
    ];

    const cost = calculateScheduleCost(assignments, {
      members: compiled.builder.members,
      shiftPatterns: compiled.builder.shiftPatterns,
      rules: compiled.builder.rules,
    });

    // Base: 3 * 2000 = 6000, Premium: 3 * 2000 * 0.5 = 3000, Total: 9000
    const alice = cost.byMember.get("alice")!;
    expect(alice.categories.get(COST_CATEGORY.BASE)).toBe(6000);
    expect(alice.categories.get(COST_CATEGORY.PREMIUM)).toBe(3000);
    expect(cost.total).toBe(9000);
  });

  it("includes premium costs from daySurcharge", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("lunch_shift", t(12), t(15))],
      rules: [minimizeCost(), daySurcharge(500, { dayOfWeek: ["saturday"] })],
    });

    const compiled = s
      .with([{ id: "alice", roleIds: ["waiter"], pay: { hourlyRate: 2000 } }])
      .compile({ dateRange: { start: "2026-02-14", end: "2026-02-14" } });

    const assignments: ShiftAssignment[] = [
      { memberId: "alice", shiftPatternId: "lunch_shift", day: "2026-02-14" },
    ];

    const cost = calculateScheduleCost(assignments, {
      members: compiled.builder.members,
      shiftPatterns: compiled.builder.shiftPatterns,
      rules: compiled.builder.rules,
    });

    // Base: 3 * 2000 = 6000, Surcharge: 3 * 500 = 1500, Total: 7500
    const alice = cost.byMember.get("alice")!;
    expect(alice.categories.get(COST_CATEGORY.BASE)).toBe(6000);
    expect(alice.categories.get(COST_CATEGORY.PREMIUM)).toBe(1500);
    expect(cost.total).toBe(7500);
  });

  it("includes premium costs from timeSurcharge", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { dinner: time({ startTime: t(18), endTime: t(23) }) },
      coverage: [cover("dinner", "waiter", 1)],
      shiftPatterns: [shift("dinner_shift", t(18), t(23))],
      rules: [minimizeCost(), timeSurcharge(300, { from: t(22), until: t(6) })],
    });

    const compiled = s
      .with([{ id: "alice", roleIds: ["waiter"], pay: { hourlyRate: 2000 } }])
      .compile({ dateRange: { start: "2026-02-09", end: "2026-02-09" } });

    const assignments: ShiftAssignment[] = [
      { memberId: "alice", shiftPatternId: "dinner_shift", day: "2026-02-09" },
    ];

    const cost = calculateScheduleCost(assignments, {
      members: compiled.builder.members,
      shiftPatterns: compiled.builder.shiftPatterns,
      rules: compiled.builder.rules,
    });

    // Base: 5 * 2000 = 10000
    // Time surcharge: 1 hour overlap (22:00-23:00) * 300 = 300
    const alice = cost.byMember.get("alice")!;
    expect(alice.categories.get(COST_CATEGORY.BASE)).toBe(10000);
    expect(alice.categories.get(COST_CATEGORY.PREMIUM)).toBe(300);
    expect(cost.total).toBe(10300);
  });

  it("includes overtime costs from overtimeMultiplier", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { work: time({ startTime: t(9), endTime: t(17) }) },
      coverage: [cover("work", "waiter", 1)],
      shiftPatterns: [shift("day", t(9), t(17))],
      rules: [minimizeCost(), overtimeMultiplier({ after: 20, factor: 1.5 })],
    });

    const compiled = s
      .with([{ id: "alice", roleIds: ["waiter"], pay: { hourlyRate: 2000 } }])
      .compile({
        dateRange: { start: "2026-02-09", end: "2026-02-13" },
      });

    const assignments: ShiftAssignment[] = [
      { memberId: "alice", shiftPatternId: "day", day: "2026-02-09" },
      { memberId: "alice", shiftPatternId: "day", day: "2026-02-10" },
      { memberId: "alice", shiftPatternId: "day", day: "2026-02-11" },
      { memberId: "alice", shiftPatternId: "day", day: "2026-02-12" },
      { memberId: "alice", shiftPatternId: "day", day: "2026-02-13" },
    ];

    const cost = calculateScheduleCost(assignments, {
      members: compiled.builder.members,
      shiftPatterns: compiled.builder.shiftPatterns,
      rules: compiled.builder.rules,
    });

    // Base: 40h * 2000 = 80000
    // Overtime: 20h * 2000 * 0.5 = 20000
    const alice = cost.byMember.get("alice")!;
    expect(alice.categories.get(COST_CATEGORY.BASE)).toBe(80000);
    expect(alice.categories.get(COST_CATEGORY.OVERTIME)).toBe(20000);
    expect(cost.total).toBe(100000);
  });

  it("includes overtime costs from dailyOvertimeMultiplier", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { work: time({ startTime: t(8), endTime: t(20) }) },
      coverage: [cover("work", "waiter", 1)],
      shiftPatterns: [shift("long", t(8), t(20))],
      rules: [minimizeCost(), dailyOvertimeMultiplier({ after: 8, factor: 1.5 })],
    });

    const compiled = s
      .with([{ id: "alice", roleIds: ["waiter"], pay: { hourlyRate: 2000 } }])
      .compile({ dateRange: { start: "2026-02-09", end: "2026-02-09" } });

    const assignments: ShiftAssignment[] = [
      { memberId: "alice", shiftPatternId: "long", day: "2026-02-09" },
    ];

    const cost = calculateScheduleCost(assignments, {
      members: compiled.builder.members,
      shiftPatterns: compiled.builder.shiftPatterns,
      rules: compiled.builder.rules,
    });

    // Base: 12h * 2000 = 24000
    // Daily overtime: 4h * 2000 * 0.5 = 4000
    const alice = cost.byMember.get("alice")!;
    expect(alice.categories.get(COST_CATEGORY.BASE)).toBe(24000);
    expect(alice.categories.get(COST_CATEGORY.OVERTIME)).toBe(4000);
    expect(cost.total).toBe(28000);
  });

  it("includes overtime costs from tieredOvertimeMultiplier", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { work: time({ startTime: t(9), endTime: t(17) }) },
      coverage: [cover("work", "waiter", 1)],
      shiftPatterns: [shift("day", t(9), t(17))],
      rules: [
        minimizeCost(),
        tieredOvertimeMultiplier([
          { after: 16, factor: 1.5 },
          { after: 32, factor: 2.0 },
        ]),
      ],
    });

    const compiled = s
      .with([{ id: "alice", roleIds: ["waiter"], pay: { hourlyRate: 2000 } }])
      .compile({
        dateRange: { start: "2026-02-09", end: "2026-02-13" },
      });

    const assignments: ShiftAssignment[] = [
      { memberId: "alice", shiftPatternId: "day", day: "2026-02-09" },
      { memberId: "alice", shiftPatternId: "day", day: "2026-02-10" },
      { memberId: "alice", shiftPatternId: "day", day: "2026-02-11" },
      { memberId: "alice", shiftPatternId: "day", day: "2026-02-12" },
      { memberId: "alice", shiftPatternId: "day", day: "2026-02-13" },
    ];

    const cost = calculateScheduleCost(assignments, {
      members: compiled.builder.members,
      shiftPatterns: compiled.builder.shiftPatterns,
      rules: compiled.builder.rules,
    });

    // Base: 40h * 2000 = 80000
    // Tier 1: 16h * 2000 * 0.5 = 16000
    // Tier 2: 8h * 2000 * 1.0 = 16000
    const alice = cost.byMember.get("alice")!;
    expect(alice.categories.get(COST_CATEGORY.BASE)).toBe(80000);
    expect(alice.categories.get(COST_CATEGORY.OVERTIME)).toBe(32000);
    expect(cost.total).toBe(112000);
  });

  it("computes salaried employee base cost", () => {
    const s = schedule({
      roleIds: ["manager"] as const,
      times: { work: time({ startTime: t(9), endTime: t(17) }) },
      coverage: [cover("work", "manager", 1)],
      shiftPatterns: [shift("day", t(9), t(17))],
      rules: [minimizeCost()],
    });

    const compiled = s
      .with([{ id: "carol", roleIds: ["manager"], pay: { annual: 5200000, hoursPerWeek: 40 } }])
      .compile({
        dateRange: { start: "2026-02-09", end: "2026-02-13" },
      });

    const assignments: ShiftAssignment[] = [
      { memberId: "carol", shiftPatternId: "day", day: "2026-02-09" },
      { memberId: "carol", shiftPatternId: "day", day: "2026-02-10" },
      { memberId: "carol", shiftPatternId: "day", day: "2026-02-11" },
    ];

    const cost = calculateScheduleCost(assignments, {
      members: compiled.builder.members,
      shiftPatterns: compiled.builder.shiftPatterns,
      rules: compiled.builder.rules,
    });

    // Weekly salary: 5200000 / 52 = 100000
    const carol = cost.byMember.get("carol")!;
    expect(carol.categories.get(COST_CATEGORY.BASE)).toBe(100000);
    expect(carol.totalCost).toBe(100000);
    expect(carol.totalHours).toBe(24); // 3 days * 8 hours
  });

  it("aggregates by day correctly", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 2)],
      shiftPatterns: [shift("lunch_shift", t(12), t(15))],
      rules: [minimizeCost()],
    });

    const compiled = s
      .with([
        { id: "alice", roleIds: ["waiter"], pay: { hourlyRate: 2000 } },
        { id: "bob", roleIds: ["waiter"], pay: { hourlyRate: 1500 } },
      ])
      .compile({ dateRange: { start: "2026-02-09", end: "2026-02-10" } });

    const assignments: ShiftAssignment[] = [
      { memberId: "alice", shiftPatternId: "lunch_shift", day: "2026-02-09" },
      { memberId: "bob", shiftPatternId: "lunch_shift", day: "2026-02-09" },
      { memberId: "alice", shiftPatternId: "lunch_shift", day: "2026-02-10" },
    ];

    const cost = calculateScheduleCost(assignments, {
      members: compiled.builder.members,
      shiftPatterns: compiled.builder.shiftPatterns,
      rules: compiled.builder.rules,
    });

    // Day 1: alice 6000 + bob 4500 = 10500
    // Day 2: alice 6000
    expect(cost.byDay.get("2026-02-09")).toBe(10500);
    expect(cost.byDay.get("2026-02-10")).toBe(6000);
    expect(cost.total).toBe(16500);
  });

  it("returns empty breakdown when no cost rules present", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("lunch_shift", t(12), t(15))],
      rules: [],
    });

    const compiled = s
      .with([{ id: "alice", roleIds: ["waiter"] }])
      .compile({ dateRange: { start: "2026-02-09", end: "2026-02-09" } });

    const assignments: ShiftAssignment[] = [
      { memberId: "alice", shiftPatternId: "lunch_shift", day: "2026-02-09" },
    ];

    const cost = calculateScheduleCost(assignments, {
      members: compiled.builder.members,
      shiftPatterns: compiled.builder.shiftPatterns,
      rules: compiled.builder.rules,
    });

    expect(cost.total).toBe(0);
    expect(cost.byMember.size).toBe(0);
  });

  it("uses open-ended category strings from custom rules", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("lunch_shift", t(12), t(15))],
      rules: [minimizeCost()],
    });

    const compiled = s
      .with([{ id: "alice", roleIds: ["waiter"], pay: { hourlyRate: 2000 } }])
      .compile({ dateRange: { start: "2026-02-09", end: "2026-02-09" } });

    const customRule = {
      compile() {},
      cost() {
        return {
          entries: [{ memberId: "alice", day: "2026-02-09", category: "hazard-pay", amount: 500 }],
        };
      },
    };

    const assignments: ShiftAssignment[] = [
      { memberId: "alice", shiftPatternId: "lunch_shift", day: "2026-02-09" },
    ];

    const cost = calculateScheduleCost(assignments, {
      members: compiled.builder.members,
      shiftPatterns: compiled.builder.shiftPatterns,
      rules: [...compiled.builder.rules, customRule],
    });

    // Base: 6000, custom: 500
    const alice = cost.byMember.get("alice")!;
    expect(alice.categories.get(COST_CATEGORY.BASE)).toBe(6000);
    expect(alice.categories.get("hazard-pay")).toBe(500);
    expect(alice.totalCost).toBe(6500);
  });
});

// ============================================================================
// CostContext on ModelBuilder
// ============================================================================

describe("CostContext on ModelBuilder", () => {
  it("costContext is set after minimizeCost compiles", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("lunch_shift", t(12), t(15))],
      rules: [minimizeCost()],
    });

    const compiled = s
      .with([{ id: "alice", roleIds: ["waiter"], pay: { hourlyRate: 2500 } }])
      .compile({ dateRange: { start: "2026-02-09", end: "2026-02-09" } });

    expect(compiled.builder.costContext).toBeDefined();
    expect(compiled.builder.costContext!.active).toBe(true);
    expect(compiled.builder.costContext!.normalizationFactor).toBeGreaterThan(0);
  });

  it("costContext normalization accounts for salaried members", () => {
    const s = schedule({
      roleIds: ["waiter", "manager"] as const,
      times: { work: time({ startTime: t(9), endTime: t(17) }) },
      coverage: [cover("work", "waiter", 1)],
      shiftPatterns: [shift("day", t(9), t(17))],
      rules: [minimizeCost()],
    });

    const compiled = s
      .with([
        { id: "alice", roleIds: ["waiter"], pay: { hourlyRate: 1000 } },
        { id: "carol", roleIds: ["manager"], pay: { annual: 5200000, hoursPerWeek: 40 } },
      ])
      .compile({ dateRange: { start: "2026-02-09", end: "2026-02-09" } });

    // Weekly salary = 5200000/52 = 100000, hourly cost = 1000*8 = 8000
    // Max raw cost should be 100000 (from salaried)
    expect(compiled.builder.costContext).toBeDefined();
    expect(compiled.builder.costContext!.normalizationFactor).toBeGreaterThan(0);
  });

  it("costContext is undefined when no minimizeCost rule", () => {
    const s = schedule({
      roleIds: ["waiter"] as const,
      times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
      coverage: [cover("lunch", "waiter", 1)],
      shiftPatterns: [shift("lunch_shift", t(12), t(15))],
      rules: [],
    });

    const compiled = s
      .with([{ id: "alice", roleIds: ["waiter"] }])
      .compile({ dateRange: { start: "2026-02-09", end: "2026-02-09" } });

    expect(compiled.builder.costContext).toBeUndefined();
  });
});
