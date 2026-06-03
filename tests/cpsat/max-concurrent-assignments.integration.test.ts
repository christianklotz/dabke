import { beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { decodeAssignments, getSolverClient, solveWithRules } from "./helpers.js";

describe("CP-SAT: max-concurrent-assignments rule", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("makes overlapping coverage infeasible when the cap is mandatory", async () => {
    const response = await solveWithRules(
      client,
      {
        members: [
          { id: "alice", roleIds: ["stylist"] },
          { id: "bob", roleIds: ["stylist"] },
          { id: "charlie", roleIds: ["stylist"] },
        ],
        shiftPatterns: [
          {
            id: "day",
            roleIds: ["stylist"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [
          {
            day: "2024-02-01",
            roleIds: ["stylist"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 3,
            priority: "MANDATORY",
          },
        ],
      },
      [
        {
          name: "max-concurrent-assignments",
          roleIds: ["stylist"],
          assignments: 2,
          priority: "MANDATORY",
        } satisfies CpsatRuleConfigEntry,
      ],
    );

    expect(response.status).toBe("INFEASIBLE");
  }, 30_000);

  it("caps concurrency without capping sequential shifts across a day", async () => {
    const response = await solveWithRules(
      client,
      {
        members: [{ id: "alice", roleIds: ["stylist"] }],
        shiftPatterns: [
          {
            id: "morning",
            roleIds: ["stylist"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 12, minutes: 0 },
          },
          {
            id: "afternoon",
            roleIds: ["stylist"],
            startTime: { hours: 12, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [
          {
            day: "2024-02-01",
            roleIds: ["stylist"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 12, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-02-01",
            roleIds: ["stylist"],
            startTime: { hours: 12, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      },
      [
        {
          name: "max-concurrent-assignments",
          roleIds: ["stylist"],
          assignments: 1,
          priority: "MANDATORY",
        } satisfies CpsatRuleConfigEntry,
      ],
    );

    expect(response.status).toBe("OPTIMAL");

    const assignments = decodeAssignments(response.values);
    expect(assignments).toHaveLength(2);
    expect(assignments.every((assignment) => assignment.memberId === "alice")).toBe(true);
  }, 30_000);

  it("can scope the cap to a partial-day window", async () => {
    const response = await solveWithRules(
      client,
      {
        members: [
          { id: "alice", roleIds: ["stylist"] },
          { id: "bob", roleIds: ["stylist"] },
        ],
        shiftPatterns: [
          {
            id: "morning",
            roleIds: ["stylist"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 12, minutes: 0 },
          },
          {
            id: "afternoon",
            roleIds: ["stylist"],
            startTime: { hours: 12, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [
          {
            day: "2024-02-01",
            roleIds: ["stylist"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 12, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-02-01",
            roleIds: ["stylist"],
            startTime: { hours: 12, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 2,
            priority: "MANDATORY",
          },
        ],
      },
      [
        {
          name: "max-concurrent-assignments",
          roleIds: ["stylist"],
          assignments: 1,
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 12, minutes: 0 },
          priority: "MANDATORY",
        } satisfies CpsatRuleConfigEntry,
      ],
    );

    expect(response.status).toBe("OPTIMAL");

    const assignments = decodeAssignments(response.values);
    expect(assignments).toHaveLength(3);
    expect(
      assignments.filter((assignment) => assignment.shiftPatternId === "morning"),
    ).toHaveLength(1);
    expect(
      assignments.filter((assignment) => assignment.shiftPatternId === "afternoon"),
    ).toHaveLength(2);
  }, 30_000);

  it("can scope the cap to one role while leaving other roles unaffected", async () => {
    const response = await solveWithRules(
      client,
      {
        members: [
          { id: "waiter1", roleIds: ["waiter"] },
          { id: "waiter2", roleIds: ["waiter"] },
          { id: "manager1", roleIds: ["manager"] },
        ],
        shiftPatterns: [
          {
            id: "waiter_day",
            roleIds: ["waiter"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
          {
            id: "manager_day",
            roleIds: ["manager"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [
          {
            day: "2024-02-01",
            roleIds: ["waiter"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 2,
            priority: "MANDATORY",
          },
          {
            day: "2024-02-01",
            roleIds: ["manager"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      },
      [
        {
          name: "max-concurrent-assignments",
          roleIds: ["waiter"],
          assignments: 2,
          priority: "MANDATORY",
        } satisfies CpsatRuleConfigEntry,
      ],
    );

    expect(response.status).toBe("OPTIMAL");

    const assignments = decodeAssignments(response.values);
    expect(assignments).toHaveLength(3);
    expect(
      assignments.filter((assignment) => assignment.shiftPatternId === "waiter_day"),
    ).toHaveLength(2);
    expect(
      assignments.filter((assignment) => assignment.shiftPatternId === "manager_day"),
    ).toHaveLength(1);
  }, 30_000);
});
