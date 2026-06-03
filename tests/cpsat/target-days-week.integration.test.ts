import { beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { getSolverClient, solveWithRules } from "./helpers.js";

describe("CP-SAT: target-days-week rule", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("has no violation when the weekly target is matched exactly", async () => {
    const response = await solveWithRules(
      client,
      {
        members: [{ id: "alice", roleIds: ["stylist"] }],
        shiftPatterns: [
          {
            id: "day",
            roleIds: ["stylist"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-11" } },
        coverage: [
          {
            day: "2024-02-05",
            roleIds: ["stylist"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-02-06",
            roleIds: ["stylist"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-02-07",
            roleIds: ["stylist"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-02-08",
            roleIds: ["stylist"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      },
      [
        {
          name: "target-days-week",
          roleIds: ["stylist"],
          days: 4,
          priority: "HIGH",
        } satisfies CpsatRuleConfigEntry,
      ],
    );

    expect(response.status).toBe("OPTIMAL");
    const violations = response.softConstraintViolations ?? [];
    expect(
      violations.some((violation) => violation.constraintId.startsWith("target-days-week:")),
    ).toBe(false);
  }, 30_000);

  it("remains feasible and reports an under-target violation when the weekly target is unreachable", async () => {
    const response = await solveWithRules(
      client,
      {
        members: [{ id: "alice", roleIds: ["stylist"] }],
        shiftPatterns: [
          {
            id: "day",
            roleIds: ["stylist"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-11" } },
        coverage: [
          {
            day: "2024-02-05",
            roleIds: ["stylist"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-02-06",
            roleIds: ["stylist"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-02-07",
            roleIds: ["stylist"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      },
      [
        {
          name: "target-days-week",
          roleIds: ["stylist"],
          days: 4,
          priority: "HIGH",
        } satisfies CpsatRuleConfigEntry,
      ],
    );

    expect(response.status).toBe("OPTIMAL");
    const violations = response.softConstraintViolations ?? [];
    expect(
      violations.some((violation) => violation.constraintId.startsWith("target-days-week:under:")),
    ).toBe(true);
  }, 30_000);

  it("remains feasible and reports an over-target violation when the weekly target is exceeded", async () => {
    const response = await solveWithRules(
      client,
      {
        members: [{ id: "alice", roleIds: ["stylist"] }],
        shiftPatterns: [
          {
            id: "day",
            roleIds: ["stylist"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-11" } },
        coverage: [
          {
            day: "2024-02-05",
            roleIds: ["stylist"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-02-06",
            roleIds: ["stylist"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-02-07",
            roleIds: ["stylist"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-02-08",
            roleIds: ["stylist"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2024-02-09",
            roleIds: ["stylist"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      },
      [
        {
          name: "target-days-week",
          roleIds: ["stylist"],
          days: 4,
          priority: "HIGH",
        } satisfies CpsatRuleConfigEntry,
      ],
    );

    expect(response.status).toBe("OPTIMAL");
    const violations = response.softConstraintViolations ?? [];
    expect(
      violations.some((violation) => violation.constraintId.startsWith("target-days-week:over:")),
    ).toBe(true);
  }, 30_000);

  it("reports an under-target violation when a scoped week has no assignable days", async () => {
    const response = await solveWithRules(
      client,
      {
        members: [{ id: "alice", roleIds: ["stylist"] }],
        shiftPatterns: [
          {
            id: "manager-day",
            roleIds: ["manager"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-11" } },
        coverage: [],
      },
      [
        {
          name: "target-days-week",
          roleIds: ["stylist"],
          days: 4,
          priority: "HIGH",
        } satisfies CpsatRuleConfigEntry,
      ],
    );

    expect(response.status).toBe("OPTIMAL");

    const underViolation = response.softConstraintViolations?.find((violation) =>
      violation.constraintId.startsWith("target-days-week:under:"),
    );

    expect(underViolation).toBeDefined();
    expect(underViolation?.violationAmount).toBe(4);
  }, 30_000);
});
