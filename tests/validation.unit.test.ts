import { describe, it, expect } from "vitest";
import {
  validateCoverageRoles,
  validateCoverageSkills,
  validateCoverageConfig,
} from "../src/validation.js";
import type { CoverageRequirement, SchedulingMember } from "../src/index.js";

/**
 * Helper to create role-based coverage requirements for tests.
 */
function roleBasedCoverage(roles: [string, ...string[]]): CoverageRequirement {
  return {
    day: "2024-01-01",
    startTime: { hours: 9, minutes: 0 },
    endTime: { hours: 17, minutes: 0 },
    targetCount: 1,
    priority: "MANDATORY",
    roles,
  };
}

/**
 * Helper to create skill-based coverage requirements for tests.
 */
function skillBasedCoverage(skills: [string, ...string[]]): CoverageRequirement {
  return {
    day: "2024-01-01",
    startTime: { hours: 9, minutes: 0 },
    endTime: { hours: 17, minutes: 0 },
    targetCount: 1,
    priority: "MANDATORY",
    skills,
  };
}

/**
 * Helper to create coverage with both roles and skills for tests.
 */
function roleAndSkillCoverage(
  roles: [string, ...string[]],
  skills: [string, ...string[]],
): CoverageRequirement {
  return {
    day: "2024-01-01",
    startTime: { hours: 9, minutes: 0 },
    endTime: { hours: 17, minutes: 0 },
    targetCount: 1,
    priority: "MANDATORY",
    roles,
    skills,
  };
}

describe("validateCoverageRoles", () => {
  it("returns valid when all coverage roles exist in members", () => {
    const members: SchedulingMember[] = [
      { id: "alice", roles: ["cashier", "stocker"] },
      { id: "bob", roles: ["manager"] },
    ];

    const coverage: CoverageRequirement[] = [
      roleBasedCoverage(["cashier"]),
      roleBasedCoverage(["manager"]),
    ];

    const result = validateCoverageRoles(coverage, members);

    expect(result.valid).toBe(true);
    expect(result.unknownRoles).toEqual([]);
    expect(result.knownRoles).toEqual(["cashier", "manager"]);
  });

  it("returns invalid when coverage uses unknown roles", () => {
    const members: SchedulingMember[] = [{ id: "alice", roles: ["cashier"] }];

    const coverage: CoverageRequirement[] = [
      roleBasedCoverage(["cashier"]),
      roleBasedCoverage(["worker"]),
      roleBasedCoverage(["staff"]),
    ];

    const result = validateCoverageRoles(coverage, members);

    expect(result.valid).toBe(false);
    expect(result.unknownRoles).toEqual(["staff", "worker"]);
    expect(result.knownRoles).toEqual(["cashier"]);
  });

  it("ignores coverage without roles (skill-only coverage)", () => {
    const members: SchedulingMember[] = [{ id: "alice", roles: ["server"], skills: ["keyholder"] }];

    const coverage: CoverageRequirement[] = [skillBasedCoverage(["keyholder"])];

    const result = validateCoverageRoles(coverage, members);

    expect(result.valid).toBe(true);
    expect(result.unknownRoles).toEqual([]);
    expect(result.knownRoles).toEqual([]);
  });

  it("handles empty coverage array", () => {
    const members: SchedulingMember[] = [{ id: "alice", roles: ["cashier"] }];

    const result = validateCoverageRoles([], members);

    expect(result.valid).toBe(true);
    expect(result.unknownRoles).toEqual([]);
    expect(result.knownRoles).toEqual([]);
  });

  it("handles empty members array", () => {
    const coverage: CoverageRequirement[] = [roleBasedCoverage(["cashier"])];

    const result = validateCoverageRoles(coverage, []);

    expect(result.valid).toBe(false);
    expect(result.unknownRoles).toEqual(["cashier"]);
  });

  it("deduplicates roles in result", () => {
    const members: SchedulingMember[] = [{ id: "alice", roles: ["cashier"] }];

    const coverage: CoverageRequirement[] = [
      roleBasedCoverage(["cashier"]),
      roleBasedCoverage(["cashier"]),
      roleBasedCoverage(["worker"]),
      roleBasedCoverage(["worker"]),
    ];

    const result = validateCoverageRoles(coverage, members);

    expect(result.unknownRoles).toEqual(["worker"]);
    expect(result.knownRoles).toEqual(["cashier"]);
  });
});

describe("validateCoverageSkills", () => {
  it("returns valid when all coverage skills exist in members", () => {
    const members: SchedulingMember[] = [
      { id: "alice", roles: ["server"], skills: ["keyholder", "senior"] },
      { id: "bob", roles: ["server"], skills: ["trainer"] },
    ];

    const coverage: CoverageRequirement[] = [
      roleAndSkillCoverage(["server"], ["keyholder"]),
      roleAndSkillCoverage(["server"], ["trainer"]),
    ];

    const result = validateCoverageSkills(coverage, members);

    expect(result.valid).toBe(true);
    expect(result.unknownSkills).toEqual([]);
    expect(result.knownSkills).toEqual(["keyholder", "trainer"]);
  });

  it("returns invalid when coverage uses unknown skills", () => {
    const members: SchedulingMember[] = [{ id: "alice", roles: ["server"], skills: ["keyholder"] }];

    const coverage: CoverageRequirement[] = [
      roleAndSkillCoverage(["server"], ["keyholder"]),
      roleAndSkillCoverage(["server"], ["manager"]),
    ];

    const result = validateCoverageSkills(coverage, members);

    expect(result.valid).toBe(false);
    expect(result.unknownSkills).toEqual(["manager"]);
    expect(result.knownSkills).toEqual(["keyholder"]);
  });

  it("handles multiple skills in single coverage requirement", () => {
    const members: SchedulingMember[] = [{ id: "alice", roles: ["server"], skills: ["keyholder"] }];

    const coverage: CoverageRequirement[] = [
      roleAndSkillCoverage(["server"], ["keyholder", "senior", "trainer"]),
    ];

    const result = validateCoverageSkills(coverage, members);

    expect(result.valid).toBe(false);
    expect(result.unknownSkills).toEqual(["senior", "trainer"]);
    expect(result.knownSkills).toEqual(["keyholder"]);
  });

  it("handles members without skills", () => {
    const members: SchedulingMember[] = [
      { id: "alice", roles: ["server"] }, // No skills
    ];

    const coverage: CoverageRequirement[] = [skillBasedCoverage(["keyholder"])];

    const result = validateCoverageSkills(coverage, members);

    expect(result.valid).toBe(false);
    expect(result.unknownSkills).toEqual(["keyholder"]);
  });

  it("ignores coverage without skills", () => {
    const members: SchedulingMember[] = [{ id: "alice", roles: ["server"] }];

    const coverage: CoverageRequirement[] = [roleBasedCoverage(["server"])];

    const result = validateCoverageSkills(coverage, members);

    expect(result.valid).toBe(true);
    expect(result.unknownSkills).toEqual([]);
  });
});

describe("validateCoverageConfig", () => {
  it("returns valid when all roles and skills match", () => {
    const members: SchedulingMember[] = [{ id: "alice", roles: ["server"], skills: ["keyholder"] }];

    const coverage: CoverageRequirement[] = [roleAndSkillCoverage(["server"], ["keyholder"])];

    const result = validateCoverageConfig(coverage, members);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("returns errors for unknown roles", () => {
    const members: SchedulingMember[] = [{ id: "alice", roles: ["cashier"] }];

    const coverage: CoverageRequirement[] = [roleBasedCoverage(["worker"])];

    const result = validateCoverageConfig(coverage, members);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("unknown roles: worker");
    expect(result.errors[0]).toContain("Available roles: cashier");
  });

  it("returns errors for unknown skills", () => {
    const members: SchedulingMember[] = [{ id: "alice", roles: ["server"], skills: ["keyholder"] }];

    const coverage: CoverageRequirement[] = [roleAndSkillCoverage(["server"], ["manager"])];

    const result = validateCoverageConfig(coverage, members);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("unknown skills: manager");
    expect(result.errors[0]).toContain("Available skills: keyholder");
  });

  it("returns multiple errors for both role and skill mismatches", () => {
    const members: SchedulingMember[] = [
      { id: "alice", roles: ["cashier"], skills: ["keyholder"] },
    ];

    const coverage: CoverageRequirement[] = [roleAndSkillCoverage(["worker"], ["manager"])];

    const result = validateCoverageConfig(coverage, members);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("unknown roles");
    expect(result.errors[1]).toContain("unknown skills");
  });

  it("shows '(none)' when no skills available", () => {
    const members: SchedulingMember[] = [
      { id: "alice", roles: ["server"] }, // No skills
    ];

    const coverage: CoverageRequirement[] = [roleAndSkillCoverage(["server"], ["keyholder"])];

    const result = validateCoverageConfig(coverage, members);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Available skills: (none)");
  });

  it("provides structured role and skill results", () => {
    const members: SchedulingMember[] = [
      { id: "alice", roles: ["cashier"], skills: ["keyholder"] },
    ];

    const coverage: CoverageRequirement[] = [
      roleAndSkillCoverage(["cashier"], ["keyholder"]),
      roleAndSkillCoverage(["worker"], ["manager"]),
    ];

    const result = validateCoverageConfig(coverage, members);

    expect(result.roles.valid).toBe(false);
    expect(result.roles.unknownRoles).toEqual(["worker"]);
    expect(result.roles.knownRoles).toEqual(["cashier"]);

    expect(result.skills.valid).toBe(false);
    expect(result.skills.unknownSkills).toEqual(["manager"]);
    expect(result.skills.knownSkills).toEqual(["keyholder"]);
  });
});
