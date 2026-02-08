import { describe, it, expect } from "vitest";
import {
  validateCoverageRoles,
  validateCoverageSkills,
  validateCoverageConfig,
} from "../src/index.js";
import type { CoverageRequirement, SchedulingEmployee } from "../src/index.js";

/**
 * Helper to create role-based coverage requirements for tests.
 */
function roleBasedCoverage(roleIds: [string, ...string[]]): CoverageRequirement {
  return {
    day: "2024-01-01",
    startTime: { hours: 9, minutes: 0 },
    endTime: { hours: 17, minutes: 0 },
    targetCount: 1,
    priority: "MANDATORY",
    roleIds,
  };
}

/**
 * Helper to create skill-based coverage requirements for tests.
 */
function skillBasedCoverage(skillIds: [string, ...string[]]): CoverageRequirement {
  return {
    day: "2024-01-01",
    startTime: { hours: 9, minutes: 0 },
    endTime: { hours: 17, minutes: 0 },
    targetCount: 1,
    priority: "MANDATORY",
    skillIds,
  };
}

/**
 * Helper to create coverage with both roles and skills for tests.
 */
function roleAndSkillCoverage(
  roleIds: [string, ...string[]],
  skillIds: [string, ...string[]],
): CoverageRequirement {
  return {
    day: "2024-01-01",
    startTime: { hours: 9, minutes: 0 },
    endTime: { hours: 17, minutes: 0 },
    targetCount: 1,
    priority: "MANDATORY",
    roleIds,
    skillIds,
  };
}

describe("validateCoverageRoles", () => {
  it("returns valid when all coverage roles exist in employees", () => {
    const employees: SchedulingEmployee[] = [
      { id: "alice", roleIds: ["cashier", "stocker"] },
      { id: "bob", roleIds: ["manager"] },
    ];

    const coverage: CoverageRequirement[] = [
      roleBasedCoverage(["cashier"]),
      roleBasedCoverage(["manager"]),
    ];

    const result = validateCoverageRoles(coverage, employees);

    expect(result.valid).toBe(true);
    expect(result.unknownRoles).toEqual([]);
    expect(result.knownRoles).toEqual(["cashier", "manager"]);
  });

  it("returns invalid when coverage uses unknown roles", () => {
    const employees: SchedulingEmployee[] = [{ id: "alice", roleIds: ["cashier"] }];

    const coverage: CoverageRequirement[] = [
      roleBasedCoverage(["cashier"]),
      roleBasedCoverage(["worker"]),
      roleBasedCoverage(["staff"]),
    ];

    const result = validateCoverageRoles(coverage, employees);

    expect(result.valid).toBe(false);
    expect(result.unknownRoles).toEqual(["staff", "worker"]);
    expect(result.knownRoles).toEqual(["cashier"]);
  });

  it("ignores coverage without roleIds (skill-only coverage)", () => {
    const employees: SchedulingEmployee[] = [
      { id: "alice", roleIds: ["server"], skillIds: ["keyholder"] },
    ];

    const coverage: CoverageRequirement[] = [skillBasedCoverage(["keyholder"])];

    const result = validateCoverageRoles(coverage, employees);

    expect(result.valid).toBe(true);
    expect(result.unknownRoles).toEqual([]);
    expect(result.knownRoles).toEqual([]);
  });

  it("handles empty coverage array", () => {
    const employees: SchedulingEmployee[] = [{ id: "alice", roleIds: ["cashier"] }];

    const result = validateCoverageRoles([], employees);

    expect(result.valid).toBe(true);
    expect(result.unknownRoles).toEqual([]);
    expect(result.knownRoles).toEqual([]);
  });

  it("handles empty employees array", () => {
    const coverage: CoverageRequirement[] = [roleBasedCoverage(["cashier"])];

    const result = validateCoverageRoles(coverage, []);

    expect(result.valid).toBe(false);
    expect(result.unknownRoles).toEqual(["cashier"]);
  });

  it("deduplicates roles in result", () => {
    const employees: SchedulingEmployee[] = [{ id: "alice", roleIds: ["cashier"] }];

    const coverage: CoverageRequirement[] = [
      roleBasedCoverage(["cashier"]),
      roleBasedCoverage(["cashier"]),
      roleBasedCoverage(["worker"]),
      roleBasedCoverage(["worker"]),
    ];

    const result = validateCoverageRoles(coverage, employees);

    expect(result.unknownRoles).toEqual(["worker"]);
    expect(result.knownRoles).toEqual(["cashier"]);
  });
});

describe("validateCoverageSkills", () => {
  it("returns valid when all coverage skills exist in employees", () => {
    const employees: SchedulingEmployee[] = [
      { id: "alice", roleIds: ["server"], skillIds: ["keyholder", "senior"] },
      { id: "bob", roleIds: ["server"], skillIds: ["trainer"] },
    ];

    const coverage: CoverageRequirement[] = [
      roleAndSkillCoverage(["server"], ["keyholder"]),
      roleAndSkillCoverage(["server"], ["trainer"]),
    ];

    const result = validateCoverageSkills(coverage, employees);

    expect(result.valid).toBe(true);
    expect(result.unknownSkills).toEqual([]);
    expect(result.knownSkills).toEqual(["keyholder", "trainer"]);
  });

  it("returns invalid when coverage uses unknown skills", () => {
    const employees: SchedulingEmployee[] = [
      { id: "alice", roleIds: ["server"], skillIds: ["keyholder"] },
    ];

    const coverage: CoverageRequirement[] = [
      roleAndSkillCoverage(["server"], ["keyholder"]),
      roleAndSkillCoverage(["server"], ["manager"]),
    ];

    const result = validateCoverageSkills(coverage, employees);

    expect(result.valid).toBe(false);
    expect(result.unknownSkills).toEqual(["manager"]);
    expect(result.knownSkills).toEqual(["keyholder"]);
  });

  it("handles multiple skills in single coverage requirement", () => {
    const employees: SchedulingEmployee[] = [
      { id: "alice", roleIds: ["server"], skillIds: ["keyholder"] },
    ];

    const coverage: CoverageRequirement[] = [
      roleAndSkillCoverage(["server"], ["keyholder", "senior", "trainer"]),
    ];

    const result = validateCoverageSkills(coverage, employees);

    expect(result.valid).toBe(false);
    expect(result.unknownSkills).toEqual(["senior", "trainer"]);
    expect(result.knownSkills).toEqual(["keyholder"]);
  });

  it("handles employees without skillIds", () => {
    const employees: SchedulingEmployee[] = [
      { id: "alice", roleIds: ["server"] }, // No skillIds
    ];

    const coverage: CoverageRequirement[] = [skillBasedCoverage(["keyholder"])];

    const result = validateCoverageSkills(coverage, employees);

    expect(result.valid).toBe(false);
    expect(result.unknownSkills).toEqual(["keyholder"]);
  });

  it("ignores coverage without skillIds", () => {
    const employees: SchedulingEmployee[] = [{ id: "alice", roleIds: ["server"] }];

    const coverage: CoverageRequirement[] = [roleBasedCoverage(["server"])];

    const result = validateCoverageSkills(coverage, employees);

    expect(result.valid).toBe(true);
    expect(result.unknownSkills).toEqual([]);
  });
});

describe("validateCoverageConfig", () => {
  it("returns valid when all roles and skills match", () => {
    const employees: SchedulingEmployee[] = [
      { id: "alice", roleIds: ["server"], skillIds: ["keyholder"] },
    ];

    const coverage: CoverageRequirement[] = [roleAndSkillCoverage(["server"], ["keyholder"])];

    const result = validateCoverageConfig(coverage, employees);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("returns errors for unknown roles", () => {
    const employees: SchedulingEmployee[] = [{ id: "alice", roleIds: ["cashier"] }];

    const coverage: CoverageRequirement[] = [roleBasedCoverage(["worker"])];

    const result = validateCoverageConfig(coverage, employees);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("unknown roles: worker");
    expect(result.errors[0]).toContain("Available roles: cashier");
  });

  it("returns errors for unknown skills", () => {
    const employees: SchedulingEmployee[] = [
      { id: "alice", roleIds: ["server"], skillIds: ["keyholder"] },
    ];

    const coverage: CoverageRequirement[] = [roleAndSkillCoverage(["server"], ["manager"])];

    const result = validateCoverageConfig(coverage, employees);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("unknown skills: manager");
    expect(result.errors[0]).toContain("Available skills: keyholder");
  });

  it("returns multiple errors for both role and skill mismatches", () => {
    const employees: SchedulingEmployee[] = [
      { id: "alice", roleIds: ["cashier"], skillIds: ["keyholder"] },
    ];

    const coverage: CoverageRequirement[] = [roleAndSkillCoverage(["worker"], ["manager"])];

    const result = validateCoverageConfig(coverage, employees);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("unknown roles");
    expect(result.errors[1]).toContain("unknown skills");
  });

  it("shows '(none)' when no skills available", () => {
    const employees: SchedulingEmployee[] = [
      { id: "alice", roleIds: ["server"] }, // No skills
    ];

    const coverage: CoverageRequirement[] = [roleAndSkillCoverage(["server"], ["keyholder"])];

    const result = validateCoverageConfig(coverage, employees);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Available skills: (none)");
  });

  it("provides structured role and skill results", () => {
    const employees: SchedulingEmployee[] = [
      { id: "alice", roleIds: ["cashier"], skillIds: ["keyholder"] },
    ];

    const coverage: CoverageRequirement[] = [
      roleAndSkillCoverage(["cashier"], ["keyholder"]),
      roleAndSkillCoverage(["worker"], ["manager"]),
    ];

    const result = validateCoverageConfig(coverage, employees);

    expect(result.roles.valid).toBe(false);
    expect(result.roles.unknownRoles).toEqual(["worker"]);
    expect(result.roles.knownRoles).toEqual(["cashier"]);

    expect(result.skills.valid).toBe(false);
    expect(result.skills.unknownSkills).toEqual(["manager"]);
    expect(result.skills.knownSkills).toEqual(["keyholder"]);
  });
});
