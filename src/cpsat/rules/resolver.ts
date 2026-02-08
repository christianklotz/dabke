import type { SchedulingEmployee } from "../types.js";
import {
  normalizeScope,
  specificity,
  subtractIds,
  timeScopeKey,
  type EntityScope,
  type RuleScope,
} from "./scoping.js";
import { builtInCpsatRuleFactories } from "./registry.js";
import type {
  CpsatRuleConfigEntry,
  CpsatRuleFactories,
  CpsatRuleName,
  CpsatRuleRegistry,
} from "./rules.types.js";
import type { CompilationRule } from "../model-builder.js";

type ResolvedRuleConfigEntry = {
  name: CpsatRuleName;
  config: CpsatRuleRegistry[CpsatRuleName];
};

type InternalEntry = {
  index: number;
  name: CpsatRuleName;
  config: CpsatRuleRegistry[CpsatRuleName];
  scope: RuleScope;
};

/**
 * Gets the IDs that match an entity scope.
 * All scope types are expanded to concrete IDs.
 */
export function getEmployeeIdsForScope(
  entity: EntityScope,
  employees: SchedulingEmployee[],
): string[] {
  switch (entity.type) {
    case "employees":
      // Filter to only IDs that exist in the team
      const validIds = new Set(employees.map((e) => e.id));
      return entity.employeeIds.filter((id) => validIds.has(id));

    case "roles":
      // Find team members that have any of the specified roles
      return employees
        .filter((e) => e.roleIds.some((r) => entity.roleIds.includes(r)))
        .map((e) => e.id);

    case "skills":
      // Find team members that have any of the specified skills
      return employees
        .filter((e) => e.skillIds?.some((s) => entity.skillIds.includes(s)))
        .map((e) => e.id);

    case "global":
    default:
      return employees.map((e) => e.id);
  }
}

/**
 * Rules that don't use standard scoping and should pass through unchanged.
 */
const NON_SCOPED_RULES = new Set<string>(["assign-together"]);

/**
 * Resolves overlapping scopes so that more specific scopes override broader ones.
 *
 * Resolution rules:
 * 1. Rules in NON_SCOPED_RULES pass through unchanged (they handle their own logic)
 * 2. Rules with different time scopes coexist (different time windows don't compete)
 * 3. Within the same time scope, rules are sorted by specificity (person > role > skill > global)
 *    and then by insertion order (later wins for same specificity, i.e., last insert overrides)
 * 4. More specific rules claim their IDs first; less specific rules get the remainder
 * 5. All scope types (person, role, skill, global) are expanded to explicit IDs
 */
export function resolveRuleScopes(
  entries: CpsatRuleConfigEntry[],
  employees: SchedulingEmployee[],
): ResolvedRuleConfigEntry[] {
  const resolved: ResolvedRuleConfigEntry[] = [];
  const scopedEntries: Array<{ entry: CpsatRuleConfigEntry; index: number }> = [];

  // Separate rules that use scoping from those that don't
  entries.forEach((entry, index) => {
    if (NON_SCOPED_RULES.has(entry.name)) {
      // Pass through unchanged
      resolved.push({ name: entry.name, config: entry.config });
    } else {
      scopedEntries.push({ entry, index });
    }
  });

  if (scopedEntries.length === 0) {
    return resolved;
  }

  // Group scoped entries by (ruleName, timeScopeKey) - different time scopes don't compete
  const grouped = new Map<string, InternalEntry[]>();
  scopedEntries.forEach(({ entry, index }) => {
    const scope = normalizeScope(entry.config as Parameters<typeof normalizeScope>[0], employees);
    const timeKey = timeScopeKey(scope.time);
    const groupKey = `${entry.name}::${timeKey}`;
    const list = grouped.get(groupKey) ?? [];
    list.push({ index, name: entry.name, config: entry.config, scope });
    grouped.set(groupKey, list);
  });

  for (const group of grouped.values()) {
    // Sort by specificity (descending), then by insertion order (descending, later wins)
    const sorted = group
      .map((g) => ({
        ...g,
        specificity: specificity(g.scope.entity),
      }))
      .toSorted((a, b) => {
        if (b.specificity !== a.specificity) {
          return b.specificity - a.specificity;
        }
        // Later insertion wins (higher index first)
        return b.index - a.index;
      });

    // Track assigned IDs - all scope types participate in claiming
    const assignedEmployees = new Set<string>();

    for (const entry of sorted) {
      const { entity } = entry.scope;

      // Get IDs for this scope (expands role/skill to concrete IDs)
      const targetIds = getEmployeeIdsForScope(entity, employees);

      // Only claim IDs not already assigned to a more specific rule
      const remaining = subtractIds(targetIds, assignedEmployees);
      if (remaining.length === 0) continue;

      // Claim these IDs
      remaining.forEach((id) => assignedEmployees.add(id));

      // Emit resolved config with explicit IDs
      // Remove roleIds/skillIds since we've expanded them to employeeIds
      const {
        roleIds: _roleIds,
        skillIds: _skillIds,
        ...configWithoutEntityScope
      } = entry.config as Record<string, unknown>;
      resolved.push({
        name: entry.name,
        config: {
          ...configWithoutEntityScope,
          employeeIds: remaining,
        } as CpsatRuleRegistry[CpsatRuleName],
      });
    }
  }

  return resolved;
}

/**
 * Builds CompilationRule instances from named configs, applying scoping resolution.
 */
export function buildCpsatRules(
  entries: CpsatRuleConfigEntry[],
  employees: SchedulingEmployee[],
  factories: CpsatRuleFactories = builtInCpsatRuleFactories,
): CompilationRule[] {
  if (entries.length === 0) return [];

  const resolved = resolveRuleScopes(entries, employees);

  return resolved.map((entry) => {
    const factory = factories[entry.name];
    if (!factory) {
      throw new Error(`Unknown CP-SAT rule "${entry.name}"`);
    }
    return factory(entry.config as any);
  });
}
