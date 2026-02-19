import type { SchedulingMember } from "../types.js";
import {
  parseEntityScope,
  parseTimeScope,
  type ParsedEntityScope,
  type ParsedTimeScope,
} from "./scope.types.js";
import { builtInCpsatRuleFactories } from "./registry.js";
import type {
  CpsatRuleConfigEntry,
  CpsatRuleFactories,
  CpsatRuleName,
  CpsatRuleRegistry,
} from "./rules.types.js";
import type { CompilationRule } from "../model-builder.js";

type InternalEntry = {
  index: number;
  name: CpsatRuleName;
  config: CpsatRuleRegistry[CpsatRuleName];
  entityScope: ParsedEntityScope;
  timeScope: ParsedTimeScope;
};

/**
 * Extract the config portion from a flat rule entry (everything except `name`).
 */
function entryConfig(entry: CpsatRuleConfigEntry): CpsatRuleRegistry[CpsatRuleName] {
  const { name: _name, ...config } = entry;
  return config as CpsatRuleRegistry[CpsatRuleName];
}

/**
 * Gets the IDs that match an entity scope.
 * All scope types are expanded to concrete IDs.
 */
export function getMemberIdsForScope(
  entity: ParsedEntityScope,
  members: SchedulingMember[],
): string[] {
  switch (entity.type) {
    case "members": {
      const validIds = new Set(members.map((e) => e.id));
      return entity.memberIds.filter((id) => validIds.has(id));
    }
    case "roles":
      return members
        .filter((e) => e.roles.some((r) => entity.roleIds.includes(r)))
        .map((e) => e.id);
    case "skills":
      return members
        .filter((e) => e.skills?.some((s) => entity.skillIds.includes(s)))
        .map((e) => e.id);
    case "global":
    default:
      return members.map((e) => e.id);
  }
}

/** Specificity ranking for entity scopes (higher = more specific). */
function specificity(entity: ParsedEntityScope): number {
  switch (entity.type) {
    case "members":
      return 4;
    case "roles":
      return 3;
    case "skills":
      return 2;
    case "global":
    default:
      return 1;
  }
}

/** Filter out IDs already claimed by more specific scopes. */
function subtractIds(ids: string[], assigned: Set<string>): string[] {
  return ids.filter((id) => !assigned.has(id));
}

/**
 * Creates a stable key for a time scope to use in grouping.
 * Rules with different time scope keys don't compete for deduplication.
 */
function timeScopeKey(time: ParsedTimeScope): string {
  switch (time.type) {
    case "none":
      return "always";
    case "dateRange":
      return `dateRange:${time.start}:${time.end}`;
    case "specificDates":
      return `specificDates:${[...time.dates].toSorted().join(",")}`;
    case "dayOfWeek":
      return `dayOfWeek:${[...time.days].toSorted().join(",")}`;
    case "recurring":
      return `recurring:${time.periods.map((p) => `${p.startMonth}-${p.startDay}:${p.endMonth}-${p.endDay}`).join(";")}`;
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
  members: SchedulingMember[],
): CpsatRuleConfigEntry[] {
  const resolved: CpsatRuleConfigEntry[] = [];
  const scopedEntries: Array<{ entry: CpsatRuleConfigEntry; index: number }> = [];

  entries.forEach((entry, index) => {
    if (NON_SCOPED_RULES.has(entry.name)) {
      resolved.push(entry);
    } else {
      scopedEntries.push({ entry, index });
    }
  });

  if (scopedEntries.length === 0) {
    return resolved;
  }

  const grouped = new Map<string, InternalEntry[]>();
  scopedEntries.forEach(({ entry, index }) => {
    const config = entryConfig(entry);
    const entity = parseEntityScope(config);
    const time = parseTimeScope(config);
    const timeKey = timeScopeKey(time);
    const groupKey = `${entry.name}::${timeKey}`;
    const list = grouped.get(groupKey) ?? [];
    list.push({
      index,
      name: entry.name,
      config,
      entityScope: entity,
      timeScope: time,
    });
    grouped.set(groupKey, list);
  });

  for (const group of grouped.values()) {
    const sorted = group.toSorted((a, b) => {
      const specA = specificity(a.entityScope);
      const specB = specificity(b.entityScope);
      if (specB !== specA) return specB - specA;
      return b.index - a.index;
    });

    const assignedMembers = new Set<string>();

    for (const entry of sorted) {
      const targetIds = getMemberIdsForScope(entry.entityScope, members);
      const remaining = subtractIds(targetIds, assignedMembers);
      if (remaining.length === 0) continue;

      remaining.forEach((id) => assignedMembers.add(id));

      const {
        memberIds: _memberIds,
        roleIds: _roleIds,
        skillIds: _skillIds,
        ...configWithoutEntityScope
      } = entry.config as Record<string, unknown>;
      resolved.push({
        name: entry.name,
        ...configWithoutEntityScope,
        memberIds: remaining,
      } as CpsatRuleConfigEntry);
    }
  }

  return resolved;
}

/**
 * Builds CompilationRule instances from named configs, applying scoping resolution.
 */
export function buildCpsatRules(
  entries: CpsatRuleConfigEntry[],
  members: SchedulingMember[],
  factories: CpsatRuleFactories = builtInCpsatRuleFactories,
): CompilationRule[] {
  if (entries.length === 0) return [];

  const resolved = resolveRuleScopes(entries, members);

  return resolved.map((entry) => {
    const factory = factories[entry.name];
    if (!factory) {
      throw new Error(`Unknown CP-SAT rule "${entry.name}"`);
    }
    return factory(entryConfig(entry));
  });
}
