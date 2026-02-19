import assert from "node:assert";
import { describe, expect, it, vi } from "vitest";
import type { CompilationRule } from "../../src/cpsat/model-builder.js";
import type { CpsatRuleConfigEntry, CpsatRuleFactories } from "../../src/cpsat/rules.js";
import {
  buildCpsatRules,
  createMaxHoursDayRule,
  resolveRuleScopes,
} from "../../src/cpsat/rules.js";

/** Extracts a resolved config field for test assertions. */
function configField(entry: CpsatRuleConfigEntry, field: string): unknown {
  return (entry as Record<string, unknown>)[field];
}

const members = [
  { id: "alice", roles: ["role"] },
  { id: "bob", roles: ["role"] },
];

describe("CP-SAT rule scoping resolver", () => {
  it("applies more specific scopes before global scopes of the same rule", () => {
    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "max-hours-week",

        hours: 48,
        priority: "MANDATORY",
      },
      {
        name: "max-hours-week",

        hours: 60,
        priority: "HIGH",
        memberIds: ["alice"],
      },
    ];

    const resolved = resolveRuleScopes(entries, members);

    expect(resolved).toHaveLength(2);

    const specific = resolved.find((r) => {
      const ids = configField(r, "memberIds") as string[] | undefined;
      return ids?.includes("alice");
    });
    const globalRemainder = resolved.find((r) => {
      const ids = configField(r, "memberIds") as string[] | undefined;
      return ids?.length === 1 && ids?.[0] === "bob";
    });

    expect(specific).toMatchObject({
      hours: 60,
      priority: "HIGH",
    });
    expect(globalRemainder).toMatchObject({
      hours: 48,
      priority: "MANDATORY",
    });
  });

  it("later insertion wins for same specificity (last insert overrides)", () => {
    // Both rules target the same member with the same time scope - they compete
    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "max-hours-day",
        memberIds: ["alice"],
        hours: 8,
        priority: "HIGH",
      },
      {
        name: "max-hours-day",
        memberIds: ["alice"],
        hours: 6,
        priority: "LOW",
      },
    ];

    const resolved = resolveRuleScopes(entries, [{ id: "alice", roles: ["r"] }]);
    expect(resolved).toHaveLength(1);

    const rule = resolved[0]!;
    // The second (later) rule should win
    expect(configField(rule, "hours")).toBe(6);
    expect(configField(rule, "priority")).toBe("LOW");
  });

  it("later global rule overrides earlier global rule", () => {
    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "max-hours-week",
        hours: 40,
        priority: "MANDATORY",
      },
      {
        name: "max-hours-week",
        hours: 48,
        priority: "HIGH",
      },
    ];

    const resolved = resolveRuleScopes(entries, members);
    expect(resolved).toHaveLength(1);

    const rule = resolved[0]!;
    // The second (later) rule should win
    expect(configField(rule, "hours")).toBe(48);
    expect(configField(rule, "priority")).toBe("HIGH");
  });

  it("builds compilation rules via factories using resolved scopes", () => {
    const factory = vi.fn(
      (_config: { tag: string; scope?: { memberIds?: string[] } }) =>
        ({ compile: vi.fn() }) satisfies CompilationRule,
    );
    const factories: CpsatRuleFactories = {
      "min-hours-day": factory as any,
    };

    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "min-hours-day",
        hours: 5,
        priority: "MANDATORY",
      },
    ];

    const rules = buildCpsatRules(entries, members, factories);
    expect(rules).toHaveLength(1);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[0]?.[0]).toMatchObject({
      hours: 5,
      priority: "MANDATORY",
      memberIds: ["alice", "bob"],
    });
  });

  it("expands role-scoped rules to member IDs", () => {
    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "max-hours-day",
        hours: 7,
        priority: "MANDATORY",
        roleIds: ["role"],
      },
    ];

    const resolved = resolveRuleScopes(entries, members);
    expect(resolved).toHaveLength(1);

    const rule = resolved[0]!;
    // Role scope is expanded to concrete member IDs
    expect(configField(rule, "memberIds")).toEqual(["alice", "bob"]);
    expect(configField(rule, "hours")).toBe(7);
  });

  it("expands skill-scoped rules to member IDs", () => {
    const membersWithSkills = [
      { id: "alice", roles: ["role"], skills: ["first-aid"] },
      { id: "bob", roles: ["role"], skills: [] },
      { id: "charlie", roles: ["role"], skills: ["first-aid", "cpr"] },
    ];

    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "max-hours-day",
        hours: 5,
        priority: "HIGH",
        skillIds: ["first-aid"],
      },
    ];

    const resolved = resolveRuleScopes(entries, membersWithSkills);
    expect(resolved).toHaveLength(1);

    const rule = resolved[0]!;
    // Skill scope is expanded to members with that skill
    expect(configField(rule, "memberIds")).toEqual(["alice", "charlie"]);
  });

  it("drops rules that match no members", () => {
    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "max-hours-day",
        hours: 5,
        priority: "HIGH",
        skillIds: ["nonexistent"],
      },
    ];

    const resolved = resolveRuleScopes(entries, members);
    expect(resolved).toHaveLength(0);
  });

  it("drops rules with memberIds that match no members (case-sensitive)", () => {
    // This is a regression test for a bug where providing memberIds that don't match
    // any members (e.g., due to case mismatch) would cause the rule to fall back to
    // global scope, affecting ALL members instead of none.
    const membersWithCasing = [
      { id: "Alice", roles: ["role"] }, // Capital A
      { id: "Bob", roles: ["role"] }, // Capital B
    ];

    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "time-off",

        priority: "MANDATORY",
        memberIds: ["alice"], // lowercase - won't match "Alice"
        dayOfWeek: ["saturday", "sunday"],
      },
    ];

    const resolved = resolveRuleScopes(entries, membersWithCasing);

    // The rule should be dropped entirely since no members match,
    // NOT converted to a global rule affecting everyone
    expect(resolved).toHaveLength(0);
  });

  it("does not fall back to global scope when explicit memberIds match no one", () => {
    // Verify that explicit memberIds scope is preserved even when empty,
    // rather than being converted to global scope
    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "max-hours-day",

        hours: 4,
        priority: "MANDATORY",
        memberIds: ["nonexistent-member"],
      },
      {
        name: "max-hours-day",

        hours: 8,
        priority: "MANDATORY",
        // No scope = global,
      },
    ];

    const resolved = resolveRuleScopes(entries, members);

    // Should only have the global rule, not the specific one that matched no one
    expect(resolved).toHaveLength(1);
    const entry = resolved[0];
    assert(entry);
    expect(configField(entry, "hours")).toBe(8);
    expect(configField(entry, "memberIds")).toEqual(["alice", "bob"]);
  });

  it("role-scoped rules claim members before global rules", () => {
    const membersWithRoles = [
      { id: "alice", roles: ["student"] },
      { id: "bob", roles: ["manager"] },
      { id: "charlie", roles: ["student", "manager"] },
    ];

    const entries: CpsatRuleConfigEntry[] = [
      // Global rule: 48 hours for everyone
      {
        name: "max-hours-week",
        hours: 48,
        priority: "MANDATORY",
      },
      // Student rule: 20 hours (more specific)
      {
        name: "max-hours-week",

        hours: 20,
        priority: "MANDATORY",
        roleIds: ["student"],
      },
    ];

    const resolved = resolveRuleScopes(entries, membersWithRoles);
    expect(resolved).toHaveLength(2);

    // Student rule claims alice and charlie
    const studentRule = resolved.find((r) => configField(r, "hours") === 20);
    assert(studentRule);
    expect(configField(studentRule, "memberIds")).toEqual(["alice", "charlie"]);

    // Global rule gets only bob (the remainder)
    const globalRule = resolved.find((r) => configField(r, "hours") === 48);
    assert(globalRule);
    expect(configField(globalRule, "memberIds")).toEqual(["bob"]);
  });

  it("preserves time scopes such as date ranges and days of week", () => {
    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "max-hours-day",

        hours: 6,
        priority: "HIGH",
        dayOfWeek: ["monday", "tuesday"],
      },
      {
        name: "max-hours-day",

        hours: 8,
        priority: "MANDATORY",
        dateRange: { start: "2024-02-01", end: "2024-02-07" },
      },
    ];

    const resolved = resolveRuleScopes(entries, members);
    expect(
      resolved.some((r) => {
        const dow = configField(r, "dayOfWeek") as string[] | undefined;
        return dow?.includes("monday");
      }),
    ).toBe(true);
    expect(
      resolved.some((r) => {
        const range = configField(r, "dateRange") as { start: string; end: string } | undefined;
        return range?.start === "2024-02-01";
      }),
    ).toBe(true);
  });

  it("passes through non-scoped rules unchanged", () => {
    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "assign-together",
        groupMemberIds: ["alice", "bob"],
        priority: "MANDATORY",
      },
      {
        name: "assign-together",
        groupMemberIds: ["bob", "charlie"],
        priority: "HIGH",
      },
    ];

    const membersWithCharlie = [
      { id: "alice", roles: ["role"] },
      { id: "bob", roles: ["role"] },
      { id: "charlie", roles: ["role"] },
    ];

    const resolved = resolveRuleScopes(entries, membersWithCharlie);

    // Both rules should pass through unchanged (no scope resolution)
    expect(resolved).toHaveLength(2);

    const [first, second] = resolved;
    assert(first);
    assert(second);

    // First rule unchanged
    expect(first.name).toBe("assign-together");
    expect(configField(first, "groupMemberIds")).toEqual(["alice", "bob"]);
    expect(configField(first, "priority")).toBe("MANDATORY");

    // Second rule unchanged
    expect(second.name).toBe("assign-together");
    expect(configField(second, "groupMemberIds")).toEqual(["bob", "charlie"]);
    expect(configField(second, "priority")).toBe("HIGH");

    // Neither should have memberIds added (not scoped)
    expect(configField(first, "memberIds")).toBeUndefined();
    expect(configField(second, "memberIds")).toBeUndefined();
  });

  it("mixes non-scoped and scoped rules correctly", () => {
    const entries: CpsatRuleConfigEntry[] = [
      {
        name: "assign-together",
        groupMemberIds: ["alice", "bob"],
        priority: "MANDATORY",
      },
      {
        name: "max-hours-day",
        hours: 8,
        priority: "MANDATORY",
      },
      {
        name: "assign-together",
        groupMemberIds: ["charlie", "diana"],
        priority: "HIGH",
      },
    ];

    const allMembers = [
      { id: "alice", roles: ["role"] },
      { id: "bob", roles: ["role"] },
      { id: "charlie", roles: ["role"] },
      { id: "diana", roles: ["role"] },
    ];

    const resolved = resolveRuleScopes(entries, allMembers);

    expect(resolved).toHaveLength(3);

    // Non-scoped rules pass through as-is
    const assignTogetherRules = resolved.filter((r) => r.name === "assign-together");
    expect(assignTogetherRules).toHaveLength(2);
    const together0 = assignTogetherRules[0];
    const together1 = assignTogetherRules[1];
    assert(together0);
    assert(together1);
    expect(configField(together0, "groupMemberIds")).toEqual(["alice", "bob"]);
    expect(configField(together1, "groupMemberIds")).toEqual(["charlie", "diana"]);

    // Scoped rule gets all members (global scope)
    const maxHoursRule = resolved.find((r) => r.name === "max-hours-day");
    assert(maxHoursRule);
    expect(configField(maxHoursRule, "memberIds")).toEqual(["alice", "bob", "charlie", "diana"]);
  });
});

describe("CP-SAT rule validation", () => {
  it("rejects conflicting scope definitions", () => {
    expect(() =>
      // @ts-expect-error: deliberately passing both memberIds and roleIds to test runtime validation
      createMaxHoursDayRule({
        hours: 8,
        priority: "MANDATORY",
        memberIds: ["alice"],
        roleIds: ["role"],
      }),
    ).toThrow(/Only one of memberIds\/roleIds\/skillIds is allowed/);
  });
});
