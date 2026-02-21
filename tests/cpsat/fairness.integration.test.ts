import { describe, it, expect, beforeAll } from "vitest";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import { getSolverClient, decodeAssignments, solveWithRules } from "./helpers.js";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";

/**
 * Integration tests for fair distribution of shifts.
 *
 * The solver should distribute work fairly among members by default,
 * rather than assigning all work to a single person.
 */
describe("Fair distribution (integration)", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  describe("Two members, one shift per day for a week", () => {
    it("should distribute shifts fairly between two members over 7 days", async () => {
      // Scenario: Retail shop open 9-5pm every day, need 1 person (8:30am-5:30pm)
      // Two members: Anne and John
      // Fair distribution: each should work roughly half the days (3-4 days each)
      const days = [
        "2024-02-05", // Monday
        "2024-02-06", // Tuesday
        "2024-02-07", // Wednesday
        "2024-02-08", // Thursday
        "2024-02-09", // Friday
        "2024-02-10", // Saturday
        "2024-02-11", // Sunday
      ];

      const builder = new ModelBuilder({
        members: [
          { id: "anne", roleIds: ["staff"] },
          { id: "john", roleIds: ["staff"] },
        ],
        shiftPatterns: [
          {
            id: "day",
            roleIds: ["staff"] as [string, ...string[]],
            startTime: { hours: 8, minutes: 30 },
            endTime: { hours: 17, minutes: 30 },
          },
        ],
        schedulingPeriod: { dateRange: { start: days[0]!, end: days[days.length - 1]! } },
        coverage: days.map((day) => ({
          day,
          roleIds: ["staff"] as [string, ...string[]],
          startTime: { hours: 8, minutes: 30 },
          endTime: { hours: 17, minutes: 30 },
          targetCount: 1,
          priority: "MANDATORY" as const,
        })),
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      // Should have exactly 7 assignments (one per day)
      expect(assignments).toHaveLength(7);

      // Count assignments per member
      const anneDays = assignments.filter((a) => a?.memberId === "anne").length;
      const johnDays = assignments.filter((a) => a?.memberId === "john").length;

      console.log(`Anne: ${anneDays} days, John: ${johnDays} days`);

      // Fair distribution means neither member should work all 7 days
      // and both should work at least some days
      // Ideal: 3-4 days each
      expect(anneDays).toBeGreaterThan(0);
      expect(johnDays).toBeGreaterThan(0);
      expect(anneDays).toBeLessThan(7);
      expect(johnDays).toBeLessThan(7);

      // More strict check: each should work between 3-4 days
      expect(anneDays).toBeGreaterThanOrEqual(3);
      expect(anneDays).toBeLessThanOrEqual(4);
      expect(johnDays).toBeGreaterThanOrEqual(3);
      expect(johnDays).toBeLessThanOrEqual(4);
    }, 30_000);

    it("should distribute shifts fairly with three members over 7 days", async () => {
      // Similar scenario but with 3 members
      // Fair distribution: ~2-3 days each
      const days = [
        "2024-02-05",
        "2024-02-06",
        "2024-02-07",
        "2024-02-08",
        "2024-02-09",
        "2024-02-10",
        "2024-02-11",
      ];

      const builder = new ModelBuilder({
        members: [
          { id: "anne", roleIds: ["staff"] },
          { id: "john", roleIds: ["staff"] },
          { id: "mary", roleIds: ["staff"] },
        ],
        shiftPatterns: [
          {
            id: "day",
            roleIds: ["staff"] as [string, ...string[]],
            startTime: { hours: 8, minutes: 30 },
            endTime: { hours: 17, minutes: 30 },
          },
        ],
        schedulingPeriod: { dateRange: { start: days[0]!, end: days[days.length - 1]! } },
        coverage: days.map((day) => ({
          day,
          roleIds: ["staff"] as [string, ...string[]],
          startTime: { hours: 8, minutes: 30 },
          endTime: { hours: 17, minutes: 30 },
          targetCount: 1,
          priority: "MANDATORY" as const,
        })),
      });

      const { request } = builder.compile();
      const response = await client.solve(request);

      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      expect(assignments).toHaveLength(7);

      // Count assignments per member
      const counts: Record<string, number> = {};
      for (const a of assignments) {
        const id = a?.memberId ?? "unknown";
        counts[id] = (counts[id] ?? 0) + 1;
      }

      console.log("Assignment counts:", counts);

      // Min-max fairness: no member works more than ceil(7/3) = 3 days
      // The solver minimizes the maximum, so at least one member must work 3 days
      // and the rest should work at most 3 days
      const maxCount = Math.max(...Object.values(counts));
      expect(maxCount).toBeLessThanOrEqual(3);

      // At least 2 members should be used (could be 2 or 3 depending on solver choice)
      expect(Object.keys(counts).length).toBeGreaterThanOrEqual(2);
    }, 30_000);
  });

  describe("Fairness interacts with preferences", () => {
    it("member-assignment-priority can override fairness when needed", async () => {
      // Scenario: Prefer permanent staff (Anne) over temp staff (John)
      // Fairness should still apply but preference should win
      const baseConfig = {
        members: [
          { id: "anne", roleIds: ["staff"] },
          { id: "john", roleIds: ["staff"] },
        ],
        shiftPatterns: [
          {
            id: "day",
            roleIds: ["staff"] as [string],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-08" } },
        coverage: ["2024-02-05", "2024-02-06", "2024-02-07", "2024-02-08"].map((day) => ({
          day,
          roleIds: ["staff"] as [string, ...string[]],
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
          targetCount: 1,
          priority: "MANDATORY" as const,
        })),
      };

      // With strong preference for Anne, she should get more shifts
      const rules: CpsatRuleConfigEntry[] = [
        {
          name: "assignment-priority",
          memberIds: ["anne"],
          preference: "high",
        },
        {
          name: "assignment-priority",
          memberIds: ["john"],
          preference: "low",
        },
      ];

      const response = await solveWithRules(client, baseConfig, rules);
      expect(response.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(response.values);

      const anneDays = assignments.filter((a) => a?.memberId === "anne").length;
      const johnDays = assignments.filter((a) => a?.memberId === "john").length;

      console.log(`With preference - Anne: ${anneDays} days, John: ${johnDays} days`);

      // Anne should get all or most shifts due to preference
      // The preference weight (±10) should dominate fairness weight (5 for max)
      expect(anneDays).toBeGreaterThanOrEqual(3);
    }, 30_000);

    it("fairness can be disabled via config", async () => {
      const days = ["2024-02-05", "2024-02-06", "2024-02-07"];

      const builder = new ModelBuilder({
        members: [
          { id: "anne", roleIds: ["staff"] },
          { id: "john", roleIds: ["staff"] },
        ],
        shiftPatterns: [
          {
            id: "day",
            roleIds: ["staff"] as [string, ...string[]],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: days[0]!, end: days[days.length - 1]! } },
        coverage: days.map((day) => ({
          day,
          roleIds: ["staff"] as [string, ...string[]],
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
          targetCount: 1,
          priority: "MANDATORY" as const,
        })),
        fairDistribution: false, // Disable fairness
      });

      const { request } = builder.compile();

      // Verify no fairness variables were created
      const fairnessVars = request.variables.filter((v) => v.name.startsWith("fairness:"));
      expect(fairnessVars).toHaveLength(0);
    }, 30_000);
  });
});
