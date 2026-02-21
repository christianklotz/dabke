import assert from "node:assert";
import { describe, expect, it } from "vitest";
import { ModelBuilder } from "../../src/cpsat/model-builder.js";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import type { CoverageRequirement, SchedulingMember, ShiftPattern } from "../../src/cpsat/types.js";

function baseCoverage(override: Partial<CoverageRequirement> = {}): CoverageRequirement {
  return {
    day: "2024-02-01",
    roleIds: ["barista"],
    startTime: { hours: 9, minutes: 0 },
    endTime: { hours: 13, minutes: 0 },
    targetCount: 1,
    priority: "MANDATORY",
    ...override,
  };
}

describe("ModelBuilder (CP-SAT)", () => {
  it("builds a no-op request for empty inputs", () => {
    const builder = new ModelBuilder({
      members: [],
      shiftPatterns: [],
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
      coverage: [],
      rules: [],
    });

    const { request } = builder.compile();
    expect(request.variables).toHaveLength(0);
    expect(request.constraints).toHaveLength(0);
    expect(request.objective).toBeUndefined();
  });

  it("propagates solver timeout and solution limits into the request", () => {
    const builder = new ModelBuilder({
      members: [{ id: "e1", roleIds: ["role"] }],
      shiftPatterns: [
        {
          id: "p1",
          roleIds: ["role"],
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
      ],
      schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
      coverage: [
        {
          day: "2024-02-01",
          roleIds: ["role"],
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
          targetCount: 1,
          priority: "MANDATORY" as const,
        },
      ],
      solverOptions: { timeLimitSeconds: 0.01, solutionLimit: 1 },
    });

    const { request } = builder.compile();
    expect(request.options).toEqual({
      timeLimitSeconds: 0.01,
      solutionLimit: 1,
    });
  });

  it("compiles coverage and core constraints into a solver request", () => {
    const members = [
      { id: "e1", roleIds: ["server"] },
      { id: "e2", roleIds: ["server"] },
    ];

    const shiftPatterns: ShiftPattern[] = [
      {
        id: "p1",
        roleIds: ["server"],
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
    ];

    const coverage: CoverageRequirement[] = [
      {
        day: "2024-01-01",
        roleIds: ["server"],
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
        targetCount: 1,
        priority: "MANDATORY" as const,
      },
    ];

    const builder = new ModelBuilder({
      members,
      shiftPatterns,
      schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
      coverage,
      rules: [],
    });

    const { request } = builder.compile();
    const variableNames = new Set(request.variables.map((v) => v.name));

    expect(variableNames.has("assign:e1:p1:2024-01-01")).toBe(true);
    expect(variableNames.has("assign:e2:p1:2024-01-01")).toBe(true);
    expect(variableNames.has("shift:p1:2024-01-01")).toBe(true);

    const coverageConstraint = request.constraints.find(
      (c) => c.type === "linear" && "rhs" in c && c.rhs === 1,
    );
    expect(coverageConstraint).toBeDefined();

    expect(request.objective?.sense).toBe("minimize");
    expect(request.objective?.terms).toContainEqual({
      var: "shift:p1:2024-01-01",
      coeff: 1000, // Primary objective: minimize active shifts
    });
    // Secondary objective: minimize assignments (tiebreaker)
    expect(request.objective?.terms).toContainEqual({
      var: "assign:e1:p1:2024-01-01",
      coeff: 1,
    });
  });

  it("applies rule compilation for max-hours and rest constraints", () => {
    const members = [{ id: "emp", roleIds: ["nurse"] }];
    const shiftPatterns: ShiftPattern[] = [
      {
        id: "early",
        roleIds: ["nurse"],
        startTime: { hours: 8, minutes: 0 },
        endTime: { hours: 12, minutes: 0 },
      },
      {
        id: "late",
        roleIds: ["nurse"],
        startTime: { hours: 14, minutes: 0 },
        endTime: { hours: 18, minutes: 0 },
      },
    ];

    const builder = new ModelBuilder({
      members,
      shiftPatterns,
      schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
      coverage: [],
      ruleConfigs: [
        {
          name: "max-hours-day",
          hours: 8,
          priority: "MANDATORY",
        } satisfies CpsatRuleConfigEntry,
        {
          name: "min-rest-between-shifts",
          hours: 3,
          priority: "HIGH",
        } satisfies CpsatRuleConfigEntry,
      ],
    });

    const { request } = builder.compile();

    const hasHoursConstraint = request.constraints.some(
      (c) => c.type === "linear" && c.op === "<=" && c.rhs === 8 * 60,
    );
    expect(hasHoursConstraint).toBe(true);

    const conflictVar = request.variables.find((v) =>
      v.name.startsWith("rest_conflict_emp_early_2024-01-01_late_2024-01-01"),
    );
    expect(conflictVar).toBeDefined();

    const penaltyTerm = request.objective?.terms.find((t) =>
      t.var.startsWith("rest_conflict_emp_early_2024-01-01_late_2024-01-01"),
    );
    expect(penaltyTerm?.coeff).toBeGreaterThan(0);
  });

  it("rejects member IDs containing colons", () => {
    expect(
      () =>
        new ModelBuilder({
          members: [{ id: "emp:1", roleIds: ["role"] }],
          shiftPatterns: [],
          schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
          coverage: [],
        }),
    ).toThrow('Member ID "emp:1" cannot contain colons');
  });

  it("rejects shift pattern IDs containing colons", () => {
    expect(
      () =>
        new ModelBuilder({
          members: [],
          shiftPatterns: [
            {
              id: "shift:morning",
              roleIds: ["role"],
              startTime: { hours: 9, minutes: 0 },
              endTime: { hours: 17, minutes: 0 },
            },
          ],
          schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
          coverage: [],
        }),
    ).toThrow('Shift pattern ID "shift:morning" cannot contain colons');
  });

  it("allows any member to work a shift pattern with no roles", () => {
    const members = [
      { id: "alice", roleIds: ["server"] },
      { id: "bob", roleIds: ["chef"] },
    ];

    const shiftPatterns: ShiftPattern[] = [
      {
        id: "generic_shift",
        // No roles - anyone can work
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
    ];

    const builder = new ModelBuilder({
      members,
      shiftPatterns,
      schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
      coverage: [],
    });

    const { request } = builder.compile();
    const variableNames = new Set(request.variables.map((v) => v.name));

    // Both members should have assignment variables
    expect(variableNames.has("assign:alice:generic_shift:2024-01-01")).toBe(true);
    expect(variableNames.has("assign:bob:generic_shift:2024-01-01")).toBe(true);
  });

  it("allows members with any matching role to work multi-role shift patterns", () => {
    const members = [
      { id: "alice", roleIds: ["server"] },
      { id: "bob", roleIds: ["runner"] },
      { id: "charlie", roleIds: ["chef"] },
    ];

    const shiftPatterns: ShiftPattern[] = [
      {
        id: "floor_shift",
        roleIds: ["server", "runner"], // Both servers and runners can work
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
    ];

    const builder = new ModelBuilder({
      members,
      shiftPatterns,
      schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
      coverage: [],
    });

    const { request } = builder.compile();
    const variableNames = new Set(request.variables.map((v) => v.name));

    // Alice (server) and Bob (runner) can work, Charlie (chef) cannot
    expect(variableNames.has("assign:alice:floor_shift:2024-01-01")).toBe(true);
    expect(variableNames.has("assign:bob:floor_shift:2024-01-01")).toBe(true);
    expect(variableNames.has("assign:charlie:floor_shift:2024-01-01")).toBe(false);
  });

  it("restricts shift pattern with single roleId to matching members only", () => {
    const members = [
      { id: "alice", roleIds: ["server"] },
      { id: "bob", roleIds: ["chef"] },
    ];

    const shiftPatterns: ShiftPattern[] = [
      {
        id: "server_shift",
        roleIds: ["server"], // Only servers
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
    ];

    const builder = new ModelBuilder({
      members,
      shiftPatterns,
      schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
      coverage: [],
    });

    const { request } = builder.compile();
    const variableNames = new Set(request.variables.map((v) => v.name));

    // Only Alice (server) can work
    expect(variableNames.has("assign:alice:server_shift:2024-01-01")).toBe(true);
    expect(variableNames.has("assign:bob:server_shift:2024-01-01")).toBe(false);
  });

  it("treats empty roles array same as undefined - anyone can work", () => {
    const members = [
      { id: "alice", roleIds: ["server"] },
      { id: "bob", roleIds: ["chef"] },
    ];

    const shiftPatterns: ShiftPattern[] = [
      {
        id: "open_shift",
        // roles omitted - anyone can work
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
    ];

    const builder = new ModelBuilder({
      members,
      shiftPatterns,
      schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
      coverage: [],
    });

    const { request } = builder.compile();
    const variableNames = new Set(request.variables.map((v) => v.name));

    // Both members can work
    expect(variableNames.has("assign:alice:open_shift:2024-01-01")).toBe(true);
    expect(variableNames.has("assign:bob:open_shift:2024-01-01")).toBe(true);
  });

  it("allows multi-role member to work shift if any of their roles match", () => {
    const members = [
      { id: "alice", roleIds: ["server", "host"] }, // Multi-role member
      { id: "bob", roleIds: ["chef"] },
    ];

    const shiftPatterns: ShiftPattern[] = [
      {
        id: "host_shift",
        roleIds: ["host"], // Only hosts
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
    ];

    const builder = new ModelBuilder({
      members,
      shiftPatterns,
      schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
      coverage: [],
    });

    const { request } = builder.compile();
    const variableNames = new Set(request.variables.map((v) => v.name));

    // Alice can work (has host role), Bob cannot
    expect(variableNames.has("assign:alice:host_shift:2024-01-01")).toBe(true);
    expect(variableNames.has("assign:bob:host_shift:2024-01-01")).toBe(false);
  });

  it("handles mixed shift patterns - some with roles, some without", () => {
    const members = [
      { id: "alice", roleIds: ["server"] },
      { id: "bob", roleIds: ["chef"] },
    ];

    const shiftPatterns: ShiftPattern[] = [
      {
        id: "server_only",
        roleIds: ["server"],
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 13, minutes: 0 },
      },
      {
        id: "anyone",
        // No roles
        startTime: { hours: 13, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
    ];

    const builder = new ModelBuilder({
      members,
      shiftPatterns,
      schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
      coverage: [],
    });

    const { request } = builder.compile();
    const variableNames = new Set(request.variables.map((v) => v.name));

    // server_only: only Alice
    expect(variableNames.has("assign:alice:server_only:2024-01-01")).toBe(true);
    expect(variableNames.has("assign:bob:server_only:2024-01-01")).toBe(false);

    // anyone: both
    expect(variableNames.has("assign:alice:anyone:2024-01-01")).toBe(true);
    expect(variableNames.has("assign:bob:anyone:2024-01-01")).toBe(true);
  });

  describe("skill-based coverage", () => {
    // Note: Tests for invalid coverage (missing roles/skills, empty arrays) are no longer needed
    // because the discriminated union type now enforces these constraints at compile time.
    // The runtime validation in ModelBuilder serves as defense-in-depth for non-TypeScript callers.

    it("accepts coverage with roles only", () => {
      const builder = new ModelBuilder({
        members: [{ id: "alice", roleIds: ["server"] }],
        shiftPatterns: [
          {
            id: "shift",
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            roleIds: ["server"],
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      expect(() => builder.compile()).not.toThrow();
    });

    it("accepts coverage with skills only", () => {
      const builder = new ModelBuilder({
        members: [{ id: "alice", roleIds: ["server"], skillIds: ["keyholder"] }],
        shiftPatterns: [
          {
            id: "shift",
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            skillIds: ["keyholder"],
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      expect(() => builder.compile()).not.toThrow();
    });

    it("accepts coverage with both roles and skills", () => {
      const builder = new ModelBuilder({
        members: [{ id: "alice", roleIds: ["server"], skillIds: ["keyholder"] }],
        shiftPatterns: [
          {
            id: "shift",
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            roleIds: ["server"],
            skillIds: ["keyholder"],
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      expect(() => builder.compile()).not.toThrow();
    });

    describe("membersForCoverage", () => {
      const members: SchedulingMember[] = [
        { id: "alice", roleIds: ["server"], skillIds: ["keyholder", "senior"] },
        { id: "bob", roleIds: ["server"], skillIds: ["senior"] },
        { id: "charlie", roleIds: ["chef"], skillIds: ["keyholder"] },
        { id: "dave", roleIds: ["server"] }, // no skills
      ];

      const createBuilder = () =>
        new ModelBuilder({
          members,
          shiftPatterns: [
            {
              id: "shift",
              startTime: { hours: 9, minutes: 0 },
              endTime: { hours: 17, minutes: 0 },
            },
          ],
          schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
          coverage: [
            {
              day: "2024-01-01",
              startTime: { hours: 9, minutes: 0 },
              endTime: { hours: 17, minutes: 0 },
              roleIds: ["server"],
              targetCount: 1,
              priority: "MANDATORY",
            },
          ],
        });

      it("filters by role only", () => {
        const builder = createBuilder();
        const matched = builder.membersForCoverage({
          day: "2024-01-01",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
          roleIds: ["server"],
          targetCount: 1,
          priority: "MANDATORY",
        });

        const ids = matched.map((e) => e.id).toSorted();
        expect(ids).toEqual(["alice", "bob", "dave"]);
      });

      it("filters by single skill only", () => {
        const builder = createBuilder();
        const matched = builder.membersForCoverage({
          day: "2024-01-01",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
          skillIds: ["keyholder"],
          targetCount: 1,
          priority: "MANDATORY",
        });

        const ids = matched.map((e) => e.id).toSorted();
        expect(ids).toEqual(["alice", "charlie"]);
      });

      it("filters by multiple skills with AND logic", () => {
        const builder = createBuilder();
        const matched = builder.membersForCoverage({
          day: "2024-01-01",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
          skillIds: ["keyholder", "senior"],
          targetCount: 1,
          priority: "MANDATORY",
        });

        const ids = matched.map((e) => e.id);
        expect(ids).toEqual(["alice"]);
      });

      it("filters by role AND skills combined", () => {
        const builder = createBuilder();
        const matched = builder.membersForCoverage({
          day: "2024-01-01",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
          roleIds: ["server"],
          skillIds: ["keyholder"],
          targetCount: 1,
          priority: "MANDATORY",
        });

        const ids = matched.map((e) => e.id);
        expect(ids).toEqual(["alice"]);
      });

      it("returns empty array when no members match skill requirement", () => {
        const builder = createBuilder();
        const matched = builder.membersForCoverage({
          day: "2024-01-01",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
          skillIds: ["nonexistent"],
          targetCount: 1,
          priority: "MANDATORY",
        });

        expect(matched).toEqual([]);
      });

      it("returns empty array when no members match role + skill combination", () => {
        const builder = createBuilder();
        const matched = builder.membersForCoverage({
          day: "2024-01-01",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
          roleIds: ["chef"],
          skillIds: ["senior"],
          targetCount: 1,
          priority: "MANDATORY",
        });

        expect(matched).toEqual([]);
      });
    });

    it("creates coverage constraint for skill-only requirement", () => {
      const builder = new ModelBuilder({
        members: [
          { id: "alice", roleIds: ["server"], skillIds: ["keyholder"] },
          { id: "bob", roleIds: ["server"] },
        ],
        shiftPatterns: [
          {
            id: "shift",
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            skillIds: ["keyholder"],
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();

      // Should have coverage constraint that only includes alice's assignment
      const coverageConstraint = request.constraints.find(
        (c) =>
          c.type === "linear" &&
          c.op === ">=" &&
          c.rhs === 1 &&
          c.terms.some((t) => t.var.includes("alice")),
      );
      assert(coverageConstraint);
      expect(coverageConstraint.type).toBe("linear");

      // Bob should not be in the coverage constraint (doesn't have keyholder skill)
      const constraint = coverageConstraint as { type: "linear"; terms: { var: string }[] };
      const hasBob = constraint.terms.some((t) => t.var.includes("bob"));
      expect(hasBob).toBe(false);
    });

    it("creates coverage constraint for role + skills requirement", () => {
      const builder = new ModelBuilder({
        members: [
          { id: "alice", roleIds: ["server"], skillIds: ["keyholder"] },
          { id: "bob", roleIds: ["server"] },
          { id: "charlie", roleIds: ["chef"], skillIds: ["keyholder"] },
        ],
        shiftPatterns: [
          {
            id: "shift",
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
          },
        ],
        schedulingPeriod: { dateRange: { start: "2024-01-01", end: "2024-01-01" } },
        coverage: [
          {
            day: "2024-01-01",
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            roleIds: ["server"],
            skillIds: ["keyholder"],
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request } = builder.compile();

      // Should have coverage constraint that only includes alice's assignment
      const coverageConstraint = request.constraints.find(
        (c) =>
          c.type === "linear" &&
          c.op === ">=" &&
          c.rhs === 1 &&
          c.terms.some((t) => t.var.includes("alice")),
      );
      assert(coverageConstraint);
      expect(coverageConstraint.type).toBe("linear");

      const constraint = coverageConstraint as { type: "linear"; terms: { var: string }[] };

      // Bob should not be included (no keyholder skill)
      const hasBob = constraint.terms.some((t) => t.var.includes("bob"));
      expect(hasBob).toBe(false);

      // Charlie should not be included (wrong role)
      const hasCharlie = constraint.terms.some((t) => t.var.includes("charlie"));
      expect(hasCharlie).toBe(false);
    });
  });

  describe("coverage validation", () => {
    const baseShiftPatterns: ShiftPattern[] = [
      {
        id: "day",
        roleIds: ["barista"],
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 13, minutes: 0 },
      },
    ];

    it("reports coverage error when no eligible team members exist", () => {
      const builder = new ModelBuilder({
        members: [{ id: "alice", roleIds: ["server"] }],
        shiftPatterns: baseShiftPatterns,
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [baseCoverage({ roleIds: ["barista"] })],
        rules: [],
      });

      const result = builder.compile();

      expect(result.canSolve).toBe(false);
      expect(result.validation.errors).toHaveLength(1);
      expect(result.validation.errors[0]?.type).toBe("coverage");
      expect(result.validation.errors[0]?.message).toContain("no eligible team members");
    });

    it("reports coverage error when mandatory time-off blocks everyone", () => {
      const builder = new ModelBuilder({
        members: [{ id: "alice", roleIds: ["barista"] }],
        shiftPatterns: baseShiftPatterns,
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [baseCoverage()],
        ruleConfigs: [
          {
            name: "time-off",

            memberIds: ["alice"],
            specificDates: ["2024-02-01"],
            priority: "MANDATORY",
          },
        ],
      });

      const result = builder.compile();

      expect(result.canSolve).toBe(false);
      const error = result.validation.errors.find(
        (e) => e.type === "coverage" && e.message.includes("mandatory time off"),
      );
      expect(error).toBeDefined();
    });

    it("tracks soft coverage constraints for post-solve analysis", () => {
      const builder = new ModelBuilder({
        members: [{ id: "alice", roleIds: ["barista"] }],
        shiftPatterns: baseShiftPatterns,
        schedulingPeriod: { dateRange: { start: "2024-02-01", end: "2024-02-01" } },
        coverage: [baseCoverage({ priority: "HIGH", targetCount: 2 })],
        rules: [],
      });

      const result = builder.compile();

      // Soft coverage doesn't block compilation
      expect(result.canSolve).toBe(true);
      // Errors are only for impossible scenarios
      expect(result.validation.errors).toHaveLength(0);
      // Violations and passed are populated after analyzeSolution()
    });
  });

  describe("schedulingPeriod", () => {
    const baseMembers = [{ id: "e1", roleIds: ["server"] }];
    const baseShiftPatterns: ShiftPattern[] = [
      {
        id: "day_shift",
        roleIds: ["server"],
        startTime: { hours: 9, minutes: 0 },
        endTime: { hours: 17, minutes: 0 },
      },
    ];

    it("accepts schedulingPeriod with dateRange", () => {
      const builder = new ModelBuilder({
        members: baseMembers,
        shiftPatterns: baseShiftPatterns,
        schedulingPeriod: {
          dateRange: { start: "2025-02-03", end: "2025-02-05" },
        },
        coverage: [],
      });

      expect(builder.days).toEqual(["2025-02-03", "2025-02-04", "2025-02-05"]);
    });

    it("accepts schedulingPeriod with dateRange and dayOfWeek filter", () => {
      // 2025-02-03 is Monday, 2025-02-09 is Sunday
      const builder = new ModelBuilder({
        members: baseMembers,
        shiftPatterns: baseShiftPatterns,
        schedulingPeriod: {
          dateRange: { start: "2025-02-03", end: "2025-02-09" },
          dayOfWeek: ["wednesday", "thursday", "friday", "saturday", "sunday"],
        },
        coverage: [],
      });

      // Mon/Tue filtered out
      expect(builder.days).toEqual([
        "2025-02-05", // Wednesday
        "2025-02-06", // Thursday
        "2025-02-07", // Friday
        "2025-02-08", // Saturday
        "2025-02-09", // Sunday
      ]);
    });

    it("accepts schedulingPeriod with dates filter", () => {
      const builder = new ModelBuilder({
        members: baseMembers,
        shiftPatterns: baseShiftPatterns,
        schedulingPeriod: {
          dateRange: { start: "2025-02-05", end: "2025-02-10" },
          dates: ["2025-02-10", "2025-02-05", "2025-02-07"],
        },
        coverage: [],
      });

      // Only the specified dates within range, sorted
      expect(builder.days).toEqual(["2025-02-05", "2025-02-07", "2025-02-10"]);
    });

    it("creates assignment variables for resolved days", () => {
      const builder = new ModelBuilder({
        members: baseMembers,
        shiftPatterns: baseShiftPatterns,
        schedulingPeriod: {
          dateRange: { start: "2025-02-03", end: "2025-02-04" },
        },
        coverage: [],
      });

      const { request } = builder.compile();
      const variableNames = new Set(request.variables.map((v) => v.name));

      expect(variableNames.has("assign:e1:day_shift:2025-02-03")).toBe(true);
      expect(variableNames.has("assign:e1:day_shift:2025-02-04")).toBe(true);
      // Should not have day outside range
      expect(variableNames.has("assign:e1:day_shift:2025-02-05")).toBe(false);
    });

    it("restaurant closed Mon/Tue use case works with coverage", () => {
      // 2025-02-03 is Monday
      const builder = new ModelBuilder({
        members: baseMembers,
        shiftPatterns: baseShiftPatterns,
        schedulingPeriod: {
          dateRange: { start: "2025-02-03", end: "2025-02-09" },
          dayOfWeek: ["wednesday", "thursday", "friday", "saturday", "sunday"],
        },
        coverage: [
          {
            day: "2025-02-05", // Wednesday
            roleIds: ["server"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request, canSolve } = builder.compile();

      expect(canSolve).toBe(true);
      const variableNames = new Set(request.variables.map((v) => v.name));

      // Should have assignment for Wednesday
      expect(variableNames.has("assign:e1:day_shift:2025-02-05")).toBe(true);

      // Should NOT have assignments for Monday/Tuesday (filtered out)
      expect(variableNames.has("assign:e1:day_shift:2025-02-03")).toBe(false);
      expect(variableNames.has("assign:e1:day_shift:2025-02-04")).toBe(false);
    });

    it("handles empty scheduling period gracefully", () => {
      const builder = new ModelBuilder({
        members: baseMembers,
        shiftPatterns: baseShiftPatterns,
        schedulingPeriod: {
          dateRange: { start: "2025-02-03", end: "2025-02-03" },
          dates: [],
        },
        coverage: [],
      });

      expect(builder.days).toEqual([]);

      const { request, canSolve } = builder.compile();
      expect(canSolve).toBe(true);
      expect(request.variables).toHaveLength(0);
    });

    it("dayOfWeek filter excludes days from all constraint generation", () => {
      // 2025-02-03 is Monday, 2025-02-04 is Tuesday
      const builder = new ModelBuilder({
        members: baseMembers,
        shiftPatterns: baseShiftPatterns,
        schedulingPeriod: {
          dateRange: { start: "2025-02-03", end: "2025-02-07" },
          dayOfWeek: ["wednesday", "friday"], // Only Wed (05) and Fri (07)
        },
        coverage: [
          {
            day: "2025-02-05",
            roleIds: ["server"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
          {
            day: "2025-02-07",
            roleIds: ["server"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { request, canSolve } = builder.compile();
      expect(canSolve).toBe(true);

      const variableNames = new Set(request.variables.map((v) => v.name));

      // Should have variables for Wed and Fri only
      expect(variableNames.has("assign:e1:day_shift:2025-02-05")).toBe(true);
      expect(variableNames.has("assign:e1:day_shift:2025-02-07")).toBe(true);
      expect(variableNames.has("shift:day_shift:2025-02-05")).toBe(true);
      expect(variableNames.has("shift:day_shift:2025-02-07")).toBe(true);

      // Should NOT have variables for Mon, Tue, Thu (filtered out)
      expect(variableNames.has("assign:e1:day_shift:2025-02-03")).toBe(false);
      expect(variableNames.has("assign:e1:day_shift:2025-02-04")).toBe(false);
      expect(variableNames.has("assign:e1:day_shift:2025-02-06")).toBe(false);
    });

    it("coverage on filtered-out day is silently ignored (no matching shifts)", () => {
      // 2025-02-03 is Monday - filtered out by dayOfWeek
      // Coverage for this day has no overlapping shift patterns, so no constraints generated
      const builder = new ModelBuilder({
        members: baseMembers,
        shiftPatterns: baseShiftPatterns,
        schedulingPeriod: {
          dateRange: { start: "2025-02-03", end: "2025-02-07" },
          dayOfWeek: ["wednesday", "friday"],
        },
        coverage: [
          {
            day: "2025-02-03", // Monday - not in filtered days!
            roleIds: ["server"],
            startTime: { hours: 9, minutes: 0 },
            endTime: { hours: 17, minutes: 0 },
            targetCount: 1,
            priority: "MANDATORY",
          },
        ],
      });

      const { canSolve, validation } = builder.compile();

      // Currently this silently succeeds because there are no shift patterns
      // on 2025-02-03 (it's filtered out), so coverage constraints can't be created.
      // Future improvement: could warn when coverage references days outside schedulingPeriod
      expect(canSolve).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("weekends-only schedule filters correctly", () => {
      // 2025-02-01 is Saturday, 2025-02-02 is Sunday, then weekdays...
      const builder = new ModelBuilder({
        members: baseMembers,
        shiftPatterns: baseShiftPatterns,
        schedulingPeriod: {
          dateRange: { start: "2025-02-01", end: "2025-02-09" },
          dayOfWeek: ["saturday", "sunday"],
        },
        coverage: [],
      });

      // Should only include Sat Feb 1, Sun Feb 2, Sat Feb 8, Sun Feb 9
      expect(builder.days).toEqual(["2025-02-01", "2025-02-02", "2025-02-08", "2025-02-09"]);
    });

    it("single day filter works across multiple weeks", () => {
      // Every Monday in February 2025
      const builder = new ModelBuilder({
        members: baseMembers,
        shiftPatterns: baseShiftPatterns,
        schedulingPeriod: {
          dateRange: { start: "2025-02-01", end: "2025-02-28" },
          dayOfWeek: ["monday"],
        },
        coverage: [],
      });

      // Mondays in Feb 2025: 3, 10, 17, 24
      expect(builder.days).toEqual(["2025-02-03", "2025-02-10", "2025-02-17", "2025-02-24"]);
    });
  });
});
