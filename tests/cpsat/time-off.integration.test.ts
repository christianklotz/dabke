import { beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import { createBaseConfig, decodeAssignments, solveWithRules, getSolverClient } from "./helpers.js";

describe("CP-SAT: time-off rule", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  describe("basic functionality", () => {
    it("honors time-off requests over assignment preferences", async () => {
      const baseConfig = createBaseConfig({
        roleId: "cashier",
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      });

      const preferences: CpsatRuleConfigEntry[] = [
        {
          name: "assignment-priority",
          memberIds: ["alice"],
          preference: "high",
        },
        {
          name: "assignment-priority",
          memberIds: ["bob"],
          preference: "low",
        },
      ];

      const baseline = await solveWithRules(client, baseConfig, preferences);
      expect(baseline.status).toBe("OPTIMAL");
      const baselineAssignments = decodeAssignments(baseline.values);
      expect(baselineAssignments).toContainEqual(expect.objectContaining({ memberId: "alice" }));

      const withTimeOff = await solveWithRules(client, baseConfig, [
        ...preferences,
        {
          name: "time-off",

          memberIds: ["alice"],
          specificDates: ["2024-02-01"],
          priority: "MANDATORY",
        },
      ] satisfies CpsatRuleConfigEntry[]);
      expect(withTimeOff.status).toBe("OPTIMAL");
      const timeOffAssignments = decodeAssignments(withTimeOff.values);
      expect(timeOffAssignments).toContainEqual(expect.objectContaining({ memberId: "bob" }));
      expect(timeOffAssignments.find((a) => a.memberId === "alice")).toBeUndefined();
    }, 30_000);

    it("treats mandatory time off as infeasible when no alternative coverage exists", async () => {
      const baseConfig = createBaseConfig({
        roleId: "barista",
        memberIds: ["solo"],
        schedulingPeriod: { dateRange: { start: "2024-02-04", end: "2024-02-04" } },
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",

          memberIds: ["solo"],
          specificDates: ["2024-02-04"],
          priority: "MANDATORY",
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("INFEASIBLE");
    }, 30_000);

    it("supports role-based time-off", async () => {
      const baseConfig = createBaseConfig({
        roleId: "cashier",
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",

          roleIds: ["cashier"],
          specificDates: ["2024-02-01"],
          priority: "MANDATORY",
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("INFEASIBLE");
    }, 30_000);

    it("supports date range time-off", async () => {
      const baseConfig = createBaseConfig({
        roleId: "cashier",
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-03" } },
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",

          memberIds: ["alice"],
          dateRange: { start: "2024-02-01", end: "2024-02-02" },
          priority: "MANDATORY",
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      const aliceAssignments = assignments.filter((a) => a.memberId === "alice");
      const aliceBlockedDays = aliceAssignments.filter(
        (a) => a.day === "2024-02-01" || a.day === "2024-02-02",
      );
      expect(aliceBlockedDays).toHaveLength(0);

      expect(assignments.length).toBe(3);
    }, 30_000);

    it("supports day-of-week time-off", async () => {
      const baseConfig = createBaseConfig({
        roleId: "cashier",
        schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-07" } },
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",

          memberIds: ["alice"],
          dayOfWeek: ["monday"],
          priority: "MANDATORY",
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      const aliceAssignments = assignments.filter((a) => a.memberId === "alice");
      expect(aliceAssignments.every((a) => a.day !== "2024-02-05")).toBe(true);
    }, 30_000);

    it("supports soft time-off constraints", async () => {
      const baseConfig = createBaseConfig({
        roleId: "barista",
        memberIds: ["solo"],
        schedulingPeriod: { dateRange: { start: "2024-02-04", end: "2024-02-04" } },
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",

          memberIds: ["solo"],
          specificDates: ["2024-02-04"],
          priority: "LOW",
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);
      expect(assignments).toContainEqual(expect.objectContaining({ memberId: "solo" }));
    }, 30_000);
  });

  describe("partial day time-off", () => {
    it("blocks overlapping shifts", async () => {
      const baseConfig = createBaseConfig({
        roleId: "cashier",
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        shifts: [
          {
            id: "morning",
            startTime: { hours: 8, minutes: 0 },
            endTime: { hours: 12, minutes: 0 },
          },
          {
            id: "afternoon",
            startTime: { hours: 14, minutes: 0 },
            endTime: { hours: 18, minutes: 0 },
          },
        ],
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",

          memberIds: ["alice"],
          specificDates: ["2024-02-01"],
          startTime: { hours: 13, minutes: 0 },
          endTime: { hours: 23, minutes: 59 },
          priority: "MANDATORY",
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      const aliceAssignments = assignments.filter((a) => a.memberId === "alice");
      expect(aliceAssignments.every((a) => a.shiftPatternId === "morning")).toBe(true);
    }, 30_000);

    it("does not block shifts outside time-off window", async () => {
      const baseConfig = createBaseConfig({
        roleId: "cashier",
        memberIds: ["alice"],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        shift: {
          id: "morning",
          startTime: { hours: 8, minutes: 0 },
          endTime: { hours: 12, minutes: 0 },
        },
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",

          memberIds: ["alice"],
          specificDates: ["2024-02-01"],
          startTime: { hours: 6, minutes: 0 },
          endTime: { hours: 8, minutes: 0 },
          priority: "MANDATORY",
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      expect(assignments.length).toBeGreaterThan(0);
      expect(assignments[0]?.memberId).toBe("alice");
    }, 30_000);

    it("blocks shift that partially overlaps with time-off window", async () => {
      const baseConfig = createBaseConfig({
        roleId: "staff",
        memberIds: ["alice", "bob"],
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
        schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-05" } },
        targetCount: 1,
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",

          memberIds: ["alice"],
          specificDates: ["2024-02-05"],
          startTime: { hours: 14, minutes: 0 },
          endTime: { hours: 18, minutes: 0 },
          priority: "MANDATORY",
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);
      expect(assignments).not.toContainEqual(expect.objectContaining({ memberId: "alice" }));
      expect(assignments).toContainEqual(expect.objectContaining({ memberId: "bob" }));
    }, 30_000);

    it("allows shift that does not overlap with time-off window", async () => {
      const baseConfig = createBaseConfig({
        roleId: "staff",
        memberIds: ["alice"],
        shift: {
          id: "morning",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 13, minutes: 0 },
        },
        schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-05" } },
        targetCount: 1,
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",

          memberIds: ["alice"],
          specificDates: ["2024-02-05"],
          startTime: { hours: 14, minutes: 0 },
          endTime: { hours: 18, minutes: 0 },
          priority: "MANDATORY",
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);
      expect(assignments).toContainEqual(expect.objectContaining({ memberId: "alice" }));
    }, 30_000);

    it("blocks shift fully contained within time-off window", async () => {
      const baseConfig = createBaseConfig({
        roleId: "staff",
        memberIds: ["alice", "bob"],
        shift: {
          id: "short",
          startTime: { hours: 10, minutes: 0 },
          endTime: { hours: 14, minutes: 0 },
        },
        schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-05" } },
        targetCount: 1,
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",

          memberIds: ["alice"],
          specificDates: ["2024-02-05"],
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 18, minutes: 0 },
          priority: "MANDATORY",
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);
      expect(assignments).not.toContainEqual(expect.objectContaining({ memberId: "alice" }));
    }, 30_000);
  });

  describe("priority behavior", () => {
    it("MANDATORY prevents assignment even when sole option", async () => {
      const baseConfig = createBaseConfig({
        roleId: "staff",
        memberIds: ["alice"],
        schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-05" } },
        targetCount: 1,
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",

          memberIds: ["alice"],
          specificDates: ["2024-02-05"],
          priority: "MANDATORY",
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("INFEASIBLE");
    }, 30_000);

    it("HIGH priority allows override when necessary", async () => {
      const baseConfig = createBaseConfig({
        roleId: "staff",
        memberIds: ["alice"],
        schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-05" } },
        targetCount: 1,
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",

          memberIds: ["alice"],
          specificDates: ["2024-02-05"],
          priority: "HIGH",
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);
      expect(assignments).toContainEqual(expect.objectContaining({ memberId: "alice" }));
    }, 30_000);

    it("MEDIUM priority allows override when necessary", async () => {
      const baseConfig = createBaseConfig({
        roleId: "staff",
        memberIds: ["alice"],
        schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-05" } },
        targetCount: 1,
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",

          memberIds: ["alice"],
          specificDates: ["2024-02-05"],
          priority: "MEDIUM",
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);
      expect(assignments).toContainEqual(expect.objectContaining({ memberId: "alice" }));
    }, 30_000);
  });

  describe("validation", () => {
    it("validates date string format in specificDates", async () => {
      const baseConfig = createBaseConfig({ roleId: "cashier" });
      await expect(
        solveWithRules(client, baseConfig, [
          {
            name: "time-off",

            memberIds: ["alice"],
            specificDates: ["Feb 1, 2024"],
            priority: "MANDATORY",
          },
        ] as CpsatRuleConfigEntry[]),
      ).rejects.toThrow(/Invalid.*date/i);
    });

    it("validates date string format in dateRange", async () => {
      const baseConfig = createBaseConfig({ roleId: "cashier" });
      await expect(
        solveWithRules(client, baseConfig, [
          {
            name: "time-off",

            memberIds: ["alice"],
            dateRange: { start: "2024/02/01", end: "2024/02/05" },
            priority: "MANDATORY",
          },
        ] as CpsatRuleConfigEntry[]),
      ).rejects.toThrow(/Invalid.*date/i);
    });

    it("requires time scoping", async () => {
      const baseConfig = createBaseConfig({ roleId: "cashier" });
      await expect(
        solveWithRules(client, baseConfig, [
          {
            name: "time-off",
            // @ts-expect-error: deliberately missing time scope to test runtime validation
            config: {
              memberIds: ["alice"],
              priority: "MANDATORY",
            },
          },
        ]),
      ).rejects.toThrow(/Must provide time scoping/i);
    });

    it("requires both startTime and endTime together", async () => {
      const baseConfig = createBaseConfig({ roleId: "cashier" });
      await expect(
        solveWithRules(client, baseConfig, [
          {
            name: "time-off",

            memberIds: ["alice"],
            specificDates: ["2024-02-01"],
            startTime: { hours: 9, minutes: 0 },
            priority: "MANDATORY",
          },
        ] as CpsatRuleConfigEntry[]),
      ).rejects.toThrow(/Both startTime and endTime/i);
    });
  });

  describe("multi-member patterns", () => {
    it("handles multiple members with different time-off patterns", async () => {
      const baseConfig = createBaseConfig({
        members: [
          { id: "emp1", roles: ["waiter"] },
          { id: "emp2", roles: ["waiter"] },
          { id: "emp3", roles: ["waiter"] },
        ],
        shifts: [
          {
            id: "morning",
            startTime: { hours: 8, minutes: 0 },
            endTime: { hours: 14, minutes: 0 },
          },
          {
            id: "evening",
            startTime: { hours: 16, minutes: 0 },
            endTime: { hours: 22, minutes: 0 },
          },
        ],
        schedulingPeriod: {
          dateRange: { start: "2024-02-05", end: "2024-02-09" },
          dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
        },
        targetCount: 1,
      });

      const rules: CpsatRuleConfigEntry[] = [
        {
          name: "time-off",

          memberIds: ["emp1"],
          specificDates: ["2024-02-07"],
          priority: "MANDATORY",
        },
        {
          name: "time-off",

          memberIds: ["emp2"],
          specificDates: ["2024-02-08", "2024-02-09"],
          startTime: { hours: 0, minutes: 0 },
          endTime: { hours: 14, minutes: 0 },
          priority: "MANDATORY",
        },
      ];

      const response = await solveWithRules(client, baseConfig, rules);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      const emp1Wednesday = assignments.filter(
        (a) => a?.memberId === "emp1" && a?.day === "2024-02-07",
      );
      expect(emp1Wednesday).toHaveLength(0);

      const emp2ThursdayMorning = assignments.filter(
        (a) => a?.memberId === "emp2" && a?.day === "2024-02-08" && a?.shiftPatternId === "morning",
      );
      expect(emp2ThursdayMorning).toHaveLength(0);
    }, 60_000);

    it("handles role-based time-off affecting multiple members", async () => {
      const baseConfig = createBaseConfig({
        members: [
          { id: "chef1", roles: ["chef"] },
          { id: "chef2", roles: ["chef"] },
          { id: "waiter1", roles: ["waiter"] },
        ],
        shifts: [
          {
            id: "morning",
            roleIds: ["chef"],
            startTime: { hours: 8, minutes: 0 },
            endTime: { hours: 14, minutes: 0 },
          },
          {
            id: "evening",
            roleIds: ["waiter"],
            startTime: { hours: 14, minutes: 0 },
            endTime: { hours: 22, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-05" } },
        coverage: [
          {
            day: "2024-02-05",
            roleIds: ["chef"],
            startTime: { hours: 8, minutes: 0 },
            endTime: { hours: 14, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-02-05",
            roleIds: ["waiter"],
            startTime: { hours: 14, minutes: 0 },
            endTime: { hours: 22, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const rules: CpsatRuleConfigEntry[] = [
        {
          name: "time-off",

          roleIds: ["chef"],
          dayOfWeek: ["monday"],
          startTime: { hours: 14, minutes: 0 },
          endTime: { hours: 23, minutes: 59 },
          priority: "MANDATORY",
        },
      ];

      const response = await solveWithRules(client, baseConfig, rules);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      const chefEveningAssignments = assignments.filter(
        (a) =>
          (a?.memberId === "chef1" || a?.memberId === "chef2") && a?.shiftPatternId === "evening",
      );
      expect(chefEveningAssignments).toHaveLength(0);

      const waiterEvening = assignments.filter(
        (a) => a?.memberId === "waiter1" && a?.shiftPatternId === "evening",
      );
      expect(waiterEvening).toHaveLength(1);
    }, 30_000);

    it("handles recurring time-off patterns (infeasible case)", async () => {
      const baseConfig = createBaseConfig({
        roleId: "waiter",
        shift: {
          id: "day",
          startTime: { hours: 10, minutes: 0 },
          endTime: { hours: 18, minutes: 0 },
        },
        schedulingPeriod: {
          dateRange: { start: "2024-02-04", end: "2024-02-11" },
          dates: [
            "2024-02-04", // Sun
            "2024-02-05", // Mon
            "2024-02-06", // Tue
            "2024-02-10", // Sat
            "2024-02-11", // Sun
          ],
        },
        targetCount: 1,
      });

      const rules: CpsatRuleConfigEntry[] = [
        {
          name: "time-off",

          dayOfWeek: ["sunday"],
          priority: "MANDATORY",
        },
      ];

      const response = await solveWithRules(client, baseConfig, rules);

      expect(response.status).toBe("INFEASIBLE");
    }, 30_000);
  });

  describe("skill-scoped time-off", () => {
    it("blocks members with matching skill", async () => {
      const baseConfig = createBaseConfig({
        members: [
          { id: "alice", roles: ["waiter"], skills: ["keyholder"] },
          { id: "bob", roles: ["waiter"], skills: ["keyholder"] },
          { id: "charlie", roles: ["waiter"] },
        ],
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
        schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-05" } },
        targetCount: 2,
      });

      const rules: CpsatRuleConfigEntry[] = [
        {
          name: "time-off",

          skillIds: ["keyholder"],
          dayOfWeek: ["monday"],
          priority: "MANDATORY",
        },
      ];

      const response = await solveWithRules(client, baseConfig, rules);

      expect(response.status).toBe("INFEASIBLE");
    }, 30_000);

    it("allows non-skilled members to work", async () => {
      const baseConfig = createBaseConfig({
        members: [
          { id: "alice", roles: ["waiter"], skills: ["keyholder"] },
          { id: "bob", roles: ["waiter"] },
          { id: "charlie", roles: ["waiter"] },
        ],
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
        schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-05" } },
        targetCount: 2,
      });

      const rules: CpsatRuleConfigEntry[] = [
        {
          name: "time-off",

          skillIds: ["keyholder"],
          dayOfWeek: ["monday"],
          priority: "MANDATORY",
        },
      ];

      const response = await solveWithRules(client, baseConfig, rules);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      expect(assignments).toHaveLength(2);
      const assignedIds = assignments.map((a) => a?.memberId).toSorted();
      expect(assignedIds).toEqual(["bob", "charlie"]);
    }, 30_000);
  });

  describe("combined with other rules", () => {
    it("combines time-off with max-hours-week constraint", async () => {
      const baseConfig = createBaseConfig({
        members: [
          { id: "alice", roles: ["worker"] },
          { id: "bob", roles: ["worker"] },
        ],
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
        schedulingPeriod: {
          dateRange: { start: "2024-02-05", end: "2024-02-11" },
        },
        targetCount: 1,
      });

      const rules: CpsatRuleConfigEntry[] = [
        {
          name: "time-off",

          memberIds: ["alice"],
          dateRange: { start: "2024-02-07", end: "2024-02-08" },
          priority: "MANDATORY",
        },
        {
          name: "max-hours-week",

          hours: 32,
          priority: "MANDATORY",
          weekStartsOn: "monday",
        },
      ];

      const response = await solveWithRules(client, baseConfig, rules);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      const aliceAssignments = assignments.filter((a) => a?.memberId === "alice");
      expect(aliceAssignments.length).toBeLessThanOrEqual(4);

      const aliceWedThu = aliceAssignments.filter(
        (a) => a?.day === "2024-02-07" || a?.day === "2024-02-08",
      );
      expect(aliceWedThu).toHaveLength(0);
    }, 60_000);

    it("combines time-off with min-rest-between-shifts", async () => {
      const builder = new ModelBuilder({
        members: [
          { id: "alice", roles: ["nurse"] },
          { id: "bob", roles: ["nurse"] },
        ],
        shiftPatterns: [
          {
            id: "day",
            startTime: { hours: 7, minutes: 0 },
            endTime: { hours: 19, minutes: 0 },
          },
          {
            id: "night",
            startTime: { hours: 19, minutes: 0 },
            endTime: { hours: 7, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-07" } },
        coverage: ["2024-02-05", "2024-02-06", "2024-02-07"].flatMap((day) => [
          {
            day,
            roleIds: ["nurse"],
            startTime: { hours: 7, minutes: 0 },
            endTime: { hours: 19, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY" as const,
          },
        ]),
        ruleConfigs: [
          {
            name: "min-rest-between-shifts",

            hours: 10,
            priority: "MANDATORY",
          },
          {
            name: "time-off",

            memberIds: ["alice"],
            specificDates: ["2024-02-06"],
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      const aliceTuesday = assignments.filter(
        (a) => a?.memberId === "alice" && a?.day === "2024-02-06",
      );
      expect(aliceTuesday).toHaveLength(0);

      const tuesdayAssignments = assignments.filter((a) => a?.day === "2024-02-06");
      expect(tuesdayAssignments.length).toBeGreaterThanOrEqual(1);
    }, 60_000);
  });
});
