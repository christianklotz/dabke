import { beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { decodeAssignments, getSolverClient, solveWithRules } from "./helpers.js";

describe("CP-SAT: target-peak-concurrent-assignments rule", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("reaches the peak target on split shifts when enough staff exist", async () => {
    const response = await solveWithRules(
      client,
      {
        members: [
          { id: "a", roleIds: ["stylist"] },
          { id: "b", roleIds: ["stylist"] },
          { id: "c", roleIds: ["stylist"] },
          { id: "d", roleIds: ["stylist"] },
          { id: "e", roleIds: ["stylist"] },
        ],
        shiftPatterns: [
          {
            id: "open1",
            roleIds: ["stylist"],
            startTime: { hours: 10, minutes: 0 },
            endTime: { hours: 19, minutes: 0 },
          },
          {
            id: "open2",
            roleIds: ["stylist"],
            startTime: { hours: 10, minutes: 0 },
            endTime: { hours: 19, minutes: 0 },
          },
          {
            id: "close1",
            roleIds: ["stylist"],
            startTime: { hours: 11, minutes: 0 },
            endTime: { hours: 20, minutes: 0 },
          },
          {
            id: "close2",
            roleIds: ["stylist"],
            startTime: { hours: 11, minutes: 0 },
            endTime: { hours: 20, minutes: 0 },
          },
          {
            id: "close3",
            roleIds: ["stylist"],
            startTime: { hours: 11, minutes: 0 },
            endTime: { hours: 20, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [
          {
            day: "2024-02-01",
            roleIds: ["stylist"],
            startTime: { hours: 10, minutes: 0 },
            endTime: { hours: 11, minutes: 0 },
            targetCount: 2,
            priority: "MANDATORY",
          },
          {
            day: "2024-02-01",
            roleIds: ["stylist"],
            startTime: { hours: 19, minutes: 0 },
            endTime: { hours: 20, minutes: 0 },
            targetCount: 2,
            priority: "MANDATORY",
          },
        ],
      },
      [
        {
          name: "max-concurrent-assignments",
          roleIds: ["stylist"],
          assignments: 5,
          priority: "MANDATORY",
        } satisfies CpsatRuleConfigEntry,
        {
          name: "max-shifts-day",
          roleIds: ["stylist"],
          shifts: 1,
          priority: "MANDATORY",
        } satisfies CpsatRuleConfigEntry,
        {
          name: "target-peak-concurrent-assignments",
          roleIds: ["stylist"],
          assignments: 5,
          priority: "HIGH",
        } satisfies CpsatRuleConfigEntry,
      ],
    );

    expect(response.status).toBe("OPTIMAL");

    const assignments = decodeAssignments(response.values);
    expect(assignments).toHaveLength(5);
  }, 30_000);

  it("activates an extra overlapping shift when the HIGH peak target is reachable", async () => {
    const response = await solveWithRules(
      client,
      {
        members: [
          { id: "open_member", roleIds: ["opener"] },
          { id: "close_member", roleIds: ["closer"] },
          { id: "float_member", roleIds: ["floater"] },
        ],
        shiftPatterns: [
          {
            id: "open",
            roleIds: ["opener"],
            startTime: { hours: 10, minutes: 0 },
            endTime: { hours: 14, minutes: 0 },
          },
          {
            id: "close",
            roleIds: ["closer"],
            startTime: { hours: 12, minutes: 0 },
            endTime: { hours: 16, minutes: 0 },
          },
          {
            id: "middle",
            roleIds: ["floater"],
            startTime: { hours: 11, minutes: 0 },
            endTime: { hours: 15, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [
          {
            day: "2024-02-01",
            roleIds: ["opener"],
            startTime: { hours: 10, minutes: 0 },
            endTime: { hours: 11, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-02-01",
            roleIds: ["closer"],
            startTime: { hours: 15, minutes: 0 },
            endTime: { hours: 16, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      },
      [
        {
          name: "max-concurrent-assignments",
          roleIds: ["opener", "closer", "floater"],
          assignments: 3,
          priority: "MANDATORY",
        } satisfies CpsatRuleConfigEntry,
        {
          name: "max-shifts-day",
          roleIds: ["opener", "closer", "floater"],
          shifts: 1,
          priority: "MANDATORY",
        } satisfies CpsatRuleConfigEntry,
        {
          name: "target-peak-concurrent-assignments",
          roleIds: ["opener", "closer", "floater"],
          assignments: 3,
          priority: "HIGH",
        } satisfies CpsatRuleConfigEntry,
      ],
    );

    expect(response.status).toBe("OPTIMAL");

    const assignments = decodeAssignments(response.values);
    expect(assignments).toHaveLength(3);
    expect(assignments.some((assignment) => assignment.shiftPatternId === "middle")).toBe(true);
  }, 30_000);

  it("remains feasible when the peak target is unreachable", async () => {
    const response = await solveWithRules(
      client,
      {
        members: [
          { id: "a", roleIds: ["stylist"] },
          { id: "b", roleIds: ["stylist"] },
          { id: "c", roleIds: ["stylist"] },
          { id: "d", roleIds: ["stylist"] },
        ],
        shiftPatterns: [
          {
            id: "open1",
            roleIds: ["stylist"],
            startTime: { hours: 10, minutes: 0 },
            endTime: { hours: 19, minutes: 0 },
          },
          {
            id: "open2",
            roleIds: ["stylist"],
            startTime: { hours: 10, minutes: 0 },
            endTime: { hours: 19, minutes: 0 },
          },
          {
            id: "close1",
            roleIds: ["stylist"],
            startTime: { hours: 11, minutes: 0 },
            endTime: { hours: 20, minutes: 0 },
          },
          {
            id: "close2",
            roleIds: ["stylist"],
            startTime: { hours: 11, minutes: 0 },
            endTime: { hours: 20, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [
          {
            day: "2024-02-01",
            roleIds: ["stylist"],
            startTime: { hours: 10, minutes: 0 },
            endTime: { hours: 11, minutes: 0 },
            targetCount: 2,
            priority: "MANDATORY",
          },
          {
            day: "2024-02-01",
            roleIds: ["stylist"],
            startTime: { hours: 19, minutes: 0 },
            endTime: { hours: 20, minutes: 0 },
            targetCount: 2,
            priority: "MANDATORY",
          },
        ],
      },
      [
        {
          name: "max-concurrent-assignments",
          roleIds: ["stylist"],
          assignments: 5,
          priority: "MANDATORY",
        } satisfies CpsatRuleConfigEntry,
        {
          name: "max-shifts-day",
          roleIds: ["stylist"],
          shifts: 1,
          priority: "MANDATORY",
        } satisfies CpsatRuleConfigEntry,
        {
          name: "target-peak-concurrent-assignments",
          roleIds: ["stylist"],
          assignments: 5,
          priority: "HIGH",
        } satisfies CpsatRuleConfigEntry,
      ],
    );

    expect(response.status).toBe("OPTIMAL");

    const violations = response.softConstraintViolations ?? [];
    expect(
      violations.some((violation) =>
        violation.constraintId.startsWith("rule:target-peak-concurrent-assignments:5:"),
      ),
    ).toBe(true);
  }, 30_000);

  it("reports a shortfall when no eligible assignments exist on the scoped day", async () => {
    const response = await solveWithRules(
      client,
      {
        members: [{ id: "a", roleIds: ["stylist"] }],
        shiftPatterns: [],
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [],
      },
      [
        {
          name: "target-peak-concurrent-assignments",
          roleIds: ["stylist"],
          assignments: 5,
          priority: "HIGH",
        } satisfies CpsatRuleConfigEntry,
      ],
    );

    expect(response.status).toBe("OPTIMAL");
    expect(
      (response.softConstraintViolations ?? []).some((violation) =>
        violation.constraintId.startsWith("rule:target-peak-concurrent-assignments:5:"),
      ),
    ).toBe(true);
  }, 30_000);
});
