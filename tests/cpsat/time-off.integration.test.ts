import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import {
  createBaseConfig,
  decodeAssignments,
  solveWithRules,
  startSolverContainer,
} from "./helpers.js";

describe("CP-SAT: time-off rule", () => {
  let stop: (() => void) | undefined;
  let client: Awaited<ReturnType<typeof startSolverContainer>>["client"];
  let ensureHealthy: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const started = await startSolverContainer();
    client = started.client;
    stop = started.stop;
    ensureHealthy = started.ensureHealthy;
  }, 120_000);

  beforeEach(async () => {
    await ensureHealthy?.();
  });

  afterAll(() => {
    stop?.();
  });

  describe("basic functionality", () => {
    it("honors time-off requests over assignment preferences", async () => {
      const baseConfig = createBaseConfig({ roleId: "cashier",
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      });

      const preferences: CpsatRuleConfigEntry[] = [
        {
          name: "employee-assignment-priority",
          config: { employeeIds: ["alice"], preference: "high" },
        },
        {
          name: "employee-assignment-priority",
          config: { employeeIds: ["bob"], preference: "low" },
        },
      ];

      const baseline = await solveWithRules(client, baseConfig, preferences);
      expect(baseline.status).toBe("OPTIMAL");
      const baselineAssignments = decodeAssignments(baseline.values);
      expect(baselineAssignments).toContainEqual(expect.objectContaining({ employeeId: "alice" }));

      const withTimeOff = await solveWithRules(client, baseConfig, [
        ...preferences,
        {
          name: "time-off",
          config: {
            employeeIds: ["alice"],
            specificDates: ["2024-02-01"],
            priority: "MANDATORY",
          },
        },
      ] satisfies CpsatRuleConfigEntry[]);
      expect(withTimeOff.status).toBe("OPTIMAL");
      const timeOffAssignments = decodeAssignments(withTimeOff.values);
      expect(timeOffAssignments).toContainEqual(expect.objectContaining({ employeeId: "bob" }));
      expect(timeOffAssignments.find((a) => a.employeeId === "alice")).toBeUndefined();
    }, 30_000);

    it("treats mandatory time off as infeasible when no alternative coverage exists", async () => {
      const baseConfig = createBaseConfig({ roleId: "barista",
        employeeIds: ["solo"],
        schedulingPeriod: { specificDates: ["2024-02-04"] },
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",
          config: {
            employeeIds: ["solo"],
            specificDates: ["2024-02-04"],
            priority: "MANDATORY",
          },
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("INFEASIBLE");
    }, 30_000);

    it("supports role-based time-off", async () => {
      const baseConfig = createBaseConfig({ roleId: "cashier",
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",
          config: {
            roleIds: ["cashier"],
            specificDates: ["2024-02-01"],
            priority: "MANDATORY",
          },
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("INFEASIBLE");
    }, 30_000);

    it("supports date range time-off", async () => {
      const baseConfig = createBaseConfig({ roleId: "cashier",
        schedulingPeriod: { specificDates: ["2024-02-01", "2024-02-02", "2024-02-03"] },
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",
          config: {
            employeeIds: ["alice"],
            dateRange: { start: "2024-02-01", end: "2024-02-02" },
            priority: "MANDATORY",
          },
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      const aliceAssignments = assignments.filter((a) => a.employeeId === "alice");
      const aliceBlockedDays = aliceAssignments.filter(
        (a) => a.day === "2024-02-01" || a.day === "2024-02-02",
      );
      expect(aliceBlockedDays).toHaveLength(0);

      expect(assignments.length).toBe(3);
    }, 30_000);

    it("supports day-of-week time-off", async () => {
      const baseConfig = createBaseConfig({ roleId: "cashier",
        schedulingPeriod: { specificDates: ["2024-02-05", "2024-02-06", "2024-02-07"] },
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",
          config: {
            employeeIds: ["alice"],
            dayOfWeek: ["monday"],
            priority: "MANDATORY",
          },
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      const aliceAssignments = assignments.filter((a) => a.employeeId === "alice");
      expect(aliceAssignments.every((a) => a.day !== "2024-02-05")).toBe(true);
    }, 30_000);

    it("supports soft time-off constraints", async () => {
      const baseConfig = createBaseConfig({ roleId: "barista",
        employeeIds: ["solo"],
        schedulingPeriod: { specificDates: ["2024-02-04"] },
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",
          config: {
            employeeIds: ["solo"],
            specificDates: ["2024-02-04"],
            priority: "LOW",
          },
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);
      expect(assignments).toContainEqual(expect.objectContaining({ employeeId: "solo" }));
    }, 30_000);
  });

  describe("partial day time-off", () => {
    it("blocks overlapping shifts", async () => {
      const baseConfig = createBaseConfig({ roleId: "cashier",
        schedulingPeriod: { specificDates: ["2024-02-01"] },
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
          config: {
            employeeIds: ["alice"],
            specificDates: ["2024-02-01"],
            startTime: { hours: 13, minutes: 0 },
            endTime: { hours: 23, minutes: 59 },
            priority: "MANDATORY",
          },
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      const aliceAssignments = assignments.filter((a) => a.employeeId === "alice");
      expect(aliceAssignments.every((a) => a.shiftPatternId === "morning")).toBe(true);
    }, 30_000);

    it("does not block shifts outside time-off window", async () => {
      const baseConfig = createBaseConfig({ roleId: "cashier",
        employeeIds: ["alice"],
        schedulingPeriod: { specificDates: ["2024-02-01"] },
        shift: {
          id: "morning",
          startTime: { hours: 8, minutes: 0 },
          endTime: { hours: 12, minutes: 0 },
        },
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",
          config: {
            employeeIds: ["alice"],
            specificDates: ["2024-02-01"],
            startTime: { hours: 6, minutes: 0 },
            endTime: { hours: 8, minutes: 0 },
            priority: "MANDATORY",
          },
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      expect(assignments.length).toBeGreaterThan(0);
      expect(assignments[0]?.employeeId).toBe("alice");
    }, 30_000);

    it("blocks shift that partially overlaps with time-off window", async () => {
      const baseConfig = createBaseConfig({ roleId: "staff",
        employeeIds: ["alice", "bob"],
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
        schedulingPeriod: { specificDates: ["2024-02-05"] },
        targetCount: 1,
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",
          config: {
            employeeIds: ["alice"],
            specificDates: ["2024-02-05"],
            startTime: { hours: 14, minutes: 0 },
            endTime: { hours: 18, minutes: 0 },
            priority: "MANDATORY",
          },
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);
      expect(assignments).not.toContainEqual(expect.objectContaining({ employeeId: "alice" }));
      expect(assignments).toContainEqual(expect.objectContaining({ employeeId: "bob" }));
    }, 30_000);

    it("allows shift that does not overlap with time-off window", async () => {
      const baseConfig = createBaseConfig({ roleId: "staff",
        employeeIds: ["alice"],
        shift: {
          id: "morning",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 13, minutes: 0 },
        },
        schedulingPeriod: { specificDates: ["2024-02-05"] },
        targetCount: 1,
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",
          config: {
            employeeIds: ["alice"],
            specificDates: ["2024-02-05"],
            startTime: { hours: 14, minutes: 0 },
            endTime: { hours: 18, minutes: 0 },
            priority: "MANDATORY",
          },
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);
      expect(assignments).toContainEqual(expect.objectContaining({ employeeId: "alice" }));
    }, 30_000);

    it("blocks shift fully contained within time-off window", async () => {
      const baseConfig = createBaseConfig({ roleId: "staff",
        employeeIds: ["alice", "bob"],
        shift: {
          id: "short",
          startTime: { hours: 10, minutes: 0 },
          endTime: { hours: 14, minutes: 0 },
        },
        schedulingPeriod: { specificDates: ["2024-02-05"] },
        targetCount: 1,
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",
          config: {
            employeeIds: ["alice"],
            specificDates: ["2024-02-05"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 18, minutes: 0 },
            priority: "MANDATORY",
          },
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);
      expect(assignments).not.toContainEqual(expect.objectContaining({ employeeId: "alice" }));
    }, 30_000);
  });

  describe("priority behavior", () => {
    it("MANDATORY prevents assignment even when sole option", async () => {
      const baseConfig = createBaseConfig({ roleId: "staff",
        employeeIds: ["alice"],
        schedulingPeriod: { specificDates: ["2024-02-05"] },
        targetCount: 1,
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",
          config: {
            employeeIds: ["alice"],
            specificDates: ["2024-02-05"],
            priority: "MANDATORY",
          },
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("INFEASIBLE");
    }, 30_000);

    it("HIGH priority allows override when necessary", async () => {
      const baseConfig = createBaseConfig({ roleId: "staff",
        employeeIds: ["alice"],
        schedulingPeriod: { specificDates: ["2024-02-05"] },
        targetCount: 1,
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",
          config: {
            employeeIds: ["alice"],
            specificDates: ["2024-02-05"],
            priority: "HIGH",
          },
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);
      expect(assignments).toContainEqual(expect.objectContaining({ employeeId: "alice" }));
    }, 30_000);

    it("MEDIUM priority allows override when necessary", async () => {
      const baseConfig = createBaseConfig({ roleId: "staff",
        employeeIds: ["alice"],
        schedulingPeriod: { specificDates: ["2024-02-05"] },
        targetCount: 1,
      });

      const response = await solveWithRules(client, baseConfig, [
        {
          name: "time-off",
          config: {
            employeeIds: ["alice"],
            specificDates: ["2024-02-05"],
            priority: "MEDIUM",
          },
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);
      expect(assignments).toContainEqual(expect.objectContaining({ employeeId: "alice" }));
    }, 30_000);
  });

  describe("validation", () => {
    it("validates date string format in specificDates", async () => {
      const baseConfig = createBaseConfig({ roleId: "cashier" });
      await expect(
        solveWithRules(client, baseConfig, [
          {
            name: "time-off",
            config: {
              employeeIds: ["alice"],
              specificDates: ["Feb 1, 2024"],
              priority: "MANDATORY",
            },
          },
        ] as CpsatRuleConfigEntry[]),
      ).rejects.toThrow(/Invalid date/i);
    });

    it("validates date string format in dateRange", async () => {
      const baseConfig = createBaseConfig({ roleId: "cashier" });
      await expect(
        solveWithRules(client, baseConfig, [
          {
            name: "time-off",
            config: {
              employeeIds: ["alice"],
              dateRange: { start: "2024/02/01", end: "2024/02/05" },
              priority: "MANDATORY",
            },
          },
        ] as CpsatRuleConfigEntry[]),
      ).rejects.toThrow(/Invalid date/i);
    });

    it("requires time scoping", async () => {
      const baseConfig = createBaseConfig({ roleId: "cashier" });
      await expect(
        solveWithRules(client, baseConfig, [
          {
            name: "time-off",
            config: {
              employeeIds: ["alice"],
              priority: "MANDATORY",
            },
          },
        ] as CpsatRuleConfigEntry[]),
      ).rejects.toThrow(/Must provide time scoping/i);
    });

    it("requires both startTime and endTime together", async () => {
      const baseConfig = createBaseConfig({ roleId: "cashier" });
      await expect(
        solveWithRules(client, baseConfig, [
          {
            name: "time-off",
            config: {
              employeeIds: ["alice"],
              specificDates: ["2024-02-01"],
              startTime: { hours: 9, minutes: 0 },
              priority: "MANDATORY",
            },
          },
        ] as CpsatRuleConfigEntry[]),
      ).rejects.toThrow(/Both startTime and endTime/i);
    });
  });

  describe("multi-employee patterns", () => {
    it("handles multiple employees with different time-off patterns", async () => {
      const baseConfig = createBaseConfig({
        employees: [
          { id: "emp1", roleIds: ["waiter"] },
          { id: "emp2", roleIds: ["waiter"] },
          { id: "emp3", roleIds: ["waiter"] },
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
          specificDates: [
            "2024-02-05", // Monday
            "2024-02-06", // Tuesday
            "2024-02-07", // Wednesday
            "2024-02-08", // Thursday
            "2024-02-09", // Friday
          ],
        },
        targetCount: 1,
      });

      const rules: CpsatRuleConfigEntry[] = [
        {
          name: "time-off",
          config: {
            employeeIds: ["emp1"],
            specificDates: ["2024-02-07"],
            priority: "MANDATORY",
          },
        },
        {
          name: "time-off",
          config: {
            employeeIds: ["emp2"],
            specificDates: ["2024-02-08", "2024-02-09"],
            startTime: { hours: 0, minutes: 0 },
            endTime: { hours: 14, minutes: 0 },
            priority: "MANDATORY",
          },
        },
      ];

      const response = await solveWithRules(client, baseConfig, rules);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      const emp1Wednesday = assignments.filter(
        (a) => a?.employeeId === "emp1" && a?.day === "2024-02-07",
      );
      expect(emp1Wednesday).toHaveLength(0);

      const emp2ThursdayMorning = assignments.filter(
        (a) => a?.employeeId === "emp2" && a?.day === "2024-02-08" && a?.shiftPatternId === "morning",
      );
      expect(emp2ThursdayMorning).toHaveLength(0);
    }, 60_000);

    it("handles role-based time-off affecting multiple employees", async () => {
      const baseConfig = createBaseConfig({
        employees: [
          { id: "chef1", roleIds: ["chef"] },
          { id: "chef2", roleIds: ["chef"] },
          { id: "waiter1", roleIds: ["waiter"] },
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
        schedulingPeriod: { specificDates: ["2024-02-05"] },
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
          config: {
            roleIds: ["chef"],
            dayOfWeek: ["monday"],
            startTime: { hours: 14, minutes: 0 },
            endTime: { hours: 23, minutes: 59 },
            priority: "MANDATORY",
          },
        },
      ];

      const response = await solveWithRules(client, baseConfig, rules);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      const chefEveningAssignments = assignments.filter(
        (a) =>
          (a?.employeeId === "chef1" || a?.employeeId === "chef2") && a?.shiftPatternId === "evening",
      );
      expect(chefEveningAssignments).toHaveLength(0);

      const waiterEvening = assignments.filter(
        (a) => a?.employeeId === "waiter1" && a?.shiftPatternId === "evening",
      );
      expect(waiterEvening).toHaveLength(1);
    }, 30_000);

    it("handles recurring time-off patterns (infeasible case)", async () => {
      const baseConfig = createBaseConfig({ roleId: "waiter",
        shift: {
          id: "day",
          startTime: { hours: 10, minutes: 0 },
          endTime: { hours: 18, minutes: 0 },
        },
        schedulingPeriod: {
          specificDates: [
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
          config: {
            dayOfWeek: ["sunday"],
            priority: "MANDATORY",
          },
        },
      ];

      const response = await solveWithRules(client, baseConfig, rules);

      expect(response.status).toBe("INFEASIBLE");
    }, 30_000);
  });

  describe("skill-scoped time-off", () => {
    it("blocks employees with matching skill", async () => {
      const baseConfig = createBaseConfig({
        employees: [
          { id: "alice", roleIds: ["waiter"], skillIds: ["keyholder"] },
          { id: "bob", roleIds: ["waiter"], skillIds: ["keyholder"] },
          { id: "charlie", roleIds: ["waiter"] },
        ],
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
        schedulingPeriod: { specificDates: ["2024-02-05"] },
        targetCount: 2,
      });

      const rules: CpsatRuleConfigEntry[] = [
        {
          name: "time-off",
          config: {
            skillIds: ["keyholder"],
            dayOfWeek: ["monday"],
            priority: "MANDATORY",
          },
        },
      ];

      const response = await solveWithRules(client, baseConfig, rules);

      expect(response.status).toBe("INFEASIBLE");
    }, 30_000);

    it("allows non-skilled employees to work", async () => {
      const baseConfig = createBaseConfig({
        employees: [
          { id: "alice", roleIds: ["waiter"], skillIds: ["keyholder"] },
          { id: "bob", roleIds: ["waiter"] },
          { id: "charlie", roleIds: ["waiter"] },
        ],
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
        schedulingPeriod: { specificDates: ["2024-02-05"] },
        targetCount: 2,
      });

      const rules: CpsatRuleConfigEntry[] = [
        {
          name: "time-off",
          config: {
            skillIds: ["keyholder"],
            dayOfWeek: ["monday"],
            priority: "MANDATORY",
          },
        },
      ];

      const response = await solveWithRules(client, baseConfig, rules);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      expect(assignments).toHaveLength(2);
      const assignedIds = assignments.map((a) => a?.employeeId).toSorted();
      expect(assignedIds).toEqual(["bob", "charlie"]);
    }, 30_000);
  });

  describe("combined with other rules", () => {
    it("combines time-off with max-hours-week constraint", async () => {
      const baseConfig = createBaseConfig({
        employees: [
          { id: "alice", roleIds: ["worker"] },
          { id: "bob", roleIds: ["worker"] },
        ],
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
        schedulingPeriod: {
          specificDates: [
            "2024-02-05", // Mon
            "2024-02-06", // Tue
            "2024-02-07", // Wed
            "2024-02-08", // Thu
            "2024-02-09", // Fri
            "2024-02-10", // Sat
            "2024-02-11", // Sun
          ],
        },
        targetCount: 1,
      });

      const rules: CpsatRuleConfigEntry[] = [
        {
          name: "time-off",
          config: {
            employeeIds: ["alice"],
            dateRange: { start: "2024-02-07", end: "2024-02-08" },
            priority: "MANDATORY",
          },
        },
        {
          name: "max-hours-week",
          config: {
            hours: 32,
            priority: "MANDATORY",
            weekStartsOn: "monday",
          },
        },
      ];

      const response = await solveWithRules(client, baseConfig, rules);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      const aliceAssignments = assignments.filter((a) => a?.employeeId === "alice");
      expect(aliceAssignments.length).toBeLessThanOrEqual(4);

      const aliceWedThu = aliceAssignments.filter(
        (a) => a?.day === "2024-02-07" || a?.day === "2024-02-08",
      );
      expect(aliceWedThu).toHaveLength(0);
    }, 60_000);

    it("combines time-off with min-rest-between-shifts", async () => {
      const builder = new ModelBuilder({
        employees: [
          { id: "alice", roleIds: ["nurse"] },
          { id: "bob", roleIds: ["nurse"] },
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
        schedulingPeriod: { specificDates: ["2024-02-05", "2024-02-06", "2024-02-07"] },
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
            config: {
              hours: 10,
              priority: "MANDATORY",
            },
          },
          {
            name: "time-off",
            config: {
              employeeIds: ["alice"],
              specificDates: ["2024-02-06"],
              priority: "MANDATORY",
            },
          },
        ],
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      const aliceTuesday = assignments.filter(
        (a) => a?.employeeId === "alice" && a?.day === "2024-02-06",
      );
      expect(aliceTuesday).toHaveLength(0);

      const tuesdayAssignments = assignments.filter((a) => a?.day === "2024-02-06");
      expect(tuesdayAssignments.length).toBeGreaterThanOrEqual(1);
    }, 60_000);
  });
});
