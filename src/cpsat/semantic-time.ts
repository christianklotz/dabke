import type { DayOfWeek, TimeOfDay } from "../types.js";
import { toDayOfWeekUTC } from "../datetime.utils.js";
import { parseDayString } from "./utils.js";
import type { CoverageRequirement, Priority } from "./types.js";
import { groupKey, type GroupKey } from "./validation.types.js";

/**
 * Base definition for a semantic time period.
 *
 * @category Semantic Times
 */
export interface SemanticTimeDef {
  /** When this time period starts. */
  startTime: TimeOfDay;
  /** When this time period ends. */
  endTime: TimeOfDay;
}

/**
 * Variant of a semantic time that applies to specific days or dates.
 *
 * @category Semantic Times
 */
export interface SemanticTimeVariant extends SemanticTimeDef {
  /** Apply this variant only on these days of the week */
  dayOfWeek?: DayOfWeek[];
  /** Apply this variant only on these specific dates (YYYY-MM-DD) */
  dates?: string[];
}

/**
 * A semantic time can be a simple definition (applies every day)
 * or an array of variants with different times for different days/dates.
 *
 * @category Semantic Times
 */
export type SemanticTimeEntry = SemanticTimeDef | SemanticTimeVariant[];

/**
 * Base fields shared by semantic coverage requirement variants.
 */
interface SemanticCoverageRequirementBase<S extends string> {
  semanticTime: S;
  targetCount: number;
  priority?: Priority;
  /** Scope this requirement to specific days of the week */
  dayOfWeek?: DayOfWeek[];
  /** Scope this requirement to specific dates (YYYY-MM-DD) */
  dates?: string[];
  /**
   * Override the auto-generated group key for validation reporting.
   * If not provided, a key is auto-generated from the semantic time name,
   * role/skills, and target count.
   */
  groupKey?: GroupKey;
}

/**
 * Semantic coverage requiring specific roles, optionally filtered by skills.
 */
interface RoleBasedSemanticCoverageRequirement<
  S extends string,
> extends SemanticCoverageRequirementBase<S> {
  /**
   * Roles that satisfy this coverage (OR logic).
   * Must have at least one role.
   */
  roleIds: [string, ...string[]];
  /**
   * Additional skill filter (AND logic with roles).
   */
  skillIds?: [string, ...string[]];
}

/**
 * Semantic coverage requiring specific skills only (any role).
 */
interface SkillBasedSemanticCoverageRequirement<
  S extends string,
> extends SemanticCoverageRequirementBase<S> {
  roleIds?: never;
  /**
   * Skills required (ALL required, AND logic).
   * Must have at least one skill.
   */
  skillIds: [string, ...string[]];
}

/**
 * Coverage requirement that references a semantic time by name.
 * Type-safe: S is constrained to known semantic time names.
 *
 * This is a discriminated union enforcing at compile time that at least
 * one of `roleIds` or `skillIds` must be provided.
 *
 * @remarks
 * **Fields:**
 * - `semanticTime` (required) — name of a defined semantic time
 * - `targetCount` (required) — how many people are needed
 * - `roleIds` — roles that satisfy this (OR logic); at least one of `roleIds`/`skillIds` required
 * - `skillIds` — skills required (AND logic); at least one of `roleIds`/`skillIds` required
 * - `dayOfWeek` — scope to specific days of the week (e.g. `["monday", "tuesday"]`)
 * - `dates` — scope to specific dates (`"YYYY-MM-DD"` strings)
 * - `priority` — `"MANDATORY"` | `"HIGH"` | `"MEDIUM"` | `"LOW"`
 *
 * **IMPORTANT: Coverage entries for the same semantic time STACK additively.**
 * For weekday vs weekend staffing, use mutually exclusive `dayOfWeek` on BOTH entries:
 *
 * @example Weekday vs weekend (mutually exclusive dayOfWeek)
 * ```typescript
 * { semanticTime: "lunch", roleIds: ["waiter"], targetCount: 2,
 *   dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"] },
 * { semanticTime: "lunch", roleIds: ["waiter"], targetCount: 3,
 *   dayOfWeek: ["saturday", "sunday"] },
 * ```
 *
 * @example Skill-based coverage (any role with the skill)
 * ```typescript
 * { semanticTime: "opening", skillIds: ["keyholder"], targetCount: 1 },
 * ```
 *
 * @category Semantic Times
 */
export type SemanticCoverageRequirement<S extends string> =
  | RoleBasedSemanticCoverageRequirement<S>
  | SkillBasedSemanticCoverageRequirement<S>;

/**
 * Base fields shared by concrete coverage requirement variants.
 */
interface ConcreteCoverageRequirementBase {
  day: string;
  startTime: TimeOfDay;
  endTime: TimeOfDay;
  targetCount: number;
  priority?: Priority;
  /**
   * Override the auto-generated group key for validation reporting.
   * If not provided, a key is auto-generated from the day, time range,
   * role/skills, and target count.
   */
  groupKey?: GroupKey;
}

/**
 * Concrete coverage requiring specific roles, optionally filtered by skills.
 */
interface RoleBasedConcreteCoverageRequirement extends ConcreteCoverageRequirementBase {
  /**
   * Roles that satisfy this coverage (OR logic).
   * Must have at least one role.
   */
  roleIds: [string, ...string[]];
  /**
   * Additional skill filter (AND logic with roles).
   */
  skillIds?: [string, ...string[]];
}

/**
 * Concrete coverage requiring specific skills only (any role).
 */
interface SkillBasedConcreteCoverageRequirement extends ConcreteCoverageRequirementBase {
  roleIds?: never;
  /**
   * Skills required (ALL required, AND logic).
   * Must have at least one skill.
   */
  skillIds: [string, ...string[]];
}

/**
 * Concrete coverage requirement with explicit day and times.
 * Used for one-off requirements that don't fit a semantic time.
 *
 * This is a discriminated union enforcing at compile time that at least
 * one of `roleIds` or `skillIds` must be provided.
 *
 * @category Semantic Times
 */
export type ConcreteCoverageRequirement =
  | RoleBasedConcreteCoverageRequirement
  | SkillBasedConcreteCoverageRequirement;

/**
 * Union type for coverage - either semantic (type-safe) or concrete.
 *
 * @category Semantic Times
 */
export type MixedCoverageRequirement<S extends string> =
  | SemanticCoverageRequirement<S>
  | ConcreteCoverageRequirement;

/**
 * Type guard to check if a requirement is concrete (has explicit day/times).
 */
export function isConcreteCoverage<S extends string>(
  req: MixedCoverageRequirement<S>,
): req is ConcreteCoverageRequirement {
  return "day" in req && "startTime" in req && "endTime" in req;
}

/**
 * Type guard to check if a requirement is semantic (references a named time).
 */
export function isSemanticCoverage<S extends string>(
  req: MixedCoverageRequirement<S>,
): req is SemanticCoverageRequirement<S> {
  return "semanticTime" in req;
}

/**
 * Result of defineSemanticTimes - provides type-safe coverage function.
 *
 * @category Semantic Times
 */
export interface SemanticTimeContext<S extends string> {
  /** The semantic time definitions */
  readonly defs: Record<S, SemanticTimeEntry>;

  /**
   * Create coverage requirements with type-safe semantic time names.
   * Accepts both semantic references and concrete one-off requirements.
   */
  coverage(reqs: MixedCoverageRequirement<S>[]): MixedCoverageRequirement<S>[];

  /**
   * Resolve all coverage requirements to concrete CoverageRequirement[]
   * for the given days in the scheduling horizon.
   */
  resolve(reqs: MixedCoverageRequirement<S>[], days: string[]): CoverageRequirement[];
}

/**
 * Define semantic times with type-safe names.
 *
 * Returns a context object that provides:
 * - Type-safe coverage() function that only accepts defined semantic time names
 * - resolve() function to expand semantic times to concrete requirements
 *
 * @category Semantic Times
 *
 * @example Basic usage
 * ```typescript
 * const times = defineSemanticTimes({
 *   opening: { startTime: { hours: 6 }, endTime: { hours: 8 } },
 *   lunch: { startTime: { hours: 11, minutes: 30 }, endTime: { hours: 14 } },
 *   closing: { startTime: { hours: 21 }, endTime: { hours: 23 } },
 * });
 *
 * const coverage = times.coverage([
 *   { semanticTime: "lunch", roleId: "server", targetCount: 3 },
 *   { semanticTime: "opening", roleId: "keyholder", targetCount: 1, priority: "MANDATORY" },
 *   // Type error: "dinner" is not a defined semantic time
 *   // { semanticTime: "dinner", roleId: "server", targetCount: 2 },
 * ]);
 * ```
 *
 * @example Variants for different days
 * ```typescript
 * const times = defineSemanticTimes({
 *   lunch: [
 *     { startTime: { hours: 11, minutes: 30 }, endTime: { hours: 14 }, dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"] },
 *     { startTime: { hours: 12 }, endTime: { hours: 15 }, dayOfWeek: ["saturday", "sunday"] },
 *   ],
 * });
 * ```
 *
 * @example Mixed semantic and concrete coverage
 * ```typescript
 * const coverage = times.coverage([
 *   { semanticTime: "lunch", roleId: "server", targetCount: 3 },
 *   // One-off party - concrete time
 *   { day: "2026-01-14", startTime: { hours: 15 }, endTime: { hours: 20 }, roleId: "server", targetCount: 5 },
 * ]);
 * ```
 */
export function defineSemanticTimes<const T extends Record<string, SemanticTimeEntry>>(
  defs: T,
): SemanticTimeContext<keyof T & string> {
  type S = keyof T & string;

  return {
    defs: defs as Record<S, SemanticTimeEntry>,

    coverage(reqs: MixedCoverageRequirement<S>[]): MixedCoverageRequirement<S>[] {
      return reqs;
    },

    resolve(reqs: MixedCoverageRequirement<S>[], days: string[]): CoverageRequirement[] {
      return resolveSemanticCoverage(defs, reqs, days);
    },
  };
}

/**
 * Build a CoverageRequirement from resolved fields.
 * Handles the discriminated union by checking which variant to construct.
 */
function buildCoverageRequirement(
  day: string,
  startTime: TimeOfDay,
  endTime: TimeOfDay,
  roleIds: [string, ...string[]] | undefined,
  skillIds: [string, ...string[]] | undefined,
  targetCount: number,
  priority: Priority,
  gKey: GroupKey,
): CoverageRequirement {
  const base = { day, startTime, endTime, targetCount, priority, groupKey: gKey };

  if (roleIds && roleIds.length > 0) {
    // Role-based (with optional skills)
    return skillIds && skillIds.length > 0 ? { ...base, roleIds, skillIds } : { ...base, roleIds };
  } else if (skillIds && skillIds.length > 0) {
    // Skill-only
    return { ...base, skillIds };
  }

  // This shouldn't happen if input types are correct, but handle gracefully
  throw new Error(
    `Coverage requirement for day "${day}" must have at least one of roleIds or skillIds`,
  );
}

/**
 * Resolve semantic coverage requirements to concrete requirements.
 * Internal implementation.
 */
function resolveSemanticCoverage<S extends string>(
  defs: Record<S, SemanticTimeEntry>,
  reqs: MixedCoverageRequirement<S>[],
  days: string[],
): CoverageRequirement[] {
  const result: CoverageRequirement[] = [];
  const daySet = new Set(days);

  for (const req of reqs) {
    if (isConcreteCoverage(req)) {
      // Concrete requirement - pass through if day is in horizon
      if (daySet.has(req.day)) {
        const autoGroupKey = generateConcreteGroupKey(req);
        result.push(
          buildCoverageRequirement(
            req.day,
            req.startTime,
            req.endTime,
            req.roleIds,
            req.skillIds,
            req.targetCount,
            req.priority ?? "MANDATORY",
            req.groupKey ?? autoGroupKey,
          ),
        );
      }
    } else {
      // Semantic requirement - resolve for each applicable day
      const entry = defs[req.semanticTime];
      if (!entry) {
        throw new Error(`Unknown semantic time: ${req.semanticTime}`);
      }

      const autoGroupKey = generateSemanticGroupKey(req);
      const applicableDays = filterDays(days, req.dayOfWeek, req.dates);

      for (const day of applicableDays) {
        const resolved = resolveTimeForDay(entry, day);
        if (resolved) {
          result.push(
            buildCoverageRequirement(
              day,
              resolved.startTime,
              resolved.endTime,
              req.roleIds,
              req.skillIds,
              req.targetCount,
              req.priority ?? "MANDATORY",
              req.groupKey ?? autoGroupKey,
            ),
          );
        }
      }
    }
  }

  return result;
}

/**
 * Generates a human-readable group key for a semantic coverage requirement.
 * Format: "{count}x {role/skills} during {semanticTime}" with optional scope
 */
function generateSemanticGroupKey<S extends string>(req: SemanticCoverageRequirement<S>): GroupKey {
  const roleOrSkills = req.roleIds?.join("/") ?? req.skillIds?.join("+") ?? "staff";
  const base = `${req.targetCount}x ${roleOrSkills} during ${req.semanticTime}`;

  // Add scope qualifier if scoped to specific days
  if (req.dayOfWeek && req.dayOfWeek.length > 0 && req.dayOfWeek.length < 7) {
    return groupKey(`${base} (${formatDaysScope(req.dayOfWeek)})`);
  }
  if (req.dates && req.dates.length > 0) {
    return groupKey(`${base} (specific dates)`);
  }

  return groupKey(base);
}

/**
 * Generates a human-readable group key for a concrete coverage requirement.
 * Format: "{count}x {role/skills} on {day} {time}"
 */
function generateConcreteGroupKey(req: ConcreteCoverageRequirement): GroupKey {
  const roleOrSkills = req.roleIds?.join("/") ?? req.skillIds?.join("+") ?? "staff";
  const timeRange = `${formatTime(req.startTime)}-${formatTime(req.endTime)}`;
  return groupKey(`${req.targetCount}x ${roleOrSkills} on ${req.day} ${timeRange}`);
}

/**
 * Formats days of week for display in group keys.
 */
function formatDaysScope(days: DayOfWeek[]): string {
  if (days.length === 0) return "";
  if (days.length === 1) return days[0]!;

  // Check for common patterns
  const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday"];
  const weekend = ["saturday", "sunday"];

  const sorted = days.toSorted((a, b) => weekdays.indexOf(a) - weekdays.indexOf(b));

  if (sorted.length === 5 && weekdays.every((d) => sorted.includes(d as DayOfWeek))) {
    return "weekdays";
  }
  if (sorted.length === 2 && weekend.every((d) => sorted.includes(d as DayOfWeek))) {
    return "weekends";
  }

  // Abbreviate day names
  return sorted.map((d) => d.slice(0, 3)).join(", ");
}

/**
 * Formats a TimeOfDay for display.
 */
function formatTime(time: TimeOfDay): string {
  const hours = String(time.hours).padStart(2, "0");
  const minutes = String(time.minutes).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Filter days based on optional day-of-week and specific date constraints.
 */
function filterDays(
  allDays: string[],
  dayOfWeek?: DayOfWeek[],
  specificDates?: string[],
): string[] {
  let result = allDays;

  if (specificDates && specificDates.length > 0) {
    // If specific dates are provided, use only those (intersection with allDays)
    const dateSet = new Set(specificDates);
    result = result.filter((d) => dateSet.has(d));
  } else if (dayOfWeek && dayOfWeek.length > 0) {
    // Filter by day of week
    const daySet = new Set(dayOfWeek);
    result = result.filter((d) => daySet.has(toDayOfWeekUTC(parseDayString(d))));
  }

  return result;
}

/**
 * Resolve the time definition for a specific day.
 * Returns the most specific match: date-specific > day-of-week > default.
 */
function resolveTimeForDay(entry: SemanticTimeEntry, day: string): SemanticTimeDef | null {
  // Simple definition - applies to all days
  if (!Array.isArray(entry)) {
    return entry;
  }

  const date = parseDayString(day);
  const dayOfWeek = toDayOfWeekUTC(date);

  // Find best match: date-specific first, then day-of-week, then default
  let dateMatch: SemanticTimeVariant | null = null;
  let dowMatch: SemanticTimeVariant | null = null;
  let defaultMatch: SemanticTimeVariant | null = null;

  for (const variant of entry) {
    if (variant.dates && variant.dates.includes(day)) {
      dateMatch = variant;
      break; // Date-specific is most specific
    }
    if (variant.dayOfWeek && variant.dayOfWeek.includes(dayOfWeek)) {
      dowMatch = variant;
    }
    if (!variant.dates && !variant.dayOfWeek) {
      defaultMatch = variant;
    }
  }

  const match = dateMatch ?? dowMatch ?? defaultMatch;
  return match ?? null;
}
