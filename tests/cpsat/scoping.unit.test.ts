import assert from "node:assert";
import { describe, expect, it, vi } from "vitest";
import type { CompilationRule } from "../../src/cpsat/model-builder.js";
import type {
  CpsatRuleConfigEntry,
  CpsatRuleFactories,
  CpsatRuleName,
  CpsatRuleRegistry,
} from "../../src/cpsat/rules.js";
import {
  buildCpsatRules,
  createMaxHoursDayRule,
  resolveRuleScopes,
} from "../../src/cpsat/rules.js";

/** Extracts a resolved config field for test assertions. */
function configField(config: CpsatRuleRegistry[CpsatRuleName], field: string): unknown {
  return (config as Record<string, unknown>)[field];
}

const employees = [
  { id: "alice", roleIds: ["role"] },
  { id: "bob", roleIds: ["role"] },
];

describe("CP-SAT rule scoping resolver", () => {
  it("applies more specific scopes before global scopes of the same rule", () => {
    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "max-hours-week",
        config: {
          hours: 48,
          priority: "MANDATORY",
        },
      },
      {
        name: "max-hours-week",
        config: {
          hours: 60,
          priority: "HIGH",
          employeeIds: ["alice"],
        },
      },
    ];

    const resolved = resolveRuleScopes(entries, employees);

    expect(resolved).toHaveLength(2);

    const specific = resolved.find((r) => {
      const ids = configField(r.config, "employeeIds") as string[] | undefined;
      return ids?.includes("alice");
    });
    const globalRemainder = resolved.find((r) => {
      const ids = configField(r.config, "employeeIds") as string[] | undefined;
      return ids?.length === 1 && ids?.[0] === "bob";
    });

    expect(specific?.config).toMatchObject({
      hours: 60,
      priority: "HIGH",
    });
    expect(globalRemainder?.config).toMatchObject({
      hours: 48,
      priority: "MANDATORY",
    });
  });

  it("later insertion wins for same specificity (last insert overrides)", () => {
    // Both rules target the same employee with the same time scope - they compete
    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "max-hours-day",
        config: { employeeIds: ["alice"], hours: 8, priority: "HIGH" },
      },
      {
        name: "max-hours-day",
        config: { employeeIds: ["alice"], hours: 6, priority: "LOW" },
      },
    ];

    const resolved = resolveRuleScopes(entries, [{ id: "alice", roleIds: ["r"] }]);
    expect(resolved).toHaveLength(1);

    const rule = resolved[0]!;
    // The second (later) rule should win
    expect(configField(rule.config, "hours")).toBe(6);
    expect(configField(rule.config, "priority")).toBe("LOW");
  });

  it("later global rule overrides earlier global rule", () => {
    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "max-hours-week",
        config: { hours: 40, priority: "MANDATORY" },
      },
      {
        name: "max-hours-week",
        config: { hours: 48, priority: "HIGH" },
      },
    ];

    const resolved = resolveRuleScopes(entries, employees);
    expect(resolved).toHaveLength(1);

    const rule = resolved[0]!;
    // The second (later) rule should win
    expect(configField(rule.config, "hours")).toBe(48);
    expect(configField(rule.config, "priority")).toBe("HIGH");
  });

  it("builds compilation rules via factories using resolved scopes", () => {
    const factory = vi.fn(
      (_config: { tag: string; scope?: { employeeIds?: string[] } }) =>
        ({ compile: vi.fn() }) satisfies CompilationRule,
    );
    const factories: CpsatRuleFactories = {
      "min-hours-day": factory as any,
    };

    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "min-hours-day",
        config: { hours: 5, priority: "MANDATORY" },
      },
    ];

    const rules = buildCpsatRules(entries, employees, factories);
    expect(rules).toHaveLength(1);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[0]?.[0]).toMatchObject({
      hours: 5,
      priority: "MANDATORY",
      employeeIds: ["alice", "bob"],
    });
  });

  it("expands role-scoped rules to employee IDs", () => {
    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "max-hours-day",
        config: { hours: 7, priority: "MANDATORY", roleIds: ["role"] },
      },
    ];

    const resolved = resolveRuleScopes(entries, employees);
    expect(resolved).toHaveLength(1);

    const rule = resolved[0]!;
    // Role scope is expanded to concrete employee IDs
    expect(configField(rule.config, "employeeIds")).toEqual(["alice", "bob"]);
    expect(configField(rule.config, "hours")).toBe(7);
  });

  it("expands skill-scoped rules to employee IDs", () => {
    const employeesWithSkills = [
      { id: "alice", roleIds: ["role"], skillIds: ["first-aid"] },
      { id: "bob", roleIds: ["role"], skillIds: [] },
      { id: "charlie", roleIds: ["role"], skillIds: ["first-aid", "cpr"] },
    ];

    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "max-hours-day",
        config: { hours: 5, priority: "HIGH", skillIds: ["first-aid"] },
      },
    ];

    const resolved = resolveRuleScopes(entries, employeesWithSkills);
    expect(resolved).toHaveLength(1);

    const rule = resolved[0]!;
    // Skill scope is expanded to employees with that skill
    expect(configField(rule.config, "employeeIds")).toEqual(["alice", "charlie"]);
  });

  it("drops rules that match no employees", () => {
    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "max-hours-day",
        config: { hours: 5, priority: "HIGH", skillIds: ["nonexistent"] },
      },
    ];

    const resolved = resolveRuleScopes(entries, employees);
    expect(resolved).toHaveLength(0);
  });

  it("drops rules with employeeIds that match no employees (case-sensitive)", () => {
    // This is a regression test for a bug where providing employeeIds that don't match
    // any employees (e.g., due to case mismatch) would cause the rule to fall back to
    // global scope, affecting ALL employees instead of none.
    const employeesWithCasing = [
      { id: "Alice", roleIds: ["role"] }, // Capital A
      { id: "Bob", roleIds: ["role"] }, // Capital B
    ];

    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "time-off",
        config: {
          priority: "MANDATORY",
          employeeIds: ["alice"], // lowercase - won't match "Alice"
          dayOfWeek: ["saturday", "sunday"],
        },
      },
    ];

    const resolved = resolveRuleScopes(entries, employeesWithCasing);

    // The rule should be dropped entirely since no employees match,
    // NOT converted to a global rule affecting everyone
    expect(resolved).toHaveLength(0);
  });

  it("does not fall back to global scope when explicit employeeIds match no one", () => {
    // Verify that explicit employeeIds scope is preserved even when empty,
    // rather than being converted to global scope
    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "max-hours-day",
        config: {
          hours: 4,
          priority: "MANDATORY",
          employeeIds: ["nonexistent-employee"],
        },
      },
      {
        name: "max-hours-day",
        config: {
          hours: 8,
          priority: "MANDATORY",
          // No scope = global
        },
      },
    ];

    const resolved = resolveRuleScopes(entries, employees);

    // Should only have the global rule, not the specific one that matched no one
    expect(resolved).toHaveLength(1);
    const entry = resolved[0];
    assert(entry);
    expect(configField(entry.config, "hours")).toBe(8);
    expect(configField(entry.config, "employeeIds")).toEqual(["alice", "bob"]);
  });

  it("role-scoped rules claim employees before global rules", () => {
    const employeesWithRoles = [
      { id: "alice", roleIds: ["student"] },
      { id: "bob", roleIds: ["manager"] },
      { id: "charlie", roleIds: ["student", "manager"] },
    ];

    const entries: CpsatRuleConfigEntry[] = [
      // Global rule: 48 hours for everyone
      {
        name: "max-hours-week",
        config: { hours: 48, priority: "MANDATORY" },
      },
      // Student rule: 20 hours (more specific)
      {
        name: "max-hours-week",
        config: {
          hours: 20,
          priority: "MANDATORY",
          roleIds: ["student"],
        },
      },
    ];

    const resolved = resolveRuleScopes(entries, employeesWithRoles);
    expect(resolved).toHaveLength(2);

    // Student rule claims alice and charlie
    const studentRule = resolved.find((r) => configField(r.config, "hours") === 20);
    assert(studentRule);
    expect(configField(studentRule.config, "employeeIds")).toEqual(["alice", "charlie"]);

    // Global rule gets only bob (the remainder)
    const globalRule = resolved.find((r) => configField(r.config, "hours") === 48);
    assert(globalRule);
    expect(configField(globalRule.config, "employeeIds")).toEqual(["bob"]);
  });

  it("preserves time scopes such as date ranges and days of week", () => {
    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "max-hours-day",
        config: {
          hours: 6,
          priority: "HIGH",
          dayOfWeek: ["monday", "tuesday"],
        },
      },
      {
        name: "max-hours-day",
        config: {
          hours: 8,
          priority: "MANDATORY",
          dateRange: { start: "2024-02-01", end: "2024-02-07" },
        },
      },
    ];

    const resolved = resolveRuleScopes(entries, employees);
    expect(
      resolved.some((r) => {
        const dow = configField(r.config, "dayOfWeek") as string[] | undefined;
        return dow?.includes("monday");
      }),
    ).toBe(true);
    expect(
      resolved.some((r) => {
        const range = configField(r.config, "dateRange") as
          | { start: string; end: string }
          | undefined;
        return range?.start === "2024-02-01";
      }),
    ).toBe(true);
  });

  it("passes through non-scoped rules unchanged", () => {
    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "assign-together",
        config: { groupEmployeeIds: ["alice", "bob"], priority: "MANDATORY" },
      },
      {
        name: "assign-together",
        config: { groupEmployeeIds: ["bob", "charlie"], priority: "HIGH" },
      },
    ];

    const employeesWithCharlie = [
      { id: "alice", roleIds: ["role"] },
      { id: "bob", roleIds: ["role"] },
      { id: "charlie", roleIds: ["role"] },
    ];

    const resolved = resolveRuleScopes(entries, employeesWithCharlie);

    // Both rules should pass through unchanged (no scope resolution)
    expect(resolved).toHaveLength(2);

    const [first, second] = resolved;
    assert(first);
    assert(second);

    // First rule unchanged
    expect(first.name).toBe("assign-together");
    expect(configField(first.config, "groupEmployeeIds")).toEqual(["alice", "bob"]);
    expect(configField(first.config, "priority")).toBe("MANDATORY");

    // Second rule unchanged
    expect(second.name).toBe("assign-together");
    expect(configField(second.config, "groupEmployeeIds")).toEqual(["bob", "charlie"]);
    expect(configField(second.config, "priority")).toBe("HIGH");

    // Neither should have employeeIds added (not scoped)
    expect(configField(first.config, "employeeIds")).toBeUndefined();
    expect(configField(second.config, "employeeIds")).toBeUndefined();
  });

  it("mixes non-scoped and scoped rules correctly", () => {
    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "assign-together",
        config: { groupEmployeeIds: ["alice", "bob"], priority: "MANDATORY" },
      },
      {
        name: "max-hours-day",
        config: { hours: 8, priority: "MANDATORY" },
      },
      {
        name: "assign-together",
        config: { groupEmployeeIds: ["charlie", "diana"], priority: "HIGH" },
      },
    ];

    const allEmployees = [
      { id: "alice", roleIds: ["role"] },
      { id: "bob", roleIds: ["role"] },
      { id: "charlie", roleIds: ["role"] },
      { id: "diana", roleIds: ["role"] },
    ];

    const resolved = resolveRuleScopes(entries, allEmployees);

    expect(resolved).toHaveLength(3);

    // Non-scoped rules pass through as-is
    const assignTogetherRules = resolved.filter((r) => r.name === "assign-together");
    expect(assignTogetherRules).toHaveLength(2);
    const together0 = assignTogetherRules[0];
    const together1 = assignTogetherRules[1];
    assert(together0);
    assert(together1);
    expect(configField(together0.config, "groupEmployeeIds")).toEqual(["alice", "bob"]);
    expect(configField(together1.config, "groupEmployeeIds")).toEqual(["charlie", "diana"]);

    // Scoped rule gets all employees (global scope)
    const maxHoursRule = resolved.find((r) => r.name === "max-hours-day");
    assert(maxHoursRule);
    expect(configField(maxHoursRule.config, "employeeIds")).toEqual([
      "alice",
      "bob",
      "charlie",
      "diana",
    ]);
  });
});

describe("CP-SAT rule validation", () => {
  it("rejects conflicting scope definitions", () => {
    expect(() =>
      // @ts-expect-error: deliberately passing both employeeIds and roleIds to test runtime validation
      createMaxHoursDayRule({
        hours: 8,
        priority: "MANDATORY",
        employeeIds: ["alice"],
        roleIds: ["role"],
      }),
    ).toThrow(/Only one of employeeIds\/roleIds\/skillIds is allowed/);
  });
});
