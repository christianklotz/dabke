/**
 * Type-safe scoping for rule configurations.
 *
 * Uses the `?: never` pattern to enforce mutual exclusivity at compile time:
 * when one scope field is present, the others in the same dimension are typed
 * as `never`, making it a `tsc` error to provide them.
 *
 * Array scope fields use non-empty tuple types (`[T, ...T[]]`) so that
 * empty arrays are compile-time errors.
 *
 * Two dimensions of scoping:
 * - **Entity scope**: who the rule applies to (members, roles, or skills)
 * - **Time scope**: when the rule applies (date range, specific dates, day of week, or recurring)
 *
 * Each rule declares which scopes it supports via the `entityScope()`,
 * `timeScope()`, and `requiredTimeScope()` builder functions.
 *
 * @example
 * ```ts
 * // time-off: entity optional, time required
 * const TimeOffSchema = z.object({ priority: PrioritySchema })
 *   .and(entityScope(["members", "roles", "skills"]))
 *   .and(requiredTimeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));
 *
 * // max-hours-week: both optional
 * const MaxHoursWeekSchema = z.object({ hours: z.number(), priority: PrioritySchema })
 *   .and(entityScope(["members", "roles", "skills"]))
 *   .and(timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"]));
 *
 * // max-consecutive-days: only member scoping, no time
 * const MaxConsecutiveDaysSchema = z.object({ days: z.number(), priority: PrioritySchema })
 *   .and(entityScope(["members"]));
 * ```
 */

import * as z from "zod";
import { DayOfWeekSchema, type DayOfWeek } from "../../types.js";
import type { SchedulingMember } from "../types.js";
import { parseDayString } from "../utils.js";

// ============================================================================
// Priority
// ============================================================================

/**
 * Zod schema for rule priority with a default of `"MANDATORY"`.
 *
 * Rules that use priority should include this in their schema so the
 * default is co-located with the rule system, not injected externally.
 */
export const PrioritySchema = z
  .union([z.literal("LOW"), z.literal("MEDIUM"), z.literal("HIGH"), z.literal("MANDATORY")])
  .default("MANDATORY");

// ============================================================================
// Scope Keys
// ============================================================================

export type EntityKey = "members" | "roles" | "skills";
export type TimeKey = "dateRange" | "specificDates" | "dayOfWeek" | "recurring";

// ============================================================================
// Active / Inactive Field Maps
// ============================================================================

/**
 * The field shape when an entity scope variant is active (selected).
 * Each variant adds a single field with a non-empty array.
 */
type ActiveEntityFields = {
  members: { memberIds: NonEmptyArray<string> };
  roles: { roleIds: NonEmptyArray<string> };
  skills: { skillIds: NonEmptyArray<string> };
};

/**
 * The field shape when an entity scope variant is inactive (not selected).
 * The field is typed as `?: never` so it cannot be provided.
 */
type InactiveEntityFields = {
  members: { memberIds?: never };
  roles: { roleIds?: never };
  skills: { skillIds?: never };
};

type NonEmptyArray<T> = [T, ...T[]];

/** Recurring calendar period for time scoping. */
export interface RecurringPeriod {
  name: string;
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
}

/**
 * The field shape when a time scope variant is active (selected).
 */
type ActiveTimeFields = {
  dateRange: { dateRange: { start: string; end: string } };
  specificDates: { specificDates: NonEmptyArray<string> };
  dayOfWeek: { dayOfWeek: NonEmptyArray<DayOfWeek> };
  recurring: { recurringPeriods: NonEmptyArray<RecurringPeriod> };
};

/**
 * The field shape when a time scope variant is inactive (not selected).
 */
type InactiveTimeFields = {
  dateRange: { dateRange?: never };
  specificDates: { specificDates?: never };
  dayOfWeek: { dayOfWeek?: never };
  recurring: { recurringPeriods?: never };
};

// ============================================================================
// Exclusive Union Utility Types
// ============================================================================

/**
 * Merges all values of an object type into an intersection.
 *
 * @example
 * MergeValues<{ a: { x: 1 }; b: { y: 2 } }> = { x: 1 } & { y: 2 }
 */
type MergeValues<T> = { [K in keyof T]: (x: T[K]) => void } extends {
  [K in keyof T]: (x: infer U) => void;
}
  ? U
  : never;

/**
 * Exactly one of the specified keys must be present.
 * The active key's field is required; all others are `?: never`.
 *
 * @example
 * ExclusiveOne<ActiveEntityFields, InactiveEntityFields, "members" | "roles">
 * =
 *   | { memberIds: [string, ...string[]]; roleIds?: never }
 *   | { roleIds: [string, ...string[]]; memberIds?: never }
 */
export type ExclusiveOne<
  Active extends Record<string, object>,
  Inactive extends Record<string, object>,
  Keys extends keyof Active & keyof Inactive,
> = {
  [K in Keys]: Active[K] & MergeValues<Pick<Inactive, Exclude<Keys, K>>>;
}[Keys];

/**
 * At most one of the specified keys may be present (or none).
 * Same as {@link ExclusiveOne} plus the case where all fields are `?: never`.
 */
export type MaybeOne<
  Active extends Record<string, object>,
  Inactive extends Record<string, object>,
  Keys extends keyof Active & keyof Inactive,
> = ExclusiveOne<Active, Inactive, Keys> | MergeValues<Pick<Inactive, Keys>>;

// ============================================================================
// Convenience Aliases
// ============================================================================

/** Entity scope type for a subset of entity keys (at most one). */
export type EntityScopeType<K extends EntityKey> = MaybeOne<
  ActiveEntityFields,
  InactiveEntityFields,
  K
>;

/** Time scope type for a subset of time keys (at most one, optional). */
export type OptionalTimeScopeType<K extends TimeKey> = MaybeOne<
  ActiveTimeFields,
  InactiveTimeFields,
  K
>;

/** Time scope type for a subset of time keys (exactly one, required). */
export type RequiredTimeScopeType<K extends TimeKey> = ExclusiveOne<
  ActiveTimeFields,
  InactiveTimeFields,
  K
>;

// ============================================================================
// Zod Schemas for Individual Fields
// ============================================================================

const recurringPeriodSchema = z.object({
  name: z.string(),
  startMonth: z.number(),
  startDay: z.number(),
  endMonth: z.number(),
  endDay: z.number(),
});

const entityFieldSchemas = {
  members: { memberIds: z.array(z.string()).nonempty() },
  roles: { roleIds: z.array(z.string()).nonempty() },
  skills: { skillIds: z.array(z.string()).nonempty() },
} as const;

const timeFieldSchemas = {
  dateRange: {
    dateRange: z.object({
      start: z.iso.date(),
      end: z.iso.date(),
    }),
  },
  specificDates: { specificDates: z.array(z.iso.date()).nonempty() },
  dayOfWeek: { dayOfWeek: z.array(DayOfWeekSchema).nonempty() },
  recurring: { recurringPeriods: z.array(recurringPeriodSchema).nonempty() },
} as const;

/** Maps entity keys to their field names. */
const entityFieldNames = {
  members: "memberIds",
  roles: "roleIds",
  skills: "skillIds",
} as const;

type EntityFieldName = (typeof entityFieldNames)[EntityKey];

/** Maps time keys to their field names. */
const timeFieldNames = {
  dateRange: "dateRange",
  specificDates: "specificDates",
  dayOfWeek: "dayOfWeek",
  recurring: "recurringPeriods",
} as const;

type TimeFieldName = (typeof timeFieldNames)[TimeKey];

// ============================================================================
// Scope Builder Functions
// ============================================================================

/**
 * Creates a Zod schema for optional entity scoping (at most one of the
 * specified entity variants).
 *
 * The returned schema accepts flat fields (`memberIds`, `roleIds`, `skillIds`)
 * but the TypeScript type enforces mutual exclusivity via `?: never`.
 *
 * @param keys - Which entity scope variants to support
 *
 * @example
 * ```ts
 * // Supports all entity scopes
 * entityScope(["members", "roles", "skills"])
 *
 * // Only member scoping
 * entityScope(["members"])
 * ```
 */
export function entityScope<const K extends readonly EntityKey[]>(
  keys: K,
): z.ZodType<EntityScopeType<K[number]>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const key of keys) {
    for (const [fieldName, fieldSchema] of Object.entries(entityFieldSchemas[key])) {
      shape[fieldName] = (fieldSchema as z.ZodTypeAny).optional();
    }
  }

  const schema = z.object(shape).check((payload) => {
    const values = payload.value as Record<EntityFieldName, unknown>;
    const activeFields = keys.filter((key) => {
      const fieldName = entityFieldNames[key];
      const value = values[fieldName];
      return Array.isArray(value) && value.length > 0;
    });
    if (activeFields.length > 1) {
      const fieldNamesList = keys.map((k) => entityFieldNames[k]).join("/");
      payload.issues.push({
        code: "custom",
        message: `Only one of ${fieldNamesList} is allowed`,
        input: payload.value,
      });
    }
  });

  return schema as unknown as z.ZodType<EntityScopeType<K[number]>>;
}

/**
 * Creates a Zod schema for optional time scoping (at most one of the
 * specified time variants, or none).
 *
 * @param keys - Which time scope variants to support
 *
 * @example
 * ```ts
 * // Supports all time scopes, all optional
 * timeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"])
 * ```
 */
export function timeScope<const K extends readonly TimeKey[]>(
  keys: K,
): z.ZodType<OptionalTimeScopeType<K[number]>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const key of keys) {
    for (const [fieldName, fieldSchema] of Object.entries(timeFieldSchemas[key])) {
      shape[fieldName] = (fieldSchema as z.ZodTypeAny).optional();
    }
  }

  const schema = z.object(shape).check((payload) => {
    const values = payload.value as Record<TimeFieldName, unknown>;
    const activeFields = keys.filter((key) => {
      const fieldName = timeFieldNames[key];
      const value = values[fieldName];
      if (!value) return false;
      if (fieldName === "dateRange") return true;
      return Array.isArray(value) && value.length > 0;
    });
    if (activeFields.length > 1) {
      const fieldNamesList = keys.map((k) => timeFieldNames[k]).join("/");
      payload.issues.push({
        code: "custom",
        message: `Only one of ${fieldNamesList} is allowed`,
        input: payload.value,
      });
    }
  });

  return schema as unknown as z.ZodType<OptionalTimeScopeType<K[number]>>;
}

/**
 * Creates a Zod schema for required time scoping (exactly one of the
 * specified time variants must be present).
 *
 * @param keys - Which time scope variants to support
 *
 * @example
 * ```ts
 * // Exactly one time scope required (for time-off)
 * requiredTimeScope(["dateRange", "specificDates", "dayOfWeek", "recurring"])
 * ```
 */
export function requiredTimeScope<const K extends readonly TimeKey[]>(
  keys: K,
): z.ZodType<RequiredTimeScopeType<K[number]>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const key of keys) {
    for (const [fieldName, fieldSchema] of Object.entries(timeFieldSchemas[key])) {
      shape[fieldName] = (fieldSchema as z.ZodTypeAny).optional();
    }
  }

  const schema = z.object(shape).check((payload) => {
    const values = payload.value as Record<TimeFieldName, unknown>;
    const activeFields = keys.filter((key) => {
      const fieldName = timeFieldNames[key];
      const value = values[fieldName];
      if (!value) return false;
      if (fieldName === "dateRange") return true;
      return Array.isArray(value) && value.length > 0;
    });
    if (activeFields.length === 0) {
      const fieldNamesList = keys.map((k) => timeFieldNames[k]).join(", ");
      payload.issues.push({
        code: "custom",
        message: `Must provide time scoping (${fieldNamesList})`,
        input: payload.value,
      });
    }
    if (activeFields.length > 1) {
      const fieldNamesList = keys.map((k) => timeFieldNames[k]).join("/");
      payload.issues.push({
        code: "custom",
        message: `Only one of ${fieldNamesList} is allowed`,
        input: payload.value,
      });
    }
  });

  return schema as unknown as z.ZodType<RequiredTimeScopeType<K[number]>>;
}

// ============================================================================
// Scope Resolution (Shared)
// ============================================================================

/**
 * Parsed entity scope from a flat config.
 * Used internally by scope resolution functions.
 */
export type ParsedEntityScope =
  | { type: "global" }
  | { type: "members"; memberIds: string[] }
  | { type: "roles"; roleIds: string[] }
  | { type: "skills"; skillIds: string[] };

/**
 * Parsed time scope from a flat config.
 * Used internally by scope resolution functions.
 */
export type ParsedTimeScope =
  | { type: "none" }
  | { type: "dateRange"; start: string; end: string }
  | { type: "specificDates"; dates: string[] }
  | { type: "dayOfWeek"; days: DayOfWeek[] }
  | { type: "recurring"; periods: RecurringPeriod[] };

/** Input shape accepted by {@link parseEntityScope}. */
export interface EntityScopeInput {
  memberIds?: string[];
  roleIds?: string[];
  skillIds?: string[];
  [key: string]: unknown;
}

/** Input shape accepted by {@link parseTimeScope}. */
export interface TimeScopeInput {
  dateRange?: { start: string; end: string };
  specificDates?: string[];
  dayOfWeek?: DayOfWeek[];
  recurringPeriods?: RecurringPeriod[];
  [key: string]: unknown;
}

/**
 * Extracts the entity scope from a parsed flat config.
 */
export function parseEntityScope(config: EntityScopeInput): ParsedEntityScope {
  if (config.memberIds && config.memberIds.length > 0) {
    return { type: "members", memberIds: config.memberIds };
  }
  if (config.roleIds && config.roleIds.length > 0) {
    return { type: "roles", roleIds: config.roleIds };
  }
  if (config.skillIds && config.skillIds.length > 0) {
    return { type: "skills", skillIds: config.skillIds };
  }
  return { type: "global" };
}

/**
 * Extracts the time scope from a parsed flat config.
 */
export function parseTimeScope(config: TimeScopeInput): ParsedTimeScope {
  if (config.dateRange) {
    return { type: "dateRange", start: config.dateRange.start, end: config.dateRange.end };
  }
  if (config.specificDates && config.specificDates.length > 0) {
    return { type: "specificDates", dates: config.specificDates };
  }
  if (config.dayOfWeek && config.dayOfWeek.length > 0) {
    return { type: "dayOfWeek", days: config.dayOfWeek };
  }
  if (config.recurringPeriods && config.recurringPeriods.length > 0) {
    return { type: "recurring", periods: config.recurringPeriods };
  }
  return { type: "none" };
}

/**
 * Resolves which members a rule applies to based on entity scope.
 */
export function resolveMembersFromScope(
  scope: ParsedEntityScope,
  members: SchedulingMember[],
): SchedulingMember[] {
  switch (scope.type) {
    case "members": {
      const idSet = new Set(scope.memberIds);
      return members.filter((e) => idSet.has(e.id));
    }
    case "roles":
      return members.filter((e) => e.roles.some((r) => scope.roleIds.includes(r)));
    case "skills":
      return members.filter((e) => e.skills?.some((s) => scope.skillIds.includes(s)));
    case "global":
    default:
      return members;
  }
}

/**
 * Resolves which days a rule applies to based on time scope.
 */
export function resolveActiveDaysFromScope(scope: ParsedTimeScope, allDays: string[]): string[] {
  switch (scope.type) {
    case "none":
      return allDays;
    case "dateRange":
      return allDays.filter((day) => day >= scope.start && day <= scope.end);
    case "specificDates":
      return allDays.filter((day) => scope.dates.includes(day));
    case "dayOfWeek": {
      const targetDays = new Set(scope.days);
      return allDays.filter((day) => {
        const date = parseDayString(day);
        const dayName = getDayOfWeekName(date.getUTCDay());
        return targetDays.has(dayName);
      });
    }
    case "recurring":
      return allDays.filter((day) => {
        const date = parseDayString(day);
        const month = date.getUTCMonth() + 1;
        const dayOfMonth = date.getUTCDate();
        return scope.periods.some((period) => isDateInRecurringPeriod(month, dayOfMonth, period));
      });
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

type DayName = "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";

function getDayOfWeekName(dayIndex: number): DayName {
  const names: Record<number, DayName> = {
    0: "sunday",
    1: "monday",
    2: "tuesday",
    3: "wednesday",
    4: "thursday",
    5: "friday",
    6: "saturday",
  };
  return names[dayIndex % 7] ?? "sunday";
}

function isDateInRecurringPeriod(
  month: number,
  dayOfMonth: number,
  period: RecurringPeriod,
): boolean {
  const { startMonth, startDay, endMonth, endDay } = period;

  if (startMonth <= endMonth) {
    if (month < startMonth || month > endMonth) return false;
    if (month === startMonth && dayOfMonth < startDay) return false;
    if (month === endMonth && dayOfMonth > endDay) return false;
    return true;
  } else {
    if (month > endMonth && month < startMonth) return false;
    if (month === startMonth && dayOfMonth < startDay) return false;
    if (month === endMonth && dayOfMonth > endDay) return false;
    return true;
  }
}

/**
 * Formats a parsed entity scope as a human-readable suffix for descriptions.
 * Returns an empty string for global scope.
 *
 * @example
 * ```ts
 * formatEntityScope({ type: "roles", roleIds: ["nurse"] })  // " for nurse"
 * formatEntityScope({ type: "members", memberIds: ["alice", "bob"] })  // " for alice, bob"
 * formatEntityScope({ type: "global" })  // ""
 * ```
 */
export function formatEntityScope(scope: ParsedEntityScope): string {
  switch (scope.type) {
    case "global":
      return "";
    case "members":
      return ` for ${scope.memberIds.join(", ")}`;
    case "roles":
      return ` for ${scope.roleIds.join(", ")}`;
    case "skills":
      return ` for ${scope.skillIds.join(", ")}`;
  }
}

/**
 * Formats a parsed time scope as a human-readable suffix for descriptions.
 * Returns an empty string for unscoped rules.
 *
 * @example
 * ```ts
 * formatTimeScope({ type: "dayOfWeek", days: ["monday", "friday"] })  // " on mon, fri"
 * formatTimeScope({ type: "dateRange", start: "2026-03-01", end: "2026-03-15" })  // " during 2026-03-01..2026-03-15"
 * formatTimeScope({ type: "none" })  // ""
 * ```
 */
export function formatTimeScope(scope: ParsedTimeScope): string {
  switch (scope.type) {
    case "none":
      return "";
    case "dateRange":
      return ` during ${scope.start}..${scope.end}`;
    case "specificDates":
      return scope.dates.length <= 3
        ? ` on ${scope.dates.join(", ")}`
        : ` on ${scope.dates.length} dates`;
    case "dayOfWeek":
      return ` on ${formatDayOfWeek(scope.days)}`;
    case "recurring":
      return ` during ${scope.periods.map((p) => p.name).join(", ")}`;
  }
}

function formatDayOfWeek(days: DayOfWeek[]): string {
  const weekdays: DayOfWeek[] = ["monday", "tuesday", "wednesday", "thursday", "friday"];
  const weekend: DayOfWeek[] = ["saturday", "sunday"];

  if (days.length === 5 && weekdays.every((d) => days.includes(d))) return "weekdays";
  if (days.length === 2 && weekend.every((d) => days.includes(d))) return "weekends";
  return days.map((d) => d.slice(0, 3)).join(", ");
}
