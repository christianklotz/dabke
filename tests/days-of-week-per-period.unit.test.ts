import { describe, it, expect } from "vitest";
import type { DateString } from "../src/types.js";
import { schedulingDay } from "../src/types.js";
import { splitIntoMonths } from "../src/cpsat/utils.js";

function schedulingDays(days: readonly DateString[]) {
  return days.map(schedulingDay);
}

/** Extract ISO strings from SchedulingDay arrays for assertion convenience. */
function isos(days: ReturnType<typeof schedulingDay>[]) {
  return days.map((d) => d.iso);
}
import {
  schedule,
  t,
  time,
  cover,
  shift,
  maxDaysOfWeekPerPeriod,
  minDaysOfWeekPerPeriod,
  weekend,
} from "../src/schedule/index.js";

// ============================================================================
// splitIntoMonths utility
// ============================================================================

describe("splitIntoMonths", () => {
  it("groups days by calendar month with chunk size 1", () => {
    const days = schedulingDays([
      "2024-01-29",
      "2024-01-30",
      "2024-01-31",
      "2024-02-01",
      "2024-02-02",
      "2024-02-03",
    ]);
    const chunks = splitIntoMonths(days, 1);
    expect(chunks.map(isos)).toEqual([
      ["2024-01-29", "2024-01-30", "2024-01-31"],
      ["2024-02-01", "2024-02-02", "2024-02-03"],
    ]);
  });

  it("merges consecutive months into multi-month chunks", () => {
    const days = schedulingDays(["2024-01-15", "2024-02-15", "2024-03-15", "2024-04-15"]);
    const chunks = splitIntoMonths(days, 2);
    expect(chunks.map(isos)).toEqual([
      ["2024-01-15", "2024-02-15"],
      ["2024-03-15", "2024-04-15"],
    ]);
  });

  it("handles partial last chunk", () => {
    const days = schedulingDays(["2024-01-15", "2024-02-15", "2024-03-15"]);
    const chunks = splitIntoMonths(days, 2);
    expect(chunks.map(isos)).toEqual([["2024-01-15", "2024-02-15"], ["2024-03-15"]]);
  });

  it("returns empty for no days", () => {
    expect(splitIntoMonths([], 1)).toEqual([]);
  });

  it("quarterly chunks (3 months)", () => {
    const days = schedulingDays([
      "2024-01-01",
      "2024-02-01",
      "2024-03-01",
      "2024-04-01",
      "2024-05-01",
      "2024-06-01",
    ]);
    const chunks = splitIntoMonths(days, 3);
    expect(chunks.map(isos)).toEqual([
      ["2024-01-01", "2024-02-01", "2024-03-01"],
      ["2024-04-01", "2024-05-01", "2024-06-01"],
    ]);
  });
});

// ============================================================================
// maxDaysOfWeekPerPeriod
// ============================================================================

describe("maxDaysOfWeekPerPeriod", () => {
  it("creates a rule entry with weeks period", () => {
    const rule = maxDaysOfWeekPerPeriod(1, ["sunday"], { weeks: 4 });
    expect(rule._rule).toBe("max-days-of-week-per-period");
    expect(rule.days).toBe(1);
    expect(rule.dayOfWeek).toEqual(["sunday"]);
    expect(rule.period).toEqual({ type: "weeks", value: 4 });
  });

  it("creates a rule entry with months period", () => {
    const rule = maxDaysOfWeekPerPeriod(2, weekend, { months: 1 });
    expect(rule._rule).toBe("max-days-of-week-per-period");
    expect(rule.days).toBe(2);
    expect(rule.dayOfWeek).toEqual(["saturday", "sunday"]);
    expect(rule.period).toEqual({ type: "months", value: 1 });
  });

  it("passes appliesTo and priority", () => {
    const rule = maxDaysOfWeekPerPeriod(1, ["sunday"], {
      weeks: 4,
      appliesTo: "senior",
      priority: "HIGH",
    });
    expect(rule.appliesTo).toBe("senior");
    expect(rule.priority).toBe("HIGH");
  });
});

// ============================================================================
// minDaysOfWeekPerPeriod
// ============================================================================

describe("minDaysOfWeekPerPeriod", () => {
  it("creates a rule entry with weeks period", () => {
    const rule = minDaysOfWeekPerPeriod(1, ["sunday"], { weeks: 4 });
    expect(rule._rule).toBe("min-days-of-week-per-period");
    expect(rule.days).toBe(1);
    expect(rule.dayOfWeek).toEqual(["sunday"]);
    expect(rule.period).toEqual({ type: "weeks", value: 4 });
  });

  it("creates a rule entry with months period", () => {
    const rule = minDaysOfWeekPerPeriod(1, weekend, { months: 1, priority: "HIGH" });
    expect(rule._rule).toBe("min-days-of-week-per-period");
    expect(rule.days).toBe(1);
    expect(rule.period).toEqual({ type: "months", value: 1 });
    expect(rule.priority).toBe("HIGH");
  });

  it("passes appliesTo as array", () => {
    const rule = minDaysOfWeekPerPeriod(1, ["saturday"], {
      weeks: 2,
      appliesTo: ["alice", "bob"],
    });
    expect(rule.appliesTo).toEqual(["alice", "bob"]);
  });
});

// ============================================================================
// Schedule integration (compile-level)
// ============================================================================

describe("schedule compile with days-of-week-per-period rules", () => {
  it("compiles a schedule with maxDaysOfWeekPerPeriod (weeks)", () => {
    const s = schedule({
      roleIds: ["stylist"],
      times: {
        trading: time({ startTime: t(10), endTime: t(19) }),
      },
      coverage: [cover("trading", "stylist", 1)],
      shiftPatterns: [shift("day", t(10), t(19))],
      rules: [maxDaysOfWeekPerPeriod(1, ["sunday"], { weeks: 4 })],
    });

    const members = [{ id: "alice", roleIds: ["stylist"], skillIds: [] as string[] }];
    const ready = s.with(members);
    const compiled = ready.compile({
      dateRange: { start: "2024-02-05", end: "2024-03-03" },
    });
    expect(compiled.canSolve).toBe(true);
  });

  it("compiles a schedule with minDaysOfWeekPerPeriod (months)", () => {
    const s = schedule({
      roleIds: ["stylist"],
      times: {
        trading: time({ startTime: t(10), endTime: t(19) }),
      },
      coverage: [cover("trading", "stylist", 1)],
      shiftPatterns: [shift("day", t(10), t(19))],
      rules: [minDaysOfWeekPerPeriod(1, weekend, { months: 1, priority: "HIGH" })],
    });

    const members = [{ id: "alice", roleIds: ["stylist"], skillIds: [] as string[] }];
    const ready = s.with(members);
    const compiled = ready.compile({
      dateRange: { start: "2024-02-01", end: "2024-02-29" },
    });
    expect(compiled.canSolve).toBe(true);
  });

  it("compiles with appliesTo scoped to a role", () => {
    const s = schedule({
      roleIds: ["junior", "senior"],
      times: {
        trading: time({ startTime: t(10), endTime: t(19) }),
      },
      coverage: [cover("trading", ["junior", "senior"], 2)],
      shiftPatterns: [shift("day", t(10), t(19))],
      rules: [maxDaysOfWeekPerPeriod(1, ["sunday"], { weeks: 4, appliesTo: "junior" })],
    });

    const members = [
      { id: "alice", roleIds: ["junior"], skillIds: [] as string[] },
      { id: "bob", roleIds: ["senior"], skillIds: [] as string[] },
    ];
    const ready = s.with(members);
    const compiled = ready.compile({
      dateRange: { start: "2024-02-05", end: "2024-03-03" },
    });
    expect(compiled.canSolve).toBe(true);
  });
});
