import { beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { createBaseConfig, decodeAssignments, solveWithRules, getSolverClient } from "./helpers.js";
import { schedulingDay } from "../../src/types.js";

describe("CP-SAT: max-days-of-week-per-period rule", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("limits Sundays to 1 per 4-week period", async () => {
    // 4-week period: 2024-02-05 (Mon) to 2024-03-03 (Sun)
    // Contains 4 Sundays: Feb 11, Feb 18, Feb 25, Mar 3
    // 5 members so coverage can be met even when each is limited to 1 Sunday
    const baseConfig = createBaseConfig({
      roleId: "stylist",
      memberIds: ["alice", "bob", "charlie", "diana", "eve"],
      shift: {
        id: "day",
        startTime: { hours: 10, minutes: 0 },
        endTime: { hours: 19, minutes: 0 },
      },
      schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-03-03" } },
    });

    // Without the rule, assignments are unconstrained on Sundays
    const baseline = await solveWithRules(client, baseConfig, [
      {
        name: "assignment-priority",
        memberIds: ["alice"],
        preference: "prefer",
      } satisfies CpsatRuleConfigEntry,
    ]);
    expect(baseline.status).toBe("OPTIMAL");
    const baselineSundays = decodeAssignments(baseline.values).filter((a) => {
      return a.memberId === "alice" && schedulingDay(a.day).dayOfWeek === "sunday";
    });
    // Preferred alice likely gets all 4 Sundays in the baseline
    expect(baselineSundays.length).toBeGreaterThan(1);

    // With max 1 Sunday per 4 weeks, alice should work at most 1 Sunday
    const withRule = await solveWithRules(client, baseConfig, [
      {
        name: "assignment-priority",
        memberIds: ["alice"],
        preference: "prefer",
      } satisfies CpsatRuleConfigEntry,
      {
        name: "max-days-of-week-per-period",
        days: 1,
        dayOfWeek: ["sunday"],
        period: { type: "weeks", value: 4 },
        priority: "MANDATORY",
      } satisfies CpsatRuleConfigEntry,
    ]);
    expect(withRule.status).toBe("OPTIMAL");
    const ruleSundays = decodeAssignments(withRule.values).filter((a) => {
      return a.memberId === "alice" && schedulingDay(a.day).dayOfWeek === "sunday";
    });
    expect(ruleSundays.length).toBeLessThanOrEqual(1);
  }, 30_000);

  it("limits weekend days to 2 per month", async () => {
    // February 2024: has 4 Saturdays (3,10,17,24) and 4 Sundays (4,11,18,25) = 8 weekend days
    // Need enough members to cover all weekend days while each is limited to 2
    const baseConfig = createBaseConfig({
      roleId: "staff",
      memberIds: ["alice", "bob", "charlie", "diana", "eve"],
      shift: {
        id: "day",
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-29" } },
    });

    const withRule = await solveWithRules(client, baseConfig, [
      {
        name: "max-days-of-week-per-period",
        days: 2,
        dayOfWeek: ["saturday", "sunday"],
        period: { type: "months", value: 1 },
        priority: "MANDATORY",
      } satisfies CpsatRuleConfigEntry,
    ]);
    expect(withRule.status).toBe("OPTIMAL");
    const assignments = decodeAssignments(withRule.values);

    for (const memberId of ["alice", "bob", "charlie", "diana", "eve"]) {
      const weekendDays = assignments.filter((a) => {
        if (a.memberId !== memberId) return false;
        const dow = schedulingDay(a.day).dayOfWeek;
        return dow === "saturday" || dow === "sunday";
      });
      expect(weekendDays.length).toBeLessThanOrEqual(2);
    }
  }, 30_000);

  it("distributes Sundays across members when constrained", async () => {
    // 4-week period with 4 Sundays, 5 members, each limited to 2 Sundays
    // Coverage requires 2 on Sundays: 4 Sundays x 2 = 8 slots needed
    // 5 members x max 2 = 10 capacity, so feasible
    const baseConfig = createBaseConfig({
      roleId: "stylist",
      memberIds: ["alice", "bob", "charlie", "diana", "eve"],
      shift: {
        id: "day",
        startTime: { hours: 10, minutes: 0 },
        endTime: { hours: 19, minutes: 0 },
      },
      schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-03-03" } },
      targetCount: 2,
    });

    const withRule = await solveWithRules(client, baseConfig, [
      {
        name: "max-days-of-week-per-period",
        days: 2,
        dayOfWeek: ["sunday"],
        period: { type: "weeks", value: 4 },
        priority: "MANDATORY",
      } satisfies CpsatRuleConfigEntry,
    ]);
    expect(withRule.status).toBe("OPTIMAL");
    const assignments = decodeAssignments(withRule.values);
    const sundayAssignments = assignments.filter((a) => {
      return schedulingDay(a.day).dayOfWeek === "sunday";
    });

    // Each member should work at most 2 Sundays
    for (const memberId of ["alice", "bob", "charlie", "diana", "eve"]) {
      const memberSundays = sundayAssignments.filter((a) => a.memberId === memberId);
      expect(memberSundays.length).toBeLessThanOrEqual(2);
    }

    // Total Sunday assignments should be 8 (4 Sundays x 2 required)
    expect(sundayAssignments.length).toBe(8);
  }, 30_000);

  it("scoped to specific members via memberIds", async () => {
    const baseConfig = createBaseConfig({
      roleId: "stylist",
      memberIds: ["alice", "bob"],
      shift: {
        id: "day",
        startTime: { hours: 10, minutes: 0 },
        endTime: { hours: 19, minutes: 0 },
      },
      schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-03-03" } },
    });

    // Only alice is constrained; bob can work all Sundays
    const withRule = await solveWithRules(client, baseConfig, [
      {
        name: "max-days-of-week-per-period",
        days: 1,
        dayOfWeek: ["sunday"],
        period: { type: "weeks", value: 4 },
        priority: "MANDATORY",
        memberIds: ["alice"],
      } satisfies CpsatRuleConfigEntry,
      // Prefer alice so without the rule she'd take all shifts
      {
        name: "assignment-priority",
        memberIds: ["alice"],
        preference: "prefer",
      } satisfies CpsatRuleConfigEntry,
    ]);
    expect(withRule.status).toBe("OPTIMAL");
    const assignments = decodeAssignments(withRule.values);
    const sundayAssignments = assignments.filter((a) => {
      return schedulingDay(a.day).dayOfWeek === "sunday";
    });

    const aliceSundays = sundayAssignments.filter((a) => a.memberId === "alice");
    expect(aliceSundays.length).toBeLessThanOrEqual(1);
  }, 30_000);

  it("works as soft constraint with priority HIGH", async () => {
    // Single member, coverage requires Sundays, but soft constraint says max 1
    // Should still produce a solution (violating the soft constraint)
    const baseConfig = createBaseConfig({
      roleId: "stylist",
      memberIds: ["alice"],
      shift: {
        id: "day",
        startTime: { hours: 10, minutes: 0 },
        endTime: { hours: 19, minutes: 0 },
      },
      schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-03-03" } },
    });

    const withSoftRule = await solveWithRules(client, baseConfig, [
      {
        name: "max-days-of-week-per-period",
        days: 1,
        dayOfWeek: ["sunday"],
        period: { type: "weeks", value: 4 },
        priority: "HIGH",
      } satisfies CpsatRuleConfigEntry,
    ]);
    // Should still find a solution even if it violates the soft constraint
    expect(withSoftRule.status).toBe("OPTIMAL");
  }, 30_000);
});

describe("CP-SAT: min-days-of-week-per-period rule", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("ensures minimum 1 Sunday per 4-week period", async () => {
    // 4-week period, 2 members, coverage requires 1 per day
    // Without the min rule, solver might give all Sundays to one person
    const baseConfig = createBaseConfig({
      roleId: "stylist",
      memberIds: ["alice", "bob"],
      shift: {
        id: "day",
        startTime: { hours: 10, minutes: 0 },
        endTime: { hours: 19, minutes: 0 },
      },
      schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-03-03" } },
    });

    const withRule = await solveWithRules(client, baseConfig, [
      {
        name: "min-days-of-week-per-period",
        days: 1,
        dayOfWeek: ["sunday"],
        period: { type: "weeks", value: 4 },
        priority: "MANDATORY",
      } satisfies CpsatRuleConfigEntry,
    ]);
    expect(withRule.status).toBe("OPTIMAL");
    const assignments = decodeAssignments(withRule.values);
    const sundayAssignments = assignments.filter((a) => {
      return schedulingDay(a.day).dayOfWeek === "sunday";
    });

    // Both alice and bob should have at least 1 Sunday
    for (const memberId of ["alice", "bob"]) {
      const memberSundays = sundayAssignments.filter((a) => a.memberId === memberId);
      expect(memberSundays.length).toBeGreaterThanOrEqual(1);
    }
  }, 30_000);

  it("ensures minimum weekend days per month", async () => {
    // February 2024, 2 members
    const baseConfig = createBaseConfig({
      roleId: "staff",
      memberIds: ["alice", "bob"],
      shift: {
        id: "day",
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-29" } },
    });

    const withRule = await solveWithRules(client, baseConfig, [
      {
        name: "min-days-of-week-per-period",
        days: 2,
        dayOfWeek: ["saturday", "sunday"],
        period: { type: "months", value: 1 },
        priority: "MANDATORY",
      } satisfies CpsatRuleConfigEntry,
    ]);
    expect(withRule.status).toBe("OPTIMAL");
    const assignments = decodeAssignments(withRule.values);

    for (const memberId of ["alice", "bob"]) {
      const weekendDays = assignments.filter((a) => {
        if (a.memberId !== memberId) return false;
        const dow = schedulingDay(a.day).dayOfWeek;
        return dow === "saturday" || dow === "sunday";
      });
      expect(weekendDays.length).toBeGreaterThanOrEqual(2);
    }
  }, 30_000);

  it("works as soft constraint", async () => {
    // Impossible mandatory min (more Sundays required than exist), but soft
    const baseConfig = createBaseConfig({
      roleId: "stylist",
      memberIds: ["alice"],
      shift: {
        id: "day",
        startTime: { hours: 10, minutes: 0 },
        endTime: { hours: 19, minutes: 0 },
      },
      // Only 1 week, so only 1 Sunday exists
      schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-11" } },
    });

    const withSoftRule = await solveWithRules(client, baseConfig, [
      {
        name: "min-days-of-week-per-period",
        days: 3,
        dayOfWeek: ["sunday"],
        period: { type: "weeks", value: 1 },
        priority: "HIGH",
      } satisfies CpsatRuleConfigEntry,
    ]);
    // Should still find a solution (soft constraint can be violated)
    expect(withSoftRule.status).toBe("OPTIMAL");
  }, 30_000);
});

describe("CP-SAT: combined max and min days-of-week-per-period", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("bounds Sundays between min 1 and max 2 per 4-week period", async () => {
    // Hairdresser scenario: 4 Sundays, 5 members, each works 1-2 Sundays
    // Coverage requires 2: 4 Sundays x 2 = 8 slots
    // 5 members x min 1 = 5 slots minimum used, x max 2 = 10 capacity
    const baseConfig = createBaseConfig({
      roleId: "stylist",
      memberIds: ["alice", "bob", "charlie", "diana", "eve"],
      shift: {
        id: "day",
        startTime: { hours: 10, minutes: 0 },
        endTime: { hours: 19, minutes: 0 },
      },
      schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-03-03" } },
      targetCount: 2,
    });

    const withRules = await solveWithRules(client, baseConfig, [
      {
        name: "min-days-of-week-per-period",
        days: 1,
        dayOfWeek: ["sunday"],
        period: { type: "weeks", value: 4 },
        priority: "MANDATORY",
      } satisfies CpsatRuleConfigEntry,
      {
        name: "max-days-of-week-per-period",
        days: 2,
        dayOfWeek: ["sunday"],
        period: { type: "weeks", value: 4 },
        priority: "MANDATORY",
      } satisfies CpsatRuleConfigEntry,
    ]);
    expect(withRules.status).toBe("OPTIMAL");
    const assignments = decodeAssignments(withRules.values);
    const sundayAssignments = assignments.filter((a) => {
      return schedulingDay(a.day).dayOfWeek === "sunday";
    });

    for (const memberId of ["alice", "bob", "charlie", "diana", "eve"]) {
      const memberSundays = sundayAssignments.filter((a) => a.memberId === memberId);
      expect(memberSundays.length).toBeGreaterThanOrEqual(1);
      expect(memberSundays.length).toBeLessThanOrEqual(2);
    }
  }, 30_000);
});
