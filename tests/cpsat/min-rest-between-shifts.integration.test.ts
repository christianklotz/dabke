import { beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import { parseSolverResponse, resolveAssignments } from "../../src/cpsat/response.js";
import { createBaseConfig, decodeAssignments, solveWithRules, getSolverClient } from "./helpers.js";

describe("CP-SAT: min-rest-between-shifts rule", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  it("respects minimum rest between shifts across days", async () => {
    const baseConfig = createBaseConfig({
      roleId: "chef",
      shiftPatterns: [
        {
          id: "late",
          roleIds: ["chef"],
          startTime: { hours: 14, minutes: 0 },
          endTime: { hours: 22, minutes: 0 },
        },
        {
          id: "early",
          roleIds: ["chef"],
          startTime: { hours: 6, minutes: 0 },
          endTime: { hours: 14, minutes: 0 },
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-02" } },
      coverage: [
        {
          day: "2024-02-01",
          roleIds: ["chef"],
          startTime: { hours: 14, minutes: 0 },
          endTime: { hours: 22, minutes: 0 },
          targetCount: 1,
          priority: "MANDATORY" as const,
        },
        {
          day: "2024-02-02",
          roleIds: ["chef"],
          startTime: { hours: 6, minutes: 0 },
          endTime: { hours: 14, minutes: 0 },
          targetCount: 1,
          priority: "MANDATORY" as const,
        },
      ],
    });

    const preference: CpsatRuleConfigEntry[] = [
      {
        name: "assignment-priority",
        memberIds: ["alice"],
        preference: "prefer",
      },
      {
        name: "assignment-priority",
        memberIds: ["bob"],
        preference: "avoid",
      },
    ];

    // Baseline: Without rest rule, alice can work late on day1 and early on day2
    const baseline = await solveWithRules(client, baseConfig, preference);
    expect(baseline.status).toBe("OPTIMAL");
    const baselineAssignments = decodeAssignments(baseline.values);
    const aliceLateDay1 = baselineAssignments.some(
      (a) => a.memberId === "alice" && a.shiftPatternId === "late" && a.day === "2024-02-01",
    );
    const aliceEarlyDay2 = baselineAssignments.some(
      (a) => a.memberId === "alice" && a.shiftPatternId === "early" && a.day === "2024-02-02",
    );
    // Baseline should have alice working both conflicting shifts
    expect(aliceLateDay1 && aliceEarlyDay2).toBe(true);

    // With rest rule: alice can't work late then start early next day because the 8-hour gap is under the 10-hour minimum.
    const withRest = await solveWithRules(client, baseConfig, [
      ...preference,
      {
        name: "min-rest-between-shifts",
        hours: 10,
        priority: "MANDATORY",
      },
    ] satisfies CpsatRuleConfigEntry[]);
    expect(withRest.status).toBe("OPTIMAL");
    const restAssignments = decodeAssignments(withRest.values);
    const aliceLateDay1WithRest = restAssignments.some(
      (a) => a.memberId === "alice" && a.shiftPatternId === "late" && a.day === "2024-02-01",
    );
    const aliceEarlyDay2WithRest = restAssignments.some(
      (a) => a.memberId === "alice" && a.shiftPatternId === "early" && a.day === "2024-02-02",
    );
    // Rest rule should prevent alice from working BOTH conflicting shifts
    expect(aliceLateDay1WithRest && aliceEarlyDay2WithRest).toBe(false);
  }, 30_000);

  it("reports a soft rest breach exactly once", async () => {
    const builder = new ModelBuilder({
      members: [{ id: "alice", roleIds: ["chef"] }],
      shiftPatterns: [
        {
          id: "late",
          roleIds: ["chef"],
          startTime: { hours: 14, minutes: 0 },
          endTime: { hours: 22, minutes: 0 },
        },
        {
          id: "early",
          roleIds: ["chef"],
          startTime: { hours: 6, minutes: 0 },
          endTime: { hours: 14, minutes: 0 },
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-02" } },
      coverage: [
        {
          day: "2024-02-01",
          roleIds: ["chef"],
          startTime: { hours: 14, minutes: 0 },
          endTime: { hours: 22, minutes: 0 },
          targetCount: 1,
          priority: "MANDATORY",
        },
        {
          day: "2024-02-02",
          roleIds: ["chef"],
          startTime: { hours: 6, minutes: 0 },
          endTime: { hours: 14, minutes: 0 },
          targetCount: 1,
          priority: "MANDATORY",
        },
      ],
      ruleConfigs: [
        {
          name: "min-rest-between-shifts",
          hours: 10,
          priority: "LOW",
        },
      ],
    });

    const compilation = builder.compile();
    expect(compilation.canSolve).toBe(true);

    const response = await client.solve(compilation.request);
    expect(response.status).toBe("OPTIMAL");

    const parsed = parseSolverResponse(response);
    const resolved = resolveAssignments(parsed.assignments, builder.shiftPatterns);

    builder.reporter.analyzeSolution(response);
    builder.validateSolution(resolved);

    const violations = builder.reporter
      .getValidation()
      .violations.filter(
        (violation) => violation.type === "rule" && violation.rule === "min-rest-between-shifts",
      );

    expect(violations).toHaveLength(1);
  }, 30_000);

  it("fails loudly when solver metadata omits soft violations for soft rest rules", async () => {
    const builder = new ModelBuilder({
      members: [{ id: "alice", roleIds: ["chef"] }],
      shiftPatterns: [
        {
          id: "late",
          roleIds: ["chef"],
          startTime: { hours: 14, minutes: 0 },
          endTime: { hours: 22, minutes: 0 },
        },
        {
          id: "early",
          roleIds: ["chef"],
          startTime: { hours: 6, minutes: 0 },
          endTime: { hours: 14, minutes: 0 },
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-02" } },
      coverage: [
        {
          day: "2024-02-01",
          roleIds: ["chef"],
          startTime: { hours: 14, minutes: 0 },
          endTime: { hours: 22, minutes: 0 },
          targetCount: 1,
          priority: "MANDATORY",
        },
        {
          day: "2024-02-02",
          roleIds: ["chef"],
          startTime: { hours: 6, minutes: 0 },
          endTime: { hours: 14, minutes: 0 },
          targetCount: 1,
          priority: "MANDATORY",
        },
      ],
      ruleConfigs: [
        {
          name: "min-rest-between-shifts",
          hours: 10,
          priority: "LOW",
        },
      ],
    });

    const compilation = builder.compile();
    expect(compilation.canSolve).toBe(true);

    const response = await client.solve(compilation.request);
    expect(response.status).toBe("OPTIMAL");

    const {
      softConstraintViolations: _softConstraintViolations,
      ...responseWithoutSoftConstraintViolations
    } = response;

    expect(() =>
      builder.reporter.analyzeSolution(
        // @ts-expect-error: runtime validation coverage for malformed solver payload
        responseWithoutSoftConstraintViolations,
      ),
    ).toThrow(/missing softConstraintViolations/i);
  }, 30_000);
});
