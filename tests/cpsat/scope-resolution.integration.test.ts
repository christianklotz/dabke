import { beforeAll, describe, expect, it } from "vitest";
import type { CpsatRuleConfigEntry } from "../../src/cpsat/rules.js";
import { createBaseConfig, decodeAssignments, solveWithRules, getSolverClient } from "./helpers.js";

describe("CP-SAT: scope resolution", () => {
  let client: ReturnType<typeof getSolverClient>;

  beforeAll(() => {
    client = getSolverClient();
  });

  describe("role-based scoping", () => {
    it("applies role-scoped rules only to employees with that role", async () => {
      // Setup: alice is a student (limited hours), bob is a manager (unlimited)
      // Coverage requires only 1 person per day so constraints are satisfiable
      const baseConfig = createBaseConfig({
        employees: [
          { id: "alice", roleIds: ["worker", "student"] },
          { id: "bob", roleIds: ["worker", "manager"] },
        ],
        roleIds: ["worker"],
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 }, // 8 hours
        },
        schedulingPeriod: {
          dateRange: { start: "2024-02-05", end: "2024-02-08" },
        }, // 4 days
        targetCount: 1, // Only need 1 employee per day
      });

      // Add preference rules so alice is preferred (will take all shifts without limits)
      const preferenceRules: CpsatRuleConfigEntry[] = [
        {
          name: "employee-assignment-priority",
          config: { employeeIds: ["alice"], preference: "high" },
        },
        {
          name: "employee-assignment-priority",
          config: { employeeIds: ["bob"], preference: "low" },
        },
      ];

      // Baseline: alice should take all 4 shifts due to preference
      const baseline = await solveWithRules(client, baseConfig, preferenceRules);
      expect(baseline.status).toBe("OPTIMAL");
      const baselineAssignments = decodeAssignments(baseline.values);
      expect(baselineAssignments.filter((a) => a.employeeId === "alice")).toHaveLength(4);
      expect(baselineAssignments.filter((a) => a.employeeId === "bob")).toHaveLength(0);

      // Apply 16-hour weekly limit ONLY to students (alice)
      const withStudentLimit = await solveWithRules(client, baseConfig, [
        ...preferenceRules,
        {
          name: "max-hours-week",
          config: {
            hours: 16, // 16 hours = 2 shifts max
            priority: "MANDATORY",
            roleIds: ["student"],
          },
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(withStudentLimit.status).toBe("OPTIMAL");
      const limitedAssignments = decodeAssignments(withStudentLimit.values);

      // Alice (student) should be limited to 2 shifts
      const aliceShifts = limitedAssignments.filter((a) => a.employeeId === "alice").length;
      expect(aliceShifts).toBeLessThanOrEqual(2);

      // Bob should pick up the remaining shifts
      const bobShifts = limitedAssignments.filter((a) => a.employeeId === "bob").length;
      expect(bobShifts).toBeGreaterThanOrEqual(2);
    }, 30_000);

    it("role-scoped rules override global rules for matching employees", async () => {
      const baseConfig = createBaseConfig({
        employees: [
          { id: "alice", roleIds: ["worker", "student"] },
          { id: "bob", roleIds: ["worker"] },
        ],
        roleIds: ["worker"],
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 }, // 8 hours
        },
        schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-07" } }, // 3 days
        targetCount: 1, // Only need 1 employee per day
      });

      const preferenceRules: CpsatRuleConfigEntry[] = [
        {
          name: "employee-assignment-priority",
          config: { employeeIds: ["alice"], preference: "high" },
        },
        {
          name: "employee-assignment-priority",
          config: { employeeIds: ["bob"], preference: "low" },
        },
      ];

      // Global rule: 24 hours/week (3 shifts) - would allow alice to take all
      // Student rule: 8 hours/week (1 shift) - more restrictive, should override for alice
      const withOverride = await solveWithRules(client, baseConfig, [
        ...preferenceRules,
        {
          name: "max-hours-week",
          config: {
            hours: 24,
            priority: "MANDATORY",
          },
        },
        {
          name: "max-hours-week",
          config: {
            hours: 8, // Only 1 shift
            priority: "MANDATORY",
            roleIds: ["student"],
          },
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(withOverride.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(withOverride.values);

      // Alice (student) gets the student rule: max 1 shift
      expect(assignments.filter((a) => a.employeeId === "alice").length).toBeLessThanOrEqual(1);

      // Bob picks up the rest (2+ shifts)
      expect(assignments.filter((a) => a.employeeId === "bob").length).toBeGreaterThanOrEqual(2);
    }, 30_000);
  });

  describe("skill-based scoping", () => {
    it("applies skill-scoped rules only to employees with that skill", async () => {
      const baseConfig = createBaseConfig({
        employees: [
          { id: "alice", roleIds: ["worker"], skillIds: ["certified"] },
          { id: "bob", roleIds: ["worker"], skillIds: [] },
          {
            id: "charlie",
            roleIds: ["worker"],
            skillIds: ["certified", "senior"],
          },
        ],
        roleIds: ["worker"],
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
        schedulingPeriod: {
          dateRange: { start: "2024-02-05", end: "2024-02-08" },
        },
        targetCount: 1, // Only need 1 employee per day
      });

      // Prefer certified employees
      const preferenceRules: CpsatRuleConfigEntry[] = [
        {
          name: "employee-assignment-priority",
          config: { employeeIds: ["alice"], preference: "high" },
        },
        {
          name: "employee-assignment-priority",
          config: { employeeIds: ["charlie"], preference: "high" },
        },
        {
          name: "employee-assignment-priority",
          config: { employeeIds: ["bob"], preference: "low" },
        },
      ];

      // Apply hour limit only to certified employees (alice and charlie)
      const withSkillLimit = await solveWithRules(client, baseConfig, [
        ...preferenceRules,
        {
          name: "max-hours-week",
          config: {
            hours: 8, // 1 shift max per certified employee
            priority: "MANDATORY",
            skillIds: ["certified"],
          },
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(withSkillLimit.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(withSkillLimit.values);

      // Alice and Charlie (certified) should be limited to 1 shift each
      expect(assignments.filter((a) => a.employeeId === "alice").length).toBeLessThanOrEqual(1);
      expect(assignments.filter((a) => a.employeeId === "charlie").length).toBeLessThanOrEqual(1);

      // Bob (not certified) should pick up the remaining shifts
      expect(assignments.filter((a) => a.employeeId === "bob").length).toBeGreaterThanOrEqual(2);
    }, 30_000);
  });

  describe("scope precedence", () => {
    it("employee scope takes precedence over role scope", async () => {
      const baseConfig = createBaseConfig({
        employees: [
          { id: "alice", roleIds: ["worker", "student"] },
          { id: "bob", roleIds: ["worker", "student"] },
        ],
        roleIds: ["worker"],
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
        schedulingPeriod: { dateRange: { start: "2024-02-05", end: "2024-02-07" } }, // 3 days
        targetCount: 1, // Only need 1 employee per day
      });

      const preferenceRules: CpsatRuleConfigEntry[] = [
        {
          name: "employee-assignment-priority",
          config: { employeeIds: ["alice"], preference: "high" },
        },
        {
          name: "employee-assignment-priority",
          config: { employeeIds: ["bob"], preference: "low" },
        },
      ];

      // Role rule for students: 16 hours (2 shifts)
      // Employee rule for alice: 8 hours (1 shift) - more specific, should override
      const withPrecedence = await solveWithRules(client, baseConfig, [
        ...preferenceRules,
        {
          name: "max-hours-week",
          config: {
            hours: 16,
            priority: "MANDATORY",
            roleIds: ["student"],
          },
        },
        {
          name: "max-hours-week",
          config: {
            hours: 8,
            priority: "MANDATORY",
            employeeIds: ["alice"],
          },
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(withPrecedence.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(withPrecedence.values);

      // Alice gets employee-specific rule: max 1 shift
      expect(assignments.filter((a) => a.employeeId === "alice").length).toBeLessThanOrEqual(1);

      // Bob gets role rule: max 2 shifts (and picks up remaining)
      expect(assignments.filter((a) => a.employeeId === "bob").length).toBeGreaterThanOrEqual(2);
    }, 30_000);

    it("role scope takes precedence over global scope", async () => {
      const baseConfig = createBaseConfig({
        employees: [
          { id: "alice", roleIds: ["worker", "intern"] },
          { id: "bob", roleIds: ["worker"] },
        ],
        roleIds: ["worker"],
        shift: {
          id: "day",
          startTime: { hours: 9, minutes: 0 },
          endTime: { hours: 17, minutes: 0 },
        },
        schedulingPeriod: {
          dateRange: { start: "2024-02-05", end: "2024-02-08" },
        },
        targetCount: 1, // Only need 1 employee per day
      });

      const preferenceRules: CpsatRuleConfigEntry[] = [
        {
          name: "employee-assignment-priority",
          config: { employeeIds: ["alice"], preference: "high" },
        },
        {
          name: "employee-assignment-priority",
          config: { employeeIds: ["bob"], preference: "low" },
        },
      ];

      // Global: 32 hours (4 shifts)
      // Intern role: 16 hours (2 shifts)
      const withPrecedence = await solveWithRules(client, baseConfig, [
        ...preferenceRules,
        {
          name: "max-hours-week",
          config: {
            hours: 32,
            priority: "MANDATORY",
          },
        },
        {
          name: "max-hours-week",
          config: {
            hours: 16,
            priority: "MANDATORY",
            roleIds: ["intern"],
          },
        },
      ] satisfies CpsatRuleConfigEntry[]);

      expect(withPrecedence.status).toBe("OPTIMAL");
      const assignments = decodeAssignments(withPrecedence.values);

      // Alice (intern) gets role rule: max 2 shifts
      expect(assignments.filter((a) => a.employeeId === "alice").length).toBeLessThanOrEqual(2);

      // Bob picks up the remaining shifts
      expect(assignments.filter((a) => a.employeeId === "bob").length).toBeGreaterThanOrEqual(2);
    }, 30_000);
  });
});
