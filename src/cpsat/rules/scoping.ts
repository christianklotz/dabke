import * as z from "zod";
import type { DayOfWeek } from "../../types.js";
import type { SchedulingEmployee } from "../types.js";

export type EntityScope =
  | { type: "global" }
  | { type: "employees"; employeeIds: string[] }
  | { type: "roles"; roleIds: string[] }
  | { type: "skills"; skillIds: string[] };

export type TimeScope =
  | { type: "always" }
  | { type: "dateRange"; start: string; end: string }
  | { type: "specificDates"; dates: string[] }
  | { type: "dayOfWeek"; days: DayOfWeek[] }
  | {
      type: "recurring";
      periods: {
        name: string;
        startMonth: number;
        startDay: number;
        endMonth: number;
        endDay: number;
      }[];
    };

export interface RuleScope {
  entity: EntityScope;
  time?: TimeScope;
}

/**
 * Fields for scoping a rule to specific people and time periods.
 *
 * Entity scoping narrows which people a rule applies to.
 * Only one entity scope is allowed per rule (mutually exclusive).
 *
 * Time scoping narrows which dates within the schedule the rule covers.
 * Only one time scope is allowed per rule (mutually exclusive).
 *
 * When no scope is specified, the rule applies globally to all people
 * and all dates in the schedule.
 */
export interface ScopeConfig {
  /** Restrict to specific employees by ID. */
  employeeIds?: string[];
  /** Restrict to employees with any of these roles. */
  roleIds?: string[];
  /** Restrict to employees with any of these skills. */
  skillIds?: string[];
  /** Restrict to a contiguous date range (ISO 8601 date strings). */
  dateRange?: { start: string; end: string };
  /** Restrict to specific dates (ISO 8601 date strings). */
  specificDates?: string[];
  /** Restrict to specific days of the week. */
  dayOfWeek?: DayOfWeek[];
  /** Restrict to recurring calendar periods (e.g. semesters, seasons). */
  recurringPeriods?: {
    name: string;
    startMonth: number;
    startDay: number;
    endMonth: number;
    endDay: number;
  }[];
}

type SupportedEntities = ReadonlyArray<EntityKey>;
type SupportedTimes = ReadonlyArray<TimeKey>;

const dayOfWeekSchema = z.union([
  z.literal("monday"),
  z.literal("tuesday"),
  z.literal("wednesday"),
  z.literal("thursday"),
  z.literal("friday"),
  z.literal("saturday"),
  z.literal("sunday"),
]);

type EntityKey = "employees" | "roles" | "skills";
type TimeKey = "dateRange" | "specificDates" | "dayOfWeek" | "recurring";

type EntityScopeShape<T extends readonly EntityKey[]> = ("employees" extends T[number]
  ? { employeeIds: z.ZodOptional<z.ZodArray<z.ZodString>> }
  : {}) &
  ("roles" extends T[number] ? { roleIds: z.ZodOptional<z.ZodArray<z.ZodString>> } : {}) &
  ("skills" extends T[number] ? { skillIds: z.ZodOptional<z.ZodArray<z.ZodString>> } : {});

type TimeScopeShape<T extends readonly TimeKey[]> = ("dateRange" extends T[number]
  ? {
      dateRange: z.ZodOptional<
        z.ZodObject<{
          start: z.ZodString;
          end: z.ZodString;
        }>
      >;
    }
  : {}) &
  ("specificDates" extends T[number]
    ? { specificDates: z.ZodOptional<z.ZodArray<z.ZodString>> }
    : {}) &
  ("dayOfWeek" extends T[number]
    ? { dayOfWeek: z.ZodOptional<z.ZodArray<typeof dayOfWeekSchema>> }
    : {}) &
  ("recurring" extends T[number]
    ? {
        recurringPeriods: z.ZodOptional<
          z.ZodArray<
            z.ZodObject<{
              name: z.ZodString;
              startMonth: z.ZodNumber;
              startDay: z.ZodNumber;
              endMonth: z.ZodNumber;
              endDay: z.ZodNumber;
            }>
          >
        >;
      }
    : {});

const timeScopeSchema = <T extends readonly TimeKey[]>(supported: T) =>
  ({
    ...(supported.includes("dateRange")
      ? {
          dateRange: z
            .object({
              start: z.iso.date(),
              end: z.iso.date(),
            })
            .optional(),
        }
      : {}),
    ...(supported.includes("specificDates")
      ? { specificDates: z.array(z.iso.date()).optional() }
      : {}),
    ...(supported.includes("dayOfWeek") ? { dayOfWeek: z.array(dayOfWeekSchema).optional() } : {}),
    ...(supported.includes("recurring")
      ? {
          recurringPeriods: z
            .array(
              z.object({
                name: z.string(),
                startMonth: z.number(),
                startDay: z.number(),
                endMonth: z.number(),
                endDay: z.number(),
              }),
            )
            .optional(),
        }
      : {}),
  }) as TimeScopeShape<T>;

const entityScopeSchema = <T extends readonly EntityKey[]>(supported: T) =>
  ({
    ...(supported.includes("employees") ? { employeeIds: z.array(z.string()).optional() } : {}),
    ...(supported.includes("roles") ? { roleIds: z.array(z.string()).optional() } : {}),
    ...(supported.includes("skills") ? { skillIds: z.array(z.string()).optional() } : {}),
  }) as EntityScopeShape<T>;

type ScopedShape<
  T extends z.ZodRawShape,
  TEntities extends readonly EntityKey[],
  TTimes extends readonly TimeKey[],
> = T & EntityScopeShape<TEntities> & TimeScopeShape<TTimes>;
type ScopedSchema<
  T extends z.ZodRawShape,
  TEntities extends readonly EntityKey[],
  TTimes extends readonly TimeKey[],
> = z.ZodObject<ScopedShape<T, TEntities, TTimes>>;
type ScopedSchemaWithRefinement<
  T extends z.ZodRawShape,
  TEntities extends readonly EntityKey[],
  TTimes extends readonly TimeKey[],
> = ReturnType<ScopedSchema<T, TEntities, TTimes>["superRefine"]>;

export const withScopes = <
  T extends z.ZodRawShape,
  TEntities extends SupportedEntities,
  TTimes extends SupportedTimes,
>(
  base: z.ZodObject<T>,
  opts: { entities: TEntities; times: TTimes },
): ScopedSchemaWithRefinement<T, TEntities, TTimes> => {
  const entityFields = entityScopeSchema(opts.entities);
  const timeFields = timeScopeSchema(opts.times);

  const extended = base.extend({
    ...entityFields,
    ...timeFields,
  }) as ScopedSchema<T, TEntities, TTimes>;

  type ExtendedOutput = z.output<typeof extended>;

  const refined = extended.superRefine((val: ExtendedOutput, ctx) => {
    const entityKeys = ["employeeIds", "roleIds", "skillIds"] as const;
    const activeEntities = entityKeys.filter((key) => {
      const value = (val as Record<(typeof entityKeys)[number], unknown>)[key];
      return Array.isArray(value) && value.length > 0;
    });
    if (activeEntities.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only one of employeeIds/roleIds/skillIds is allowed",
      });
    }

    const timeKeys = ["dateRange", "specificDates", "dayOfWeek", "recurringPeriods"] as const;
    const activeTimes = timeKeys.filter((key) => {
      const value = (val as Record<(typeof timeKeys)[number], unknown>)[key];
      if (!value) return false;
      if (key === "dateRange") return true;
      return Array.isArray(value) && value.length > 0;
    });
    if (activeTimes.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only one of dateRange/specificDates/dayOfWeek/recurringPeriods is allowed",
      });
    }
  });

  return refined;
};

export const normalizeScope = (
  raw: {
    employeeIds?: string[];
    roleIds?: string[];
    skillIds?: string[];
    dateRange?: { start: string; end: string };
    specificDates?: string[];
    dayOfWeek?: DayOfWeek[];
    recurringPeriods?: {
      name: string;
      startMonth: number;
      startDay: number;
      endMonth: number;
      endDay: number;
    }[];
  },
  employees: SchedulingEmployee[],
): RuleScope => {
  const employeeSet = new Set(employees.map((e) => e.id));

  // Check if scopes were explicitly provided (even if empty arrays)
  const hasExplicitEmployeeIds = raw.employeeIds !== undefined && raw.employeeIds.length > 0;
  const hasExplicitRoleIds = raw.roleIds !== undefined && raw.roleIds.length > 0;
  const hasExplicitSkillIds = raw.skillIds !== undefined && raw.skillIds.length > 0;

  const roleIds = raw.roleIds ?? [];
  const skillIds = raw.skillIds ?? [];

  // Filter employee IDs to only those that exist
  const filteredEmployees = hasExplicitEmployeeIds
    ? raw.employeeIds!.filter((id) => employeeSet.has(id))
    : [];

  let entity: EntityScope;
  if (hasExplicitEmployeeIds) {
    // If employeeIds was explicitly provided, preserve that scope type
    // even if all IDs were filtered out (matched no employees).
    // This prevents a rule intended for specific employees from
    // accidentally becoming a global rule affecting everyone.
    entity = { type: "employees", employeeIds: filteredEmployees };
  } else if (hasExplicitRoleIds) {
    entity = { type: "roles", roleIds };
  } else if (hasExplicitSkillIds) {
    entity = { type: "skills", skillIds };
  } else {
    entity = { type: "global" };
  }

  let time: TimeScope | undefined;
  if (raw.dateRange) {
    time = {
      type: "dateRange",
      start: raw.dateRange.start,
      end: raw.dateRange.end,
    };
  } else if (raw.specificDates && raw.specificDates.length > 0) {
    time = { type: "specificDates", dates: raw.specificDates };
  } else if (raw.dayOfWeek && raw.dayOfWeek.length > 0) {
    time = { type: "dayOfWeek", days: raw.dayOfWeek };
  } else if (raw.recurringPeriods && raw.recurringPeriods.length > 0) {
    time = { type: "recurring", periods: raw.recurringPeriods };
  }

  return { entity, ...(time ? { time } : {}) };
};

export const specificity = (scope: EntityScope): number => {
  switch (scope.type) {
    case "employees":
      return 4;
    case "roles":
      return 3;
    case "skills":
      return 2;
    case "global":
    default:
      return 1;
  }
};

export const effectiveEmployeeIds = (
  scope: EntityScope,
  employees: SchedulingEmployee[],
): string[] => {
  const ids = employees.map((e) => e.id);
  const idSet = new Set(ids);

  switch (scope.type) {
    case "employees":
      return scope.employeeIds.filter((id) => idSet.has(id));
    default:
      return ids;
  }
};

export const subtractIds = (ids: string[], assigned: Set<string>): string[] =>
  ids.filter((id) => !assigned.has(id));

/**
 * Creates a stable key for a time scope to use in grouping.
 * Rules with different time scope keys don't compete for deduplication.
 */
export const timeScopeKey = (time: TimeScope | undefined): string => {
  if (!time) return "always";
  switch (time.type) {
    case "always":
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
};

/**
 * Creates a stable key for an entity scope type.
 * Used to prevent merging different scope types during resolution.
 */
export const entityScopeTypeKey = (entity: EntityScope): string => {
  switch (entity.type) {
    case "employees":
      return "employees";
    case "roles":
      return `roles:${entity.roleIds.toSorted().join(",")}`;
    case "skills":
      return `skills:${entity.skillIds.toSorted().join(",")}`;
    case "global":
      return "global";
  }
};
