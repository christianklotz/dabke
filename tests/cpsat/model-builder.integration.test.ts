import assert from "node:assert";
import { beforeAll, describe, expect, it } from "vitest";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { createBaseConfig, decodeAssignments, solveWithRules, getSolverClient } from "./helpers.js";

describe("CP-SAT compilation integration", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("solves compiled models end-to-end", async () => {
    const builder = new ModelBuilder({
      ...createBaseConfig({
        roleIds: ["cashier"],
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      }),
      rules: [],
    });

    const { request } = builder.compile();
    const response = await client.solve(request);

    expect(response.status).toBe("OPTIMAL");
    const assignments = Object.entries(response.values ?? {}).filter(
      ([name, value]) => name.startsWith("assign:") && value === 1,
    );
    expect(assignments.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("reports infeasible status for conflicting mandatory rules", async () => {
    const baseConfig = createBaseConfig({
      roleIds: ["cook"],
      employeeIds: ["solo"],
      shift: {
        id: "day",
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-03" } },
    });

    const response = await solveWithRules(client, { ...baseConfig, weekStartsOn: "thursday" }, [
      {
        name: "min-hours-week",

        hours: 24,
        priority: "MANDATORY",
      },
      {
        name: "max-hours-week",

        hours: 8,
        priority: "MANDATORY",
      },
    ] satisfies CpsatRuleConfigEntry[]);

    expect(response.status).toBe("INFEASIBLE");
  }, 30_000);

  describe("coverage with split shifts", () => {
    it("requires both shift patterns when coverage periods don't overlap", async () => {
      // Retail shop scenario with overlapping shifts but distinct coverage needs:
      // - Morning shift: 8:00-13:30 (includes opening)
      // - Afternoon shift: 12:30-18:00 (includes closing)
      // - Shifts overlap 12:30-13:30
      // - Early coverage (9:00-10:00): ONLY morning shift overlaps
      // - Late coverage (17:00-18:00): ONLY afternoon shift overlaps
      //
      // This forces the solver to use both shift patterns to cover all periods.

      const builder = new ModelBuilder({
        employees: [
          { id: "john", roleIds: ["staff"] },
          { id: "mary", roleIds: ["staff"] },
        ],
        shiftPatterns: [
          {
            id: "morning",
            roleIds: ["staff"],
            startTime: { hours: 8, minutes: 0 },
            endTime: { hours: 13, minutes: 30 },
          },
          {
            id: "afternoon",
            roleIds: ["staff"],
            startTime: { hours: 12, minutes: 30 },
            endTime: { hours: 18, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [
          // Early morning: only morning shift covers this
          {
            day: "2024-02-01",
            roleIds: ["staff"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 10, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          // Late afternoon: only afternoon shift covers this
          {
            day: "2024-02-01",
            roleIds: ["staff"],
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 18, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      // Should have at least 2 assignments (one per coverage period)
      // Same person can work both shifts without max-shifts-day rule
      expect(assignments.length).toBeGreaterThanOrEqual(2);

      // Both shift patterns must be used
      const patterns = new Set(assignments.map((a) => a?.shiftPatternId));
      expect(patterns.has("morning")).toBe(true);
      expect(patterns.has("afternoon")).toBe(true);
    }, 30_000);

    it("requires separate coverage when patterns only partially overlap coverage periods", async () => {
      // Retail shop scenario:
      // - Morning coverage: 9:00-12:30
      // - Afternoon coverage: 12:30-17:00
      // - Morning shift: 8:00-13:30 (covers morning fully, but only 12:30-13:30 of afternoon)
      // - Afternoon shift: 12:30-18:00 (covers afternoon fully)
      //
      // The morning shift cannot satisfy afternoon coverage because it ends at 13:30,
      // leaving 13:30-17:00 uncovered. Time-indexed coverage ensures we need both shifts.

      const builder = new ModelBuilder({
        employees: [
          { id: "john", roleIds: ["staff"] },
          { id: "mary", roleIds: ["staff"] },
        ],
        shiftPatterns: [
          {
            id: "morning",
            roleIds: ["staff"],
            startTime: { hours: 8, minutes: 0 },
            endTime: { hours: 13, minutes: 30 },
          },
          {
            id: "afternoon",
            roleIds: ["staff"],
            startTime: { hours: 12, minutes: 30 },
            endTime: { hours: 18, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [
          {
            day: "2024-02-01",
            roleIds: ["staff"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 12, minutes: 30 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-02-01",
            roleIds: ["staff"],
            startTime: { hours: 12, minutes: 30 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      // Both shifts needed: morning for 9:00-12:30, afternoon for 12:30-17:00
      // Same person can work both without max-shifts-day rule
      expect(assignments.length).toBeGreaterThanOrEqual(2);

      // Both shift patterns must be used
      const patterns = new Set(assignments.map((a) => a?.shiftPatternId));
      expect(patterns.has("morning")).toBe(true);
      expect(patterns.has("afternoon")).toBe(true);
    }, 30_000);

    it("assigns same person to both shifts when only one coverage period spans the day", async () => {
      // If there's just one coverage period for the whole day,
      // and we have two overlapping shifts, only one person is needed
      // (assuming they can cover the whole period with one shift or the overlap)

      const builder = new ModelBuilder({
        employees: [
          { id: "john", roleIds: ["staff"] },
          { id: "mary", roleIds: ["staff"] },
        ],
        shiftPatterns: [
          {
            id: "full_day",
            roleIds: ["staff"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [
          {
            day: "2024-02-01",
            roleIds: ["staff"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      // Only 1 assignment needed
      expect(assignments).toHaveLength(1);
    }, 30_000);

    it("allows one employee to cover split shifts without max-shifts-day rule", async () => {
      // Only 1 employee but 2 coverage periods that need different shifts
      // Without max-shifts-day rule, one person CAN work both patterns

      const builder = new ModelBuilder({
        employees: [{ id: "john", roleIds: ["staff"] }],
        shiftPatterns: [
          {
            id: "morning",
            roleIds: ["staff"],
            startTime: { hours: 8, minutes: 0 },
            endTime: { hours: 12, minutes: 0 },
          },
          {
            id: "afternoon",
            roleIds: ["staff"],
            startTime: { hours: 14, minutes: 0 },
            endTime: { hours: 18, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [
          {
            day: "2024-02-01",
            roleIds: ["staff"],
            startTime: { hours: 8, minutes: 0 },
            endTime: { hours: 12, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-02-01",
            roleIds: ["staff"],
            startTime: { hours: 14, minutes: 0 },
            endTime: { hours: 18, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      // Without max-shifts-day, John can work both shifts
      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);
      expect(assignments).toHaveLength(2);
      expect(assignments.every((a) => a?.employeeId === "john")).toBe(true);
    }, 30_000);

    it("fails when max-shifts-day rule prevents covering split shifts", async () => {
      // Only 1 employee but 2 coverage periods that need different shifts
      // With max-shifts-day rule of 1, this becomes infeasible

      const response = await solveWithRules(
        client,
        {
          employees: [{ id: "john", roleIds: ["staff"] }],
          shiftPatterns: [
            {
              id: "morning",
              roleIds: ["staff"],
              startTime: { hours: 8, minutes: 0 },
              endTime: { hours: 12, minutes: 0 },
            },
            {
              id: "afternoon",
              roleIds: ["staff"],
              startTime: { hours: 14, minutes: 0 },
              endTime: { hours: 18, minutes: 0 },
            },
          ],
          schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
          coverage: [
            {
              day: "2024-02-01",
              roleIds: ["staff"],
              startTime: { hours: 8, minutes: 0 },
              endTime: { hours: 12, minutes: 0 },
              targetCount: 1,
              priority: "MANDATORY",
            },
            {
              day: "2024-02-01",
              roleIds: ["staff"],
              startTime: { hours: 14, minutes: 0 },
              endTime: { hours: 18, minutes: 0 },
              targetCount: 1,
              priority: "MANDATORY",
            },
          ],
        },
        [
          {
            name: "max-shifts-day",

            shifts: 1,
            priority: "MANDATORY",
          },
        ],
      );

      // With max-shifts-day of 1, John can only work one shift - infeasible
      expect(response.status).toBe("INFEASIBLE");
    }, 30_000);

    it("handles three coverage periods across the day with appropriate staff", async () => {
      // Extended scenario: opening, midday, closing - each needs 1 person
      // Three employees, three non-overlapping shifts

      const builder = new ModelBuilder({
        employees: [
          { id: "alice", roleIds: ["staff"] },
          { id: "bob", roleIds: ["staff"] },
          { id: "charlie", roleIds: ["staff"] },
        ],
        shiftPatterns: [
          {
            id: "opening",
            roleIds: ["staff"],
            startTime: { hours: 7, minutes: 0 },
            endTime: { hours: 11, minutes: 0 },
          },
          {
            id: "midday",
            roleIds: ["staff"],
            startTime: { hours: 11, minutes: 0 },
            endTime: { hours: 15, minutes: 0 },
          },
          {
            id: "closing",
            roleIds: ["staff"],
            startTime: { hours: 15, minutes: 0 },
            endTime: { hours: 19, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [
          {
            day: "2024-02-01",
            roleIds: ["staff"],
            startTime: { hours: 7, minutes: 0 },
            endTime: { hours: 11, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-02-01",
            roleIds: ["staff"],
            startTime: { hours: 11, minutes: 0 },
            endTime: { hours: 15, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-02-01",
            roleIds: ["staff"],
            startTime: { hours: 15, minutes: 0 },
            endTime: { hours: 19, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      // At least 3 assignments needed (one per coverage period)
      // Without max-shifts-day, same person can work multiple shifts
      expect(assignments.length).toBeGreaterThanOrEqual(3);

      // All three shift patterns must be used
      const patterns = new Set(assignments.map((a) => a?.shiftPatternId));
      expect(patterns.has("opening")).toBe(true);
      expect(patterns.has("midday")).toBe(true);
      expect(patterns.has("closing")).toBe(true);
    }, 30_000);
  });

  describe("overlapping coverage requirements", () => {
    it("should satisfy overlapping coverage: dinner + happy hour", async () => {
      // Scenario: Restaurant with dinner service (5pm-10pm) needing 2 waiters,
      // and happy hour (5pm-6pm) needing 1 extra waiter (3 total during that hour)
      const builder = new ModelBuilder({
        employees: [
          { id: "waiter1", roleIds: ["waiter"] },
          { id: "waiter2", roleIds: ["waiter"] },
          { id: "waiter3", roleIds: ["waiter"] },
          { id: "waiter4", roleIds: ["waiter"] },
        ],
        shiftPatterns: [
          {
            id: "evening",
            roleIds: ["waiter"],
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 22, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-06-01", end: "2024-06-01" } },
        coverage: [
          // Dinner: 5pm-10pm, need 2 waiters
          {
            day: "2024-06-01",
            roleIds: ["waiter"],
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 22, minutes: 0 },
            targetCount: 2,
            priority: "MANDATORY",
          },
          // Happy hour: 5pm-6pm, need 3 waiters total (overlaps with dinner)
          {
            day: "2024-06-01",
            roleIds: ["waiter"],
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 18, minutes: 0 },
            targetCount: 3,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      // Should assign 3 waiters (the MAX of overlapping requirements)
      // The solver should realize that during 5-6pm we need 3 (max of 2, 3)
      // and during 6-10pm we need 2
      // Since we only have one shift pattern covering the whole period,
      // we need at least 3 waiters assigned
      expect(assignments.length).toBeGreaterThanOrEqual(3);
    }, 30_000);

    it("should handle multiple roles with overlapping coverage", async () => {
      // Scenario: Dinner needs 2 servers + 1 bartender
      // Happy hour needs 2 bartenders (extra bartender during 5-6pm)
      const builder = new ModelBuilder({
        employees: [
          { id: "server1", roleIds: ["server"] },
          { id: "server2", roleIds: ["server"] },
          { id: "bartender1", roleIds: ["bartender"] },
          { id: "bartender2", roleIds: ["bartender"] },
        ],
        shiftPatterns: [
          {
            id: "server_evening",
            roleIds: ["server"],
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 22, minutes: 0 },
          },
          {
            id: "bar_evening",
            roleIds: ["bartender"],
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 22, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-06-01", end: "2024-06-01" } },
        coverage: [
          // Dinner servers: 5pm-10pm
          {
            day: "2024-06-01",
            roleIds: ["server"],
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 22, minutes: 0 },
            targetCount: 2,
            priority: "MANDATORY",
          },
          // Dinner bartender: 5pm-10pm
          {
            day: "2024-06-01",
            roleIds: ["bartender"],
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 22, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          // Happy hour bartenders: 5pm-6pm (overlaps, need 2 total)
          {
            day: "2024-06-01",
            roleIds: ["bartender"],
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 18, minutes: 0 },
            targetCount: 2,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      // Should have 2 servers + 2 bartenders = 4 total
      expect(assignments).toHaveLength(4);

      const serverAssignments = assignments.filter((a) => a?.shiftPatternId?.includes("server"));
      const bartenderAssignments = assignments.filter((a) => a?.shiftPatternId?.includes("bar"));

      expect(serverAssignments).toHaveLength(2);
      expect(bartenderAssignments).toHaveLength(2);
    }, 30_000);

    it("should handle nested overlapping periods (peak within rush within service)", async () => {
      // Scenario:
      // - All day service: 8am-8pm, need 2 staff
      // - Lunch rush: 12pm-2pm, need 4 staff
      // - Peak hour: 12:30pm-1:30pm, need 6 staff
      const builder = new ModelBuilder({
        employees: Array.from({ length: 6 }, (_, i) => ({
          id: `staff${i + 1}`,
          roleIds: ["staff"],
        })),
        shiftPatterns: [
          {
            id: "full_day",
            roleIds: ["staff"],
            startTime: { hours: 8, minutes: 0 },
            endTime: { hours: 20, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-06-01", end: "2024-06-01" } },
        coverage: [
          // All day: 8am-8pm
          {
            day: "2024-06-01",
            roleIds: ["staff"],
            startTime: { hours: 8, minutes: 0 },
            endTime: { hours: 20, minutes: 0 },
            targetCount: 2,
            priority: "MANDATORY",
          },
          // Lunch rush: 12pm-2pm
          {
            day: "2024-06-01",
            roleIds: ["staff"],
            startTime: { hours: 12, minutes: 0 },
            endTime: { hours: 14, minutes: 0 },
            targetCount: 4,
            priority: "MANDATORY",
          },
          // Peak hour: 12:30pm-1:30pm
          {
            day: "2024-06-01",
            roleIds: ["staff"],
            startTime: { hours: 12, minutes: 30 },
            endTime: { hours: 13, minutes: 30 },
            targetCount: 6,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      // Should assign 6 staff (the max needed during peak)
      expect(assignments).toHaveLength(6);
    }, 30_000);

    it("should handle adjacent (non-overlapping) coverage requirements", async () => {
      // Scenario: Lunch (11am-2pm) and Dinner (5pm-10pm) - no overlap
      // Without max-shifts-day rule, employees can work both shifts
      const builder = new ModelBuilder({
        employees: [
          { id: "server1", roleIds: ["server"] },
          { id: "server2", roleIds: ["server"] },
          { id: "server3", roleIds: ["server"] },
          { id: "server4", roleIds: ["server"] },
        ],
        shiftPatterns: [
          {
            id: "lunch_shift",
            roleIds: ["server"],
            startTime: { hours: 11, minutes: 0 },
            endTime: { hours: 14, minutes: 0 },
          },
          {
            id: "dinner_shift",
            roleIds: ["server"],
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 22, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-06-01", end: "2024-06-01" } },
        coverage: [
          // Lunch: 11am-2pm, need 2 servers
          {
            day: "2024-06-01",
            roleIds: ["server"],
            startTime: { hours: 11, minutes: 0 },
            endTime: { hours: 14, minutes: 0 },
            targetCount: 2,
            priority: "MANDATORY",
          },
          // Dinner: 5pm-10pm, need 2 servers
          {
            day: "2024-06-01",
            roleIds: ["server"],
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 22, minutes: 0 },
            targetCount: 2,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      const lunchAssignments = assignments.filter((a) => a?.shiftPatternId === "lunch_shift");
      const dinnerAssignments = assignments.filter((a) => a?.shiftPatternId === "dinner_shift");

      // Need 2 for lunch and 2 for dinner; without max-shifts-day,
      // same people can work both, so at least 2 people total
      expect(lunchAssignments.length).toBeGreaterThanOrEqual(2);
      expect(dinnerAssignments.length).toBeGreaterThanOrEqual(2);
    }, 30_000);

    it("should return infeasible when overlapping coverage exceeds available staff", async () => {
      // Scenario: Need 5 waiters during peak but only have 3
      const builder = new ModelBuilder({
        employees: [
          { id: "waiter1", roleIds: ["waiter"] },
          { id: "waiter2", roleIds: ["waiter"] },
          { id: "waiter3", roleIds: ["waiter"] },
        ],
        shiftPatterns: [
          {
            id: "evening",
            roleIds: ["waiter"],
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 22, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-06-01", end: "2024-06-01" } },
        coverage: [
          {
            day: "2024-06-01",
            roleIds: ["waiter"],
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 22, minutes: 0 },
            targetCount: 2,
            priority: "MANDATORY",
          },
          // Happy hour needs 5 total - but we only have 3 waiters!
          {
            day: "2024-06-01",
            roleIds: ["waiter"],
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 18, minutes: 0 },
            targetCount: 5,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("INFEASIBLE");
    }, 30_000);
  });

  describe("weekStartsOn inheritance", () => {
    let client: ReturnType<typeof getSolverClient>;

    beforeAll(() => {
      client = getSolverClient();
    });

    it("uses ModelBuilder.weekStartsOn when weekly rule omits weekStartsOn", async () => {
      // Restaurant-style week: Saturday -> Friday
      // Days span Fri+Sat, so whether Fri/Sat belong to the same "week" depends on weekStartsOn.
      //
      // With weekStartsOn = saturday:
      //   - Fri is the last day of the previous week
      //   - Sat starts a new week
      // So a per-week cap should limit Fri and Sat separately.

      const baseConfig = createBaseConfig({
        roleIds: ["server"],
        employeeIds: ["alice"],
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 }, // 8h
        },
        schedulingPeriod: { dateRange: { start: "2024-02-09", end: "2024-02-10" } }, // Fri, Sat
        targetCount: 1,
      });

      const rule: CpsatRuleConfigEntry[] = [
        {
          name: "max-hours-week",

          hours: 8,
          priority: "MANDATORY",
          // Intentionally omitted: weekStartsOn,
        },
      ];

      const baseline = await solveWithRules(client, baseConfig, []);
      expect(baseline.status).toBe("OPTIMAL");
      const baselineAssignments = decodeAssignments(baseline.values);
      expect(baselineAssignments).toHaveLength(2);

      const saturdayWeek = await solveWithRules(
        client,
        { ...baseConfig, weekStartsOn: "saturday" },
        rule,
      );

      expect(saturdayWeek.status).toBe("OPTIMAL");
      const saturdayAssignments = decodeAssignments(saturdayWeek.values);

      // With Saturday week-start, Fri and Sat are in different weeks -> both can be scheduled
      expect(saturdayAssignments).toHaveLength(2);

      const mondayWeek = await solveWithRules(
        client,
        { ...baseConfig, weekStartsOn: "monday" },
        rule,
      );

      // With Monday week-start, Fri+Sat belong to the same week, so 8h/week cap makes it infeasible
      expect(mondayWeek.status).toBe("INFEASIBLE");
    }, 30_000);
  });

  describe("weekday-only coverage across partial weeks", () => {
    it("covers all weekdays when date range spans Thu-Wed (Feb 1-7, 2024)", async () => {
      // Scenario: Schedule a week starting Thursday, ending Wednesday
      // Coverage is Mon-Fri only (weekdays), 9am-5pm
      // Feb 2024 calendar:
      //   Thu Feb 1, Fri Feb 2, Sat Feb 3, Sun Feb 4,
      //   Mon Feb 5, Tue Feb 6, Wed Feb 7
      // Expected: 5 assignments (Thu, Fri, Mon, Tue, Wed)

      const days = [
        "2024-02-01", // Thu
        "2024-02-02", // Fri
        "2024-02-03", // Sat
        "2024-02-04", // Sun
        "2024-02-05", // Mon
        "2024-02-06", // Tue
        "2024-02-07", // Wed
      ];

      // Coverage only for weekdays
      const weekdays = [
        "2024-02-01", // Thu
        "2024-02-02", // Fri
        "2024-02-05", // Mon
        "2024-02-06", // Tue
        "2024-02-07", // Wed
      ];

      const builder = new ModelBuilder({
        employees: [
          { id: "alice", roleIds: ["staff"] },
          { id: "bob", roleIds: ["staff"] },
        ],
        shiftPatterns: [
          {
            id: "day_shift",
            roleIds: ["staff"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: days[0]!, end: days[days.length - 1]! } },
        coverage: weekdays.map((day) => ({
          day,
          roleIds: ["staff"],
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
          targetCount: 1,
          priority: "MANDATORY" as const,
        })),
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      // Should have exactly 5 assignments (one per weekday)
      expect(assignments).toHaveLength(5);

      // Verify all weekdays are covered
      const assignedDays = assignments.map((a) => a.day).toSorted();
      expect(assignedDays).toEqual(weekdays.toSorted());
    }, 30_000);

    it("covers Wednesday Feb 7 specifically when included in range", async () => {
      // Minimal test: just Wed Feb 7
      const builder = new ModelBuilder({
        employees: [{ id: "alice", roleIds: ["staff"] }],
        shiftPatterns: [
          {
            id: "day_shift",
            roleIds: ["staff"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-07", end: "2024-02-07" } },
        coverage: [
          {
            day: "2024-02-07",
            roleIds: ["staff"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);
      expect(assignments).toHaveLength(1);
      expect(assignments[0]?.day).toBe("2024-02-07");
    }, 30_000);
  });

  describe("NoOverlap prevents overlapping shift assignments", () => {
    it("prevents employee from working two overlapping shifts on same day", async () => {
      // Morning (8-12) and midday (10-14) shifts overlap
      // Coverage only requires 10-12 window (where both patterns work)
      // Employee should only be assigned to ONE of them due to NoOverlap
      const builder = new ModelBuilder({
        employees: [{ id: "alice", roleIds: ["server"] }],
        shiftPatterns: [
          {
            id: "morning",
            startTime: { hours: 8, minutes: 0 },
            endTime: { hours: 12, minutes: 0 },
          },
          {
            id: "midday",
            startTime: { hours: 10, minutes: 0 },
            endTime: { hours: 14, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            roleIds: ["server"],
            startTime: { hours: 10, minutes: 0 },
            endTime: { hours: 12, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      // Alice should only have ONE assignment (not both overlapping shifts)
      const aliceAssignments = assignments.filter((a) => a?.employeeId === "alice");
      expect(aliceAssignments).toHaveLength(1);
    }, 30_000);

    it("allows different employees to work overlapping shifts", async () => {
      // Two employees can each work one of the overlapping shifts
      const builder = new ModelBuilder({
        employees: [
          { id: "alice", roleIds: ["server"] },
          { id: "bob", roleIds: ["server"] },
        ],
        shiftPatterns: [
          {
            id: "morning",
            startTime: { hours: 8, minutes: 0 },
            endTime: { hours: 14, minutes: 0 },
          },
          {
            id: "midday",
            startTime: { hours: 11, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            roleIds: ["server"],
            startTime: { hours: 11, minutes: 0 },
            endTime: { hours: 14, minutes: 0 },
            targetCount: 2,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      // Both employees should be assigned (one to each shift)
      expect(assignments).toHaveLength(2);
      const employeeIds = assignments.map((a) => a?.employeeId);
      expect(employeeIds).toContain("alice");
      expect(employeeIds).toContain("bob");
    }, 30_000);

    it("returns infeasible when coverage requires overlapping shifts from single employee", async () => {
      // Coverage spans longer than any single pattern
      // With only one employee and NoOverlap, this is infeasible
      const builder = new ModelBuilder({
        employees: [{ id: "alice", roleIds: ["server"] }],
        shiftPatterns: [
          {
            id: "morning",
            startTime: { hours: 7, minutes: 0 },
            endTime: { hours: 11, minutes: 0 },
          },
          {
            id: "afternoon",
            startTime: { hours: 10, minutes: 0 },
            endTime: { hours: 14, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            roleIds: ["server"],
            startTime: { hours: 7, minutes: 0 },
            endTime: { hours: 14, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      // Neither pattern alone covers 7-14, Alice can't work both due to overlap
      expect(response.status).toBe("INFEASIBLE");
    }, 30_000);
  });

  describe("double shifts (non-overlapping)", () => {
    it("allows employee to work two non-overlapping shifts on same day", async () => {
      // Split shift: morning (8-12) then evening (17-21) with gap
      const builder = new ModelBuilder({
        employees: [{ id: "alice", roleIds: ["server"] }],
        shiftPatterns: [
          {
            id: "morning",
            startTime: { hours: 8, minutes: 0 },
            endTime: { hours: 12, minutes: 0 },
          },
          {
            id: "evening",
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 21, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            roleIds: ["server"],
            startTime: { hours: 8, minutes: 0 },
            endTime: { hours: 12, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-01-01",
            roleIds: ["server"],
            startTime: { hours: 17, minutes: 0 },
            endTime: { hours: 21, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
        ruleConfigs: [
          {
            name: "max-shifts-day",
            shifts: 2,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      // Alice should have TWO assignments (both shifts)
      const aliceAssignments = assignments.filter((a) => a?.employeeId === "alice");
      expect(aliceAssignments).toHaveLength(2);

      const patternIds = aliceAssignments.map((a) => a?.shiftPatternId);
      expect(patternIds).toContain("morning");
      expect(patternIds).toContain("evening");
    }, 30_000);

    it("allows employee to work adjacent (touching) shifts", async () => {
      // Back-to-back shifts: morning ends at 14:00, afternoon starts at 14:00
      const builder = new ModelBuilder({
        employees: [{ id: "alice", roleIds: ["server"] }],
        shiftPatterns: [
          {
            id: "morning",
            startTime: { hours: 10, minutes: 0 },
            endTime: { hours: 14, minutes: 0 },
          },
          {
            id: "afternoon",
            startTime: { hours: 14, minutes: 0 },
            endTime: { hours: 18, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            roleIds: ["server"],
            startTime: { hours: 10, minutes: 0 },
            endTime: { hours: 18, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
        ruleConfigs: [
          {
            name: "max-shifts-day",
            shifts: 2,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      // Alice can work both adjacent shifts (they don't overlap)
      const aliceAssignments = assignments.filter((a) => a?.employeeId === "alice");
      expect(aliceAssignments).toHaveLength(2);
    }, 30_000);
  });

  describe("cross-midnight overlap prevention", () => {
    it("prevents same employee from working overlapping cross-midnight shifts", async () => {
      // Night shift (22:00 Day1 - 06:00 Day2) overlaps with early (05:00 - 09:00 Day2)
      // With two employees, one can do night and other can do early
      const builder = new ModelBuilder({
        employees: [
          { id: "alice", roleIds: ["server"] },
          { id: "bob", roleIds: ["server"] },
        ],
        shiftPatterns: [
          {
            id: "night",
            startTime: { hours: 22, minutes: 0 },
            endTime: { hours: 6, minutes: 0 }, // crosses midnight
          },
          {
            id: "early",
            startTime: { hours: 5, minutes: 0 },
            endTime: { hours: 9, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-02" } },
        coverage: [
          {
            day: "2024-01-01",
            roleIds: ["server"],
            startTime: { hours: 22, minutes: 0 },
            endTime: { hours: 23, minutes: 59 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-01-02",
            roleIds: ["server"],
            startTime: { hours: 5, minutes: 0 },
            endTime: { hours: 9, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      // Check if same person is assigned to both overlapping shifts
      const nightAssignment = assignments.find(
        (a) => a?.shiftPatternId === "night" && a?.day === "2024-01-01",
      );
      const earlyAssignment = assignments.find(
        (a) => a?.shiftPatternId === "early" && a?.day === "2024-01-02",
      );

      // Both should be assigned (we have 2 employees and need coverage)
      expect(nightAssignment).toBeDefined();
      expect(earlyAssignment).toBeDefined();

      // They should be to different employees (due to NoOverlap)
      assert(nightAssignment);
      assert(earlyAssignment);
      expect(nightAssignment.employeeId).not.toBe(earlyAssignment.employeeId);
    }, 30_000);

    it("returns infeasible when single employee must cover overlapping cross-midnight shifts", async () => {
      // Only one employee, must cover both night and early which overlap
      const builder = new ModelBuilder({
        employees: [{ id: "alice", roleIds: ["server"] }],
        shiftPatterns: [
          {
            id: "night",
            startTime: { hours: 22, minutes: 0 },
            endTime: { hours: 6, minutes: 0 },
          },
          {
            id: "early",
            startTime: { hours: 5, minutes: 0 },
            endTime: { hours: 9, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-02" } },
        coverage: [
          {
            day: "2024-01-01",
            roleIds: ["server"],
            startTime: { hours: 22, minutes: 0 },
            endTime: { hours: 23, minutes: 59 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-01-02",
            roleIds: ["server"],
            startTime: { hours: 5, minutes: 0 },
            endTime: { hours: 9, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      // Night shift on day 1 (22:00-06:00) overlaps with early shift on day 2 (05:00-09:00)
      // Alice cannot do both, so this should be infeasible
      expect(response.status).toBe("INFEASIBLE");
    }, 30_000);
  });

  describe("bucketed coverage", () => {
    it("shift partially overlapping coverage window contributes to coverage", async () => {
      // 10-18 shift should contribute to 12-14 lunch coverage
      const builder = new ModelBuilder({
        employees: [{ id: "alice", roleIds: ["server"] }],
        shiftPatterns: [
          {
            id: "full_day",
            startTime: { hours: 10, minutes: 0 },
            endTime: { hours: 18, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            roleIds: ["server"],
            startTime: { hours: 12, minutes: 0 },
            endTime: { hours: 14, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);
      expect(assignments).toHaveLength(1);
      expect(assignments[0]?.shiftPatternId).toBe("full_day");
    }, 30_000);

    it("staggered shifts together satisfy continuous coverage", async () => {
      // Coverage 10-14, served by 10-12 shift + 12-14 shift
      const builder = new ModelBuilder({
        employees: [
          { id: "alice", roleIds: ["server"] },
          { id: "bob", roleIds: ["server"] },
        ],
        shiftPatterns: [
          {
            id: "early",
            startTime: { hours: 10, minutes: 0 },
            endTime: { hours: 12, minutes: 0 },
          },
          {
            id: "late",
            startTime: { hours: 12, minutes: 0 },
            endTime: { hours: 14, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            roleIds: ["server"],
            startTime: { hours: 10, minutes: 0 },
            endTime: { hours: 14, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      // Need at least 2 assignments to cover 10-14 with these patterns
      expect(assignments.length).toBeGreaterThanOrEqual(2);
    }, 30_000);

    it("validates coverageBucketMinutes rejects invalid values", () => {
      const builder = new ModelBuilder({
        employees: [],
        shiftPatterns: [],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [],
        coverageBucketMinutes: 7,
      });

      expect(() => builder.compile()).toThrow(
        "coverageBucketMinutes must be one of 5, 10, 15, 30, 60",
      );
    });

    it("accepts valid bucket sizes", () => {
      for (const bucketSize of [5, 10, 15, 30, 60]) {
        const builder = new ModelBuilder({
          employees: [],
          shiftPatterns: [],
          schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
          coverage: [],
          coverageBucketMinutes: bucketSize,
        });

        expect(() => builder.compile()).not.toThrow();
      }
    });
  });
});
