import type { DayOfWeek, TimeOfDay } from "../types.js";
import { toDayOfWeekUTC } from "../datetime.utils.js";
import { parseDayString } from "./utils.js";
import type { CoverageRequirement, Priority } from "./types.js";
import { validationGroup, type ValidationGroup } from "./validation.types.js";

/**
 * Base definition for a semantic time period.
 */
export interface SemanticTimeDef {
  /** When this time period starts. */
  startTime: TimeOfDay;
  /** When this time period ends. */
  endTime: TimeOfDay;
}

/**
 * A time entry, optionally scoped to specific days or dates.
 *
 * Used both as an argument to {@link time} and as the internal variant type.
 * An entry without `dayOfWeek` or `dates` is the default (applies when no
 * scoped entry matches). At most one default is allowed per {@link time} call.
 *
 * Resolution precedence: `dates` > `dayOfWeek` > default.
 */
export interface SemanticTimeVariant extends SemanticTimeDef {
  /** Restrict this entry to specific days of the week. */
  dayOfWeek?: readonly DayOfWeek[];
  /** Restrict this entry to specific dates (YYYY-MM-DD). */
  dates?: string[];
}

/**
 * A semantic time can be a simple definition (applies every day)
 * or an array of variants with different times for different days/dates.
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
   * Override the auto-generated group for validation reporting.
   * If not provided, a group is auto-generated from the semantic time name,
   * role/skills, and target count.
   */
  group?: ValidationGroup;
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
  roles: [string, ...string[]];
  /**
   * Additional skill filter (AND logic with roles).
   */
  skills?: [string, ...string[]];
}

/**
 * Semantic coverage requiring specific skills only (any role).
 */
interface SkillBasedSemanticCoverageRequirement<
  S extends string,
> extends SemanticCoverageRequirementBase<S> {
  roles?: never;
  /**
   * Skills required (ALL required, AND logic).
   * Must have at least one skill.
   */
  skills: [string, ...string[]];
}

/**
 * Coverage requirement that references a semantic time by name.
 * Type-safe: S is constrained to known semantic time names.
 *
 * This is a discriminated union enforcing at compile time that at least
 * one of `roles` or `skills` must be provided.
 *
 * @remarks
 * **Fields:**
 * - `semanticTime` (required) — name of a defined semantic time
 * - `targetCount` (required) — how many people are needed
 * - `roles` — roles that satisfy this (OR logic); at least one of `roles`/`skills` required
 * - `skills` — skills required (AND logic); at least one of `roles`/`skills` required
 * - `dayOfWeek` — scope to specific days of the week (e.g. `["monday", "tuesday"]`)
 * - `dates` — scope to specific dates (`"YYYY-MM-DD"` strings)
 * - `priority` — `"MANDATORY"` | `"HIGH"` | `"MEDIUM"` | `"LOW"`
 *
 * For day-specific count overrides, use {@link VariantCoverageRequirement}
 * instead. When multiple simple entries match the same day, each produces its
 * own independent constraint.
 *
 * @example Weekday vs weekend (mutually exclusive dayOfWeek)
 * ```typescript
 * { semanticTime: "day_shift", roles: ["nurse"], targetCount: 3,
 *   dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"] },
 * { semanticTime: "day_shift", roles: ["nurse"], targetCount: 2,
 *   dayOfWeek: ["saturday", "sunday"] },
 * ```
 *
 * @example Skill-based coverage (any role with the skill)
 * ```typescript
 * { semanticTime: "night_shift", skills: ["charge_nurse"], targetCount: 1 },
 * ```
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
   * Override the auto-generated group for validation reporting.
   * If not provided, a group is auto-generated from the day, time range,
   * role/skills, and target count.
   */
  group?: ValidationGroup;
}

/**
 * Concrete coverage requiring specific roles, optionally filtered by skills.
 */
interface RoleBasedConcreteCoverageRequirement extends ConcreteCoverageRequirementBase {
  /**
   * Roles that satisfy this coverage (OR logic).
   * Must have at least one role.
   */
  roles: [string, ...string[]];
  /**
   * Additional skill filter (AND logic with roles).
   */
  skills?: [string, ...string[]];
}

/**
 * Concrete coverage requiring specific skills only (any role).
 */
interface SkillBasedConcreteCoverageRequirement extends ConcreteCoverageRequirementBase {
  roles?: never;
  /**
   * Skills required (ALL required, AND logic).
   * Must have at least one skill.
   */
  skills: [string, ...string[]];
}

/**
 * Concrete coverage requirement with explicit day and times.
 * Used for one-off requirements that don't fit a semantic time.
 *
 * This is a discriminated union enforcing at compile time that at least
 * one of `roles` or `skills` must be provided.
 */
export type ConcreteCoverageRequirement =
  | RoleBasedConcreteCoverageRequirement
  | SkillBasedConcreteCoverageRequirement;

// ============================================================================
// Variant Coverage Requirements
// ============================================================================

/**
 * A day-specific count within a variant {@link cover} call.
 *
 * Each variant specifies a count and optional day/date scope. During
 * resolution, the most specific matching variant wins for each day
 * (`dates` > `dayOfWeek` > default), mirroring {@link SemanticTimeVariant}.
 * At most one variant may be unscoped (the default).
 *
 * @example
 * ```typescript
 * // Default: 4 agents. Christmas Eve: 2.
 * cover("peak_hours", "agent",
 *   { count: 4 },
 *   { count: 2, dates: ["2025-12-24"] },
 * )
 * ```
 */
export interface CoverageVariant {
  /** Number of people needed. */
  count: number;
  /** Restrict this variant to specific days of the week. */
  dayOfWeek?: readonly DayOfWeek[];
  /** Restrict this variant to specific dates (YYYY-MM-DD). */
  dates?: string[];
  /** Defaults to `"MANDATORY"`. */
  priority?: Priority;
}

/**
 * Base fields shared by variant coverage requirement types.
 */
interface VariantCoverageRequirementBase<S extends string> {
  semanticTime: S;
  /** At least one variant is required. At most one may be unscoped (the default). */
  variants: [CoverageVariant, ...CoverageVariant[]];
  group?: ValidationGroup;
}

/**
 * Variant coverage requiring specific roles, optionally filtered by skills.
 */
interface RoleBasedVariantCoverageRequirement<
  S extends string,
> extends VariantCoverageRequirementBase<S> {
  roles: [string, ...string[]];
  skills?: [string, ...string[]];
}

/**
 * Variant coverage requiring specific skills only (any role).
 */
interface SkillBasedVariantCoverageRequirement<
  S extends string,
> extends VariantCoverageRequirementBase<S> {
  roles?: never;
  skills: [string, ...string[]];
}

/**
 * Coverage requirement with day-specific count overrides.
 *
 * Instead of a single `targetCount`, this type carries an array of
 * {@link CoverageVariant} entries. For each scheduling day, the most
 * specific matching variant is selected using the same precedence as
 * {@link SemanticTimeVariant}: `dates` > `dayOfWeek` > default (unscoped).
 *
 * Only one constraint is emitted per day — variants do NOT stack.
 *
 * @example Decrease from default on a specific date
 * ```typescript
 * {
 *   semanticTime: "peak_hours", roles: ["agent"],
 *   variants: [
 *     { count: 4 },                              // default
 *     { count: 2, dates: ["2025-12-24"] },        // Christmas Eve
 *   ],
 * }
 * ```
 */
export type VariantCoverageRequirement<S extends string> =
  | RoleBasedVariantCoverageRequirement<S>
  | SkillBasedVariantCoverageRequirement<S>;

// ============================================================================
// Mixed Coverage Union
// ============================================================================

/**
 * Union type for coverage — semantic (single count), concrete, or variant (day-specific counts).
 */
export type MixedCoverageRequirement<S extends string> =
  | SemanticCoverageRequirement<S>
  | ConcreteCoverageRequirement
  | VariantCoverageRequirement<S>;

/**
 * Type guard to check if a requirement is concrete (has explicit day/times).
 */
export function isConcreteCoverage<S extends string>(
  req: MixedCoverageRequirement<S>,
): req is ConcreteCoverageRequirement {
  return "day" in req && "startTime" in req && "endTime" in req;
}

/**
 * Type guard to check if a requirement uses variant-based resolution.
 */
export function isVariantCoverage<S extends string>(
  req: MixedCoverageRequirement<S>,
): req is VariantCoverageRequirement<S> {
  return "variants" in req && "semanticTime" in req;
}

/**
 * Type guard to check if a requirement is semantic (references a named time).
 */
export function isSemanticCoverage<S extends string>(
  req: MixedCoverageRequirement<S>,
): req is SemanticCoverageRequirement<S> {
  return "semanticTime" in req && !("variants" in req);
}

/**
 * Result of defineSemanticTimes - provides type-safe coverage function.
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
 * @example Basic usage
 * ```typescript
 * const times = defineSemanticTimes({
 *   morning_round: { startTime: { hours: 7 }, endTime: { hours: 9 } },
 *   day_shift: { startTime: { hours: 7 }, endTime: { hours: 15 } },
 *   night_shift: { startTime: { hours: 23 }, endTime: { hours: 7 } },
 * });
 *
 * const coverage = times.coverage([
 *   { semanticTime: "day_shift", roles: ["nurse"], targetCount: 3 },
 *   { semanticTime: "morning_round", skills: ["charge_nurse"], targetCount: 1, priority: "MANDATORY" },
 *   // Type error: "evening" is not a defined semantic time
 *   // { semanticTime: "evening", roles: ["nurse"], targetCount: 2 },
 * ]);
 * ```
 *
 * @example Variants for different days
 * ```typescript
 * const times = defineSemanticTimes({
 *   peak_hours: [
 *     { startTime: { hours: 9 }, endTime: { hours: 17 }, dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"] },
 *     { startTime: { hours: 10 }, endTime: { hours: 16 }, dayOfWeek: ["saturday", "sunday"] },
 *   ],
 * });
 * ```
 *
 * @example Mixed semantic and concrete coverage
 * ```typescript
 * const coverage = times.coverage([
 *   { semanticTime: "day_shift", roles: ["nurse"], targetCount: 3 },
 *   // One-off event requiring extra staff
 *   { day: "2026-01-14", startTime: { hours: 8 }, endTime: { hours: 12 }, roles: ["nurse"], targetCount: 5 },
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
  roles: [string, ...string[]] | undefined,
  skills: [string, ...string[]] | undefined,
  targetCount: number,
  priority: Priority,
  group: ValidationGroup,
): CoverageRequirement {
  const base = { day, startTime, endTime, targetCount, priority, group };

  if (roles && roles.length > 0) {
    // Role-based (with optional skills)
    return skills && skills.length > 0 ? { ...base, roles, skills } : { ...base, roles };
  } else if (skills && skills.length > 0) {
    // Skill-only
    return { ...base, skills };
  }

  // This shouldn't happen if input types are correct, but handle gracefully
  throw new Error(
    `Coverage requirement for day "${day}" must have at least one of roles or skills`,
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
        const autoGroup = generateConcreteGroup(req);
        result.push(
          buildCoverageRequirement(
            req.day,
            req.startTime,
            req.endTime,
            req.roles,
            req.skills,
            req.targetCount,
            req.priority ?? "MANDATORY",
            req.group ?? autoGroup,
          ),
        );
      }
    } else if (isVariantCoverage(req)) {
      // Variant coverage - resolve most-specific variant per day
      const entry = defs[req.semanticTime];
      if (!entry) {
        throw new Error(`Unknown semantic time: ${req.semanticTime}`);
      }

      const autoGroup = generateVariantGroup(req);

      for (const day of days) {
        const resolved = resolveTimeForDay(entry, day);
        if (!resolved) continue;

        const variant = resolveVariantForDay(req.variants, day);
        if (!variant) continue;

        result.push(
          buildCoverageRequirement(
            day,
            resolved.startTime,
            resolved.endTime,
            req.roles,
            req.skills,
            variant.count,
            variant.priority ?? "MANDATORY",
            req.group ?? autoGroup,
          ),
        );
      }
    } else {
      // Simple semantic requirement - resolve for each applicable day
      const entry = defs[req.semanticTime];
      if (!entry) {
        throw new Error(`Unknown semantic time: ${req.semanticTime}`);
      }

      const autoGroup = generateSemanticGroup(req);
      const applicableDays = filterDays(days, req.dayOfWeek, req.dates);

      for (const day of applicableDays) {
        const resolved = resolveTimeForDay(entry, day);
        if (resolved) {
          result.push(
            buildCoverageRequirement(
              day,
              resolved.startTime,
              resolved.endTime,
              req.roles,
              req.skills,
              req.targetCount,
              req.priority ?? "MANDATORY",
              req.group ?? autoGroup,
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
function generateSemanticGroup<S extends string>(
  req: SemanticCoverageRequirement<S>,
): ValidationGroup {
  const roleOrSkills = req.roles?.join("/") ?? req.skills?.join("+") ?? "staff";
  const base = `${req.targetCount}x ${roleOrSkills} during ${req.semanticTime}`;

  if (req.dayOfWeek && req.dayOfWeek.length > 0 && req.dayOfWeek.length < 7) {
    return validationGroup(`${base} (${formatDaysScope(req.dayOfWeek)})`);
  }
  if (req.dates && req.dates.length > 0) {
    return validationGroup(`${base} (specific dates)`);
  }

  return validationGroup(base);
}

/**
 * Generates a human-readable group key for a variant coverage requirement.
 * Format: "{role/skills} during {semanticTime}" — shared across all days since
 * the count varies per variant.
 */
function generateVariantGroup<S extends string>(
  req: VariantCoverageRequirement<S>,
): ValidationGroup {
  const roleOrSkills = req.roles?.join("/") ?? req.skills?.join("+") ?? "staff";
  return validationGroup(`${roleOrSkills} during ${req.semanticTime}`);
}

/**
 * Resolve the most specific variant for a given day.
 *
 * Precedence: `dates` > `dayOfWeek` > default (unscoped).
 * Returns null if no variant matches the day.
 */
function resolveVariantForDay(
  variants: readonly CoverageVariant[],
  day: string,
): CoverageVariant | null {
  const date = parseDayString(day);
  const dayOfWeek = toDayOfWeekUTC(date);

  let dateMatch: CoverageVariant | null = null;
  let dowMatch: CoverageVariant | null = null;
  let defaultMatch: CoverageVariant | null = null;

  for (const variant of variants) {
    if (variant.dates && variant.dates.includes(day)) {
      dateMatch = variant;
      break;
    }
    if (variant.dayOfWeek && variant.dayOfWeek.includes(dayOfWeek)) {
      dowMatch = variant;
    }
    if (!variant.dates && !variant.dayOfWeek) {
      defaultMatch = variant;
    }
  }

  return dateMatch ?? dowMatch ?? defaultMatch;
}

/**
 * Generates a human-readable group key for a concrete coverage requirement.
 * Format: "{count}x {role/skills} on {day} {time}"
 */
function generateConcreteGroup(req: ConcreteCoverageRequirement): ValidationGroup {
  const roleOrSkills = req.roles?.join("/") ?? req.skills?.join("+") ?? "staff";
  const timeRange = `${formatTime(req.startTime)}-${formatTime(req.endTime)}`;
  return validationGroup(`${req.targetCount}x ${roleOrSkills} on ${req.day} ${timeRange}`);
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
