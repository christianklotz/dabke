/**
 * Scheduling rules: constraints, preferences, and time-off.
 *
 * Rules answer "what schedules are allowed or preferred?". Use
 * {@link cover} for lower-bound demand, then use rules for caps, limits, rest
 * periods, time off, fairness, and other constraints on assignments.
 *
 * @example
 * ```typescript
 * rules: [
 *   // Hour and day limits
 *   maxHoursPerDay(10),
 *   maxHoursPerWeek(48),
 *   maxHoursPerWeek(20, { appliesTo: "part-time" }),
 *   maxDaysPerWeek(5, { priority: "HIGH" }),
 *   targetDaysPerWeek(4, { appliesTo: "full-time", priority: "HIGH" }),
 *   minDaysPerWeek(4, { appliesTo: "full-time", priority: "HIGH" }),
 *   maxShiftsPerDay(1),
 *   maxConcurrentAssignments(5, { appliesTo: "chair_stylist" }),
 *   targetPeakConcurrentAssignments(5, { appliesTo: "chair_stylist", dayOfWeek: ["thursday"], priority: "HIGH" }),
 *   minRestBetweenShifts(11),
 *
 *   // Staffing obligations and preferences
 *   mustAssign({ appliesTo: ["diana", "yavuz"] }),
 *   timeOff({ appliesTo: "alice", dateRange: { start: "2024-02-01", end: "2024-02-05" } }),
 *   timeOff({ appliesTo: "student", dayOfWeek: ["wednesday"], from: t(14) }),
 *   preferAssignment({ appliesTo: "waiter" }),
 *   avoidAssignment({ appliesTo: "student", dayOfWeek: weekdays }),
 *   assignTogether(["alice", "bob"]),
 * ]
 * ```
 *
 * Custom rules can stay type-safe too:
 *
 * ```typescript
 * const debugRuleRegistry = createCpsatRuleRegistry({
 *   debug: defineRuleDescriptor({
 *     name: "debug",
 *     schema: z.object({ flag: z.boolean() }),
 *     compile() {
 *       return { rule: "debug", artifacts: [] };
 *     },
 *   }),
 * });
 *
 * const defineDebugRule = defineRuleFor(debugRuleRegistry);
 *
 * schedule({
 *   roleIds: ["waiter"],
 *   times: { lunch: time({ startTime: t(12), endTime: t(15) }) },
 *   coverage: [cover("lunch", "waiter", 1)],
 *   shiftPatterns: [shift("lunch", t(12), t(15))],
 *   ruleRegistry: debugRuleRegistry,
 *   rules: [defineDebugRule("debug", { flag: true })],
 * });
 * ```
 *
 * @module
 */

import type { DayOfWeek, TimeOfDay } from "../types.js";
import type { Priority, SoftPriority } from "../cpsat/types.js";
import type {
  BuiltInCpsatRuleRegistry,
  CpsatRuleConfigEntryFor,
  CpsatRuleName,
  CpsatRuleRegistry,
} from "../cpsat/rules/rules.types.js";
import type { RecurringPeriod } from "../cpsat/rules/scope.types.js";

// ============================================================================
// Rule Options
// ============================================================================

/**
 * Scoping options shared by most rule functions.
 *
 * @remarks
 * Default priority is `MANDATORY`. Use `appliesTo` to scope to a
 * role, skill, or member ID. Use time scoping options (`dayOfWeek`,
 * `dateRange`, `dates`) to limit when the rule applies.
 * Scope answers where a rule is evaluated. It does not change the rule's core
 * meaning. For example, `maxDaysPerWeek(4, { dayOfWeek: ["monday"] })` is still
 * a day-cap concept, just scoped to matching scheduling days. Priority is just
 * as important as scope: scope decides where a rule applies, and priority decides how hard the solver should enforce it. Use
 * `"MANDATORY"` for requirements the schedule cannot violate, and softer
 * priorities for things the requirements describe as preferred, ideal, or
 * "where possible".
 * Not all rules support all scoping options. Entity-only rules
 * (e.g., {@link maxConsecutiveDays}) ignore time scoping.
 *
 * @category Rules
 */
export interface RuleOptions {
  /** Who this rule applies to (role name, skill name, or member ID). */
  appliesTo?: string | string[];
  /** Restrict to specific days of the week. */
  dayOfWeek?: readonly [DayOfWeek, ...DayOfWeek[]];
  /** Restrict to a date range. */
  dateRange?: { start: string; end: string };
  /** Restrict to specific dates (YYYY-MM-DD). */
  dates?: string[];
  /** Restrict to recurring calendar periods. */
  recurringPeriods?: [RecurringPeriod, ...RecurringPeriod[]];
  /** Defaults to `"MANDATORY"`. */
  priority?: Priority;
}

/**
 * Options for rules that support entity scoping only (no time scoping).
 *
 * @remarks
 * Used by rules whose semantics are inherently per-day or per-week
 * (e.g., {@link minHoursPerDay}, {@link maxConsecutiveDays}) and cannot
 * be meaningfully restricted to a date range or day of week. `priority`
 * still controls whether the rule is a hard requirement or a softer target.
 *
 * @category Rules
 */
export interface EntityOnlyRuleOptions {
  /** Who this rule applies to (role name, skill name, or member ID). */
  appliesTo?: string | string[];
  /** Defaults to `"MANDATORY"`. */
  priority?: Priority;
}

/**
 * Options for {@link timeOff}.
 *
 * @remarks
 * At least one time scoping field is required (`dayOfWeek`, `dateRange`,
 * `dates`, or `recurringPeriods`). Use `from`/`until` to block only part
 * of a day.
 *
 * @category Rules
 */
export interface TimeOffOptions {
  /** Who this rule applies to (role name, skill name, or member ID). */
  appliesTo?: string | string[];
  /** Off from this time until end of day. */
  from?: TimeOfDay;
  /** Off from start of day until this time. */
  until?: TimeOfDay;
  /** Restrict to specific days of the week. */
  dayOfWeek?: readonly [DayOfWeek, ...DayOfWeek[]];
  /** Restrict to a date range. */
  dateRange?: { start: string; end: string };
  /** Restrict to specific dates (YYYY-MM-DD). */
  dates?: string[];
  /** Restrict to recurring calendar periods. */
  recurringPeriods?: [RecurringPeriod, ...RecurringPeriod[]];
  /** Defaults to `"MANDATORY"`. */
  priority?: Priority;
}

/**
 * Options for {@link assignTogether}.
 *
 * @category Rules
 */
export interface AssignTogetherOptions {
  /** Defaults to `"MANDATORY"`. */
  priority?: Priority;
}

/**
 * Options for {@link maxConcurrentAssignments}.
 *
 * @remarks
 * Use this when the business has a hard productive cap that is independent from
 * its coverage floor, for example when only a fixed number of assignments can
 * overlap productively at once. Omit `startTime`/`endTime` to cap concurrent
 * assignments across the full day. Provide both together to limit concurrency
 * only within a specific time window.
 *
 * @category Rules
 */
export interface MaxConcurrentAssignmentsOptions extends RuleOptions {
  /** Optional start of the capped time window. */
  startTime?: TimeOfDay;
  /** Optional end of the capped time window. */
  endTime?: TimeOfDay;
}

/**
 * Options for {@link targetDaysPerWeek}.
 *
 * @remarks
 * Use this for stated weekly patterns like "works a 4-day week" when that
 * pattern should remain flexible. This is soft-only by design. Pair it with
 * {@link maxDaysPerWeek} when the same number is also a hard cap, and use
 * {@link minDaysPerWeek} only when the requirements explicitly require a minimum.
 *
 * @category Rules
 */
export interface TargetDaysPerWeekOptions extends Omit<EntityOnlyRuleOptions, "priority"> {
  /** Soft only. Defaults to `"HIGH"`. */
  priority?: SoftPriority;
}

/**
 * Options for {@link targetPeakConcurrentAssignments}.
 *
 * @remarks
 * Use this when the business wants to hit a peak concurrency target within a
 * day, without making that target a lower bound across the whole day. This is
 * soft-only by design. Unlike {@link cover}, this helper does not establish a
 * minimum that must hold throughout a semantic time. Instead it shifts the
 * solution toward reaching the desired peak within the scoped days. Use
 * {@link cover} for a whole-window minimum, and pair
 * this helper with
 * {@link maxConcurrentAssignments} when the same number is also a hard cap.
 * This is useful for language like "fill all 5 chairs on peak days" or
 * "ideally reach full capacity during the busy point".
 *
 * @category Rules
 */
export interface TargetPeakConcurrentAssignmentsOptions extends Omit<RuleOptions, "priority"> {
  /** Soft only. Defaults to `"HIGH"`. */
  priority?: SoftPriority;
}

// ============================================================================
// Rule Entry
// ============================================================================

/**
 * Context passed to a rule's resolve function during compilation.
 *
 * Contains the declared roles, skills, and member IDs so the resolver
 * can translate user-facing fields (like `appliesTo`) into internal
 * scoping fields.
 */
export interface RuleResolveContext {
  readonly roles: ReadonlySet<string>;
  readonly skills: ReadonlySet<string>;
  readonly memberIds: ReadonlySet<string>;
}

// Internal rule entry type
interface RuleEntryBase<Name extends string = string> {
  readonly _type: "rule";
  readonly _rule: Name;
  /**
   * Optional custom resolver. When present, `resolveRules()` calls this
   * instead of the default translation path. Built-in rules that need
   * special field mapping (e.g., `timeOff`, `assignTogether`) attach one;
   * all other rules use the default resolver.
   */
  readonly _resolve?: (ctx: RuleResolveContext) => Record<string, unknown> & { name: Name };
}

/**
 * A typed rule entry returned by rule helpers and {@link defineRule}.
 *
 * @remarks
 * Pass these directly into the `rules` array of {@link ScheduleConfig}. The
 * internal fields are resolved during compilation.
 *
 * @category Rules
 */
export type RuleEntry<
  Name extends string = string,
  Fields extends object = Record<string, unknown>,
> = RuleEntryBase<Name> & Fields & Record<string, unknown>;

type TypedRuleEntryFor<Registry extends CpsatRuleRegistry> = {
  [K in keyof Registry & string]: RuleEntry<
    K,
    Omit<CpsatRuleConfigEntryFor<Pick<Registry, K>>, "name">
  >;
}[keyof Registry & string];

/**
 * A rule entry accepted by {@link ScheduleConfig.rules}.
 *
 * @remarks
 * Built-in rule helpers return entries that are always valid. Custom rules created
 * via {@link defineRule} are checked against the active rule registry when passed
 * to {@link schedule} or {@link partialSchedule}. For registry-bound authoring,
 * prefer {@link defineRuleFor}.
 *
 * @category Rules
 */
export type ScheduleRuleEntry<TRuleRegistry extends CpsatRuleRegistry = BuiltInCpsatRuleRegistry> =
  TypedRuleEntryFor<TRuleRegistry>;

type SanitizedRuleFields<Fields extends object> = Omit<Fields, "_type" | "_rule">;
type BuiltInResolvedRuleConfig<Name extends CpsatRuleName> = CpsatRuleConfigEntryFor<
  Pick<BuiltInCpsatRuleRegistry, Name>
>;
type PeriodLength = { type: "weeks"; value: number } | { type: "months"; value: number };
type ResolvedEntityScope = {
  memberIds?: [string, ...string[]];
  roleIds?: [string, ...string[]];
  skillIds?: [string, ...string[]];
};
type ResolvedTimeOffRuleConfig = {
  name: "time-off";
  priority: Priority;
  dayOfWeek?: readonly [DayOfWeek, ...DayOfWeek[]];
  dateRange?: { start: string; end: string };
  specificDates?: string[];
  recurringPeriods?: [RecurringPeriod, ...RecurringPeriod[]];
  startTime?: TimeOfDay;
  endTime?: TimeOfDay;
} & ResolvedEntityScope;
type ResolvedDaysOfWeekPerPeriodRuleConfig<
  Name extends "max-days-of-week-per-period" | "min-days-of-week-per-period",
> = {
  name: Name;
  days: number;
  dayOfWeek: readonly [DayOfWeek, ...DayOfWeek[]];
  period: PeriodLength;
  priority: Priority;
} & ResolvedEntityScope;
type TimeOffRuleEntry = RuleEntry<"time-off", TimeOffOptions>;
type AssignTogetherRuleEntry = RuleEntry<
  "assign-together",
  { members: [string, string, ...string[]] } & AssignTogetherOptions
>;
type DaysOfWeekPerPeriodRuleFields = {
  days: number;
  dayOfWeek: readonly [DayOfWeek, ...DayOfWeek[]];
  period: PeriodLength;
  appliesTo?: string | string[];
  priority?: Priority;
};
type MaxDaysOfWeekPerPeriodRuleEntry = RuleEntry<
  "max-days-of-week-per-period",
  DaysOfWeekPerPeriodRuleFields
>;
type MinDaysOfWeekPerPeriodRuleEntry = RuleEntry<
  "min-days-of-week-per-period",
  DaysOfWeekPerPeriodRuleFields
>;
/**
 * Creates a rule entry for use in {@link ScheduleConfig.rules}.
 *
 * Built-in rules use the helpers (`maxHoursPerDay`, `timeOff`, etc.). Custom
 * rules can use `defineRule` to create entries that plug into the same
 * resolution and compilation pipeline.
 *
 * @remarks
 * The returned entry always preserves its rule name and fields. To validate custom
 * rules at the point of creation, use {@link defineRuleFor} to bind `defineRule`
 * to a specific registry.
 *
 * @param name - Rule name. Must match a key in the active rule registry.
 * @param fields - Rule-specific configuration fields.
 * @param resolve - Optional custom resolver. When omitted, the default
 *   resolution applies: `appliesTo` is mapped to `roleIds`/`skillIds`/`memberIds`,
 *   `dates` is renamed to `specificDates`, and all other fields pass through.
 */
export function defineRule<const Name extends string, const Fields extends object>(
  name: Name,
  fields: Fields,
  resolve?: (ctx: RuleResolveContext) => Record<string, unknown> & { name: Name },
): RuleEntry<Name, SanitizedRuleFields<Fields>>;
export function defineRule<const Name extends string, const Fields extends object>(
  name: Name,
  fields: Fields,
  resolve?: (ctx: RuleResolveContext) => Record<string, unknown> & { name: Name },
): RuleEntry<Name, SanitizedRuleFields<Fields>> {
  const safeFields = { ...fields } as SanitizedRuleFields<Fields> & {
    _type?: unknown;
    _rule?: unknown;
  };
  delete safeFields._type;
  delete safeFields._rule;

  const entry: RuleEntry<Name, SanitizedRuleFields<Fields>> = {
    _type: "rule",
    _rule: name,
    ...safeFields,
  };
  if (resolve) {
    Object.defineProperty(entry, "_resolve", { value: resolve, enumerable: false });
  }
  return entry;
}

/**
 * Creates a registry-bound `defineRule` helper.
 *
 * @remarks
 * Use this when authoring custom rules directly and you want immediate
 * compile-time validation of the rule name and config fields against a specific
 * rule registry.
 *
 * @category Rules
 */
export function defineRuleFor<TRuleRegistry extends CpsatRuleRegistry>(
  ruleRegistry: TRuleRegistry,
): <const Name extends keyof TRuleRegistry & string>(
  name: Name,
  fields: Omit<CpsatRuleConfigEntryFor<Pick<TRuleRegistry, Name>>, "name">,
  resolve?: (ctx: RuleResolveContext) => CpsatRuleConfigEntryFor<Pick<TRuleRegistry, Name>>,
) => RuleEntry<
  Name,
  SanitizedRuleFields<Omit<CpsatRuleConfigEntryFor<Pick<TRuleRegistry, Name>>, "name">>
> {
  void ruleRegistry;

  return (name, fields, resolve) => defineRule(name, fields, resolve);
}

function makeRule<const Name extends CpsatRuleName, const Fields extends object>(
  rule: Name,
  fields: Fields,
): RuleEntry<Name, SanitizedRuleFields<Fields>> {
  return defineRule(rule, fields);
}

// ============================================================================
// Constraint Rules
// ============================================================================

/**
 * Limits hours per day.
 *
 * @remarks
 * Use this when the requirements or operating constraints explicitly impose a
 * daily hours cap. Do not infer it just from the chosen shift pattern lengths.
 *
 * @category Rules
 */
export function maxHoursPerDay(
  hours: number,
  opts?: RuleOptions,
): RuleEntry<"max-hours-day", { hours: number } & RuleOptions> {
  return makeRule("max-hours-day", { hours, ...opts });
}

/**
 * Limits hours per scheduling week.
 *
 * @remarks
 * Use this when the requirements or operating constraints explicitly impose a
 * weekly hours cap. Do not infer it just from a stated working pattern such
 * as "4-day week" unless the requirements also make the hour limit explicit.
 *
 * @category Rules
 */
export function maxHoursPerWeek(
  hours: number,
  opts?: RuleOptions,
): RuleEntry<"max-hours-week", { hours: number } & RuleOptions> {
  return makeRule("max-hours-week", { hours, ...opts });
}

/**
 * Minimum hours when assigned on a day.
 *
 * @category Rules
 */
export function minHoursPerDay(
  hours: number,
  opts?: EntityOnlyRuleOptions,
): RuleEntry<"min-hours-day", { hours: number } & EntityOnlyRuleOptions> {
  return makeRule("min-hours-day", { hours, ...opts });
}

/**
 * Minimum hours per scheduling week.
 *
 * @category Rules
 */
export function minHoursPerWeek(
  hours: number,
  opts?: EntityOnlyRuleOptions,
): RuleEntry<"min-hours-week", { hours: number } & EntityOnlyRuleOptions> {
  return makeRule("min-hours-week", { hours, ...opts });
}

/**
 * Caps assigned days per scheduling week.
 *
 * @remarks
 * Use this when the requirements explicitly impose a weekly day cap. If the same
 * number is the normal weekly pattern rather than just a hard limit, pair it
 * with {@link targetDaysPerWeek}.
 *
 * @category Rules
 */
export function maxDaysPerWeek(
  days: number,
  opts?: RuleOptions,
): RuleEntry<"max-days-week", { days: number } & RuleOptions> {
  return makeRule("max-days-week", { days, ...opts });
}

/**
 * Enforces a minimum number of assigned days per scheduling week.
 *
 * @remarks
 * Use this when the requirements explicitly require a weekly minimum. Language like
 * "works a 4-day week" often implies a hard cap via {@link maxDaysPerWeek}
 * and possibly a softer target via {@link targetDaysPerWeek}, not a mandatory
 * weekly minimum for every member.
 *
 * @category Rules
 */
export function minDaysPerWeek(
  days: number,
  opts?: EntityOnlyRuleOptions,
): RuleEntry<"min-days-week", { days: number } & EntityOnlyRuleOptions> {
  return makeRule("min-days-week", { days, ...opts });
}

/**
 * Softly targets assigned days per scheduling week.
 *
 * @remarks
 * Use this for stated working patterns like "works a 4-day week" when the
 * pattern should remain the norm but can flex around holidays, time off, or
 * other tradeoffs. Deviations in either direction are penalized, so working
 * fewer days or more days than the target both count as misses. Pair it with
 * {@link maxDaysPerWeek} when the same number is also a hard cap, and use
 * {@link minDaysPerWeek} only when the requirements explicitly require a minimum.
 *
 * @param days - Target number of assigned days per scheduling week.
 * @param opts - Optional entity scope and soft priority.
 *
 * @category Rules
 */
export function targetDaysPerWeek(
  days: number,
  opts?: TargetDaysPerWeekOptions,
): RuleEntry<"target-days-week", { days: number } & TargetDaysPerWeekOptions> {
  return makeRule("target-days-week", { days, ...opts });
}

/**
 * Maximum distinct shifts per day.
 *
 * @category Rules
 */
export function maxShiftsPerDay(
  shifts: number,
  opts?: RuleOptions,
): RuleEntry<"max-shifts-day", { shifts: number } & RuleOptions> {
  return makeRule("max-shifts-day", { shifts, ...opts });
}

/**
 * Caps how many targeted assignments may overlap at the same time.
 *
 * @remarks
 * Use this for hard productive capacity limits that should stay separate from
 * the minimum staffing requirement expressed by {@link cover}. Pair a
 * lower-bound `cover(...)` with `maxConcurrentAssignments(...)` when the
 * business needs both demand and capacity modeled explicitly.
 *
 * On days with staggered opening and closing shifts, keep lower-bound coverage
 * scoped to the windows that truly need minimum staffing. Do not turn a total
 * daily headcount target into a whole-day lower-bound `cover(...)` unless the
 * business explicitly requires that many people in every overlapping bucket.
 *
 * Unlike {@link maxShiftsPerDay}, this limits simultaneous overlap, not total
 * assignments on a day.
 *
 * @param assignments - Maximum number of concurrent overlapping assignments.
 * @param opts - Optional scope and time-window settings.
 *
 * @category Rules
 */
export function maxConcurrentAssignments(
  assignments: number,
  opts?: RuleOptions & {
    startTime?: TimeOfDay;
    endTime?: TimeOfDay;
  },
): RuleEntry<
  "max-concurrent-assignments",
  { assignments: number } & MaxConcurrentAssignmentsOptions
> {
  return makeRule("max-concurrent-assignments", { assignments, ...opts });
}

/**
 * Softly targets the daily peak number of concurrent overlapping assignments.
 *
 * @remarks
 * Use this when the business wants to hit full productive occupancy at the
 * busy point of a day, but does not mean that same number must be present
 * throughout the full span. This is not a whole-day lower bound. Pair it with
 * {@link cover} for edge minima and with
 * {@link maxConcurrentAssignments} when the same value is also a hard cap.
 * Prefer this over a whole-day `cover(...)` when the brief means "reach the
 * peak" rather than "maintain this minimum throughout the day".
 *
 * This is a rule-level peak target, not a variant of {@link cover}. Do not
 * introduce a synthetic semantic time just to attach a whole-window
 * `cover(...)` when the requirement is really about the day's peak.
 *
 * @param assignments - Target peak number of concurrent overlapping assignments.
 * @param opts - Optional scope and soft priority.
 *
 * @category Rules
 */
export function targetPeakConcurrentAssignments(
  assignments: number,
  opts?: TargetPeakConcurrentAssignmentsOptions,
): RuleEntry<
  "target-peak-concurrent-assignments",
  { assignments: number } & TargetPeakConcurrentAssignmentsOptions
> {
  return makeRule("target-peak-concurrent-assignments", { assignments, ...opts });
}

/**
 * Maximum consecutive assigned days.
 *
 * @category Rules
 */
export function maxConsecutiveDays(
  days: number,
  opts?: EntityOnlyRuleOptions,
): RuleEntry<"max-consecutive-days", { days: number } & EntityOnlyRuleOptions> {
  return makeRule("max-consecutive-days", { days, ...opts });
}

/**
 * Once working, continue for at least this many consecutive days.
 *
 * @category Rules
 */
export function minConsecutiveDays(
  days: number,
  opts?: EntityOnlyRuleOptions,
): RuleEntry<"min-consecutive-days", { days: number } & EntityOnlyRuleOptions> {
  return makeRule("min-consecutive-days", { days, ...opts });
}

/**
 * Minimum rest hours between shifts.
 *
 * @category Rules
 */
export function minRestBetweenShifts(
  hours: number,
  opts?: EntityOnlyRuleOptions,
): RuleEntry<"min-rest-between-shifts", { hours: number } & EntityOnlyRuleOptions> {
  return makeRule("min-rest-between-shifts", { hours, ...opts });
}

/**
 * Nudge the solver toward scheduling targeted members.
 *
 * @remarks
 * Soft constraint. The solver adds a bonus for each assignment of the
 * targeted members, making them more likely to appear on the schedule.
 * Use `priority` to control how strong the nudge is; higher priority
 * means a larger bonus. Even at `"MANDATORY"` strength the solver can
 * still leave a member unassigned if hard constraints prevent it.
 *
 * Opposite of {@link avoidAssignment}. Both map to the same underlying
 * `assignment-priority` rule with different directions.
 *
 * @param opts - See {@link RuleOptions}
 *
 * @category Rules
 */
export function preferAssignment(
  opts?: RuleOptions,
): RuleEntry<"assignment-priority", { preference: "prefer" } & RuleOptions> {
  return makeRule("assignment-priority", { preference: "prefer", ...opts });
}

/**
 * Nudge the solver away from scheduling targeted members.
 *
 * @remarks
 * Soft constraint. The solver adds a penalty for each assignment of the
 * targeted members, making them less likely to appear on the schedule.
 * The member is still assigned when coverage requires it; the penalty
 * only matters when the solver has a choice.
 *
 * Opposite of {@link preferAssignment}. Both map to the same underlying
 * `assignment-priority` rule with different directions.
 *
 * @param opts - See {@link RuleOptions}
 *
 * @category Rules
 */
export function avoidAssignment(
  opts?: RuleOptions,
): RuleEntry<"assignment-priority", { preference: "avoid" } & RuleOptions> {
  return makeRule("assignment-priority", { preference: "avoid", ...opts });
}

/**
 * Steer a multi-role member toward shifts tagged with a specific role.
 *
 * @remarks
 * Penalizes assignment to shift patterns whose `roleIds` do not include
 * the preferred role. The member is still assigned to other roles when
 * coverage requires it; the penalty only matters when the solver has a
 * choice. Shift patterns without any `roleIds` (open to all) are also
 * penalized since they are not explicitly tagged with the preferred role.
 *
 * The targeted members must actually hold the preferred role in their
 * `roleIds`. If none of them do, compilation reports an error because
 * the rule would silently penalize all their assignments (the opposite
 * of the intent).
 *
 * Typical use case: a waiter who can cover kitchen pass shifts in a
 * pinch. Give the member both roles (`roleIds: ["waiter", "pass"]`)
 * and use `preferRole("waiter", ...)` so the solver keeps them on the
 * floor unless the pass team is short-staffed.
 *
 * @param roleId - The role to prefer
 * @param opts - See {@link EntityOnlyRuleOptions}
 *
 * @category Rules
 */
export function preferRole(
  roleId: string,
  opts?: EntityOnlyRuleOptions,
): RuleEntry<"role-preference", { roleId: string } & EntityOnlyRuleOptions> {
  return makeRule("role-preference", { roleId, ...opts });
}

/**
 * Steer a member toward shifts at a specific location.
 *
 * @remarks
 * Penalizes assignment to shift patterns whose `locationId` does not
 * match the preferred location. The member is still assigned elsewhere
 * when coverage requires it.
 *
 * @param locationId - The location to prefer
 * @param opts - See {@link EntityOnlyRuleOptions}
 *
 * @category Rules
 */
export function preferLocation(
  locationId: string,
  opts?: EntityOnlyRuleOptions,
): RuleEntry<"location-preference", { locationId: string } & EntityOnlyRuleOptions> {
  return makeRule("location-preference", { locationId, ...opts });
}

/**
 * Guarantees that targeted members appear on the schedule each week.
 *
 * @remarks
 * Use for staffing obligations: salaried employees who are paid regardless
 * of whether they work, or contracted staff who must be rostered. The solver
 * ensures each targeted member has at least one assignment per scheduling week.
 *
 * Always a soft constraint (HIGH priority internally). The schedule still
 * generates when a member genuinely cannot be placed (e.g., full week of
 * absences). Violations surface as validation warnings with distinct
 * messaging from {@link minDaysPerWeek}. Priority is not configurable;
 * the rule name communicates the intent.
 *
 * @category Rules
 */
export function mustAssign(opts?: {
  appliesTo?: string | string[];
}): RuleEntry<"must-assign", { appliesTo?: string | string[] }> {
  return makeRule("must-assign", { ...opts });
}

// ============================================================================
// Special Rules (custom resolvers)
// ============================================================================

/**
 * Block assignments during specified periods.
 * Requires at least one time scope (`dayOfWeek`, `dateRange`, `dates`, or `from`/`until`).
 *
 * @category Rules
 */
export function timeOff(opts: TimeOffOptions): TimeOffRuleEntry {
  const { from, until, ...rest } = opts;
  return defineRule("time-off", { from, until, ...rest }, (ctx) => {
    if (!rest.dayOfWeek && !rest.dateRange && !rest.dates && !rest.recurringPeriods) {
      throw new Error(
        "timeOff() requires at least one time scope (dayOfWeek, dateRange, dates, or recurringPeriods).",
      );
    }

    const { appliesTo, dates, priority, ...passthrough } = rest;
    const entityScope = resolveAppliesTo(appliesTo, ctx.roles, ctx.skills, ctx.memberIds);
    const resolvedDates = dates ? { specificDates: dates } : {};

    const partialDay: Record<string, unknown> = {};
    if (from && until) {
      partialDay.startTime = from;
      partialDay.endTime = until;
    } else if (from) {
      partialDay.startTime = from;
      partialDay.endTime = { hours: 23, minutes: 59 };
    } else if (until) {
      partialDay.startTime = { hours: 0, minutes: 0 };
      partialDay.endTime = until;
    }

    const resolved = {
      name: "time-off",
      priority: priority ?? "MANDATORY",
      ...passthrough,
      ...entityScope,
      ...resolvedDates,
      ...partialDay,
    } satisfies ResolvedTimeOffRuleConfig;

    return resolved;
  });
}

/**
 * Members work the same shifts on days they are both assigned.
 *
 * @category Rules
 */
export function assignTogether(
  memberIds: [string, string, ...string[]],
  opts?: AssignTogetherOptions,
): AssignTogetherRuleEntry {
  return defineRule("assign-together", { members: memberIds, ...opts }, (ctx) => {
    for (const member of memberIds) {
      if (!ctx.memberIds.has(member)) {
        throw new Error(
          `assignTogether references unknown member "${member}". ` +
            `Known member IDs: ${[...ctx.memberIds].join(", ")}`,
        );
      }
    }
    const resolved = {
      name: "assign-together",
      groupMemberIds: memberIds,
      priority: opts?.priority ?? "MANDATORY",
    } satisfies BuiltInResolvedRuleConfig<"assign-together">;

    return resolved;
  });
}

// ============================================================================
// Period-Based Day-of-Week Rules
// ============================================================================

/**
 * Options for {@link maxDaysOfWeekPerPeriod} and {@link minDaysOfWeekPerPeriod}.
 *
 * Exactly one of `weeks` or `months` must be provided to define the
 * repeating period. Week periods align to `weekStartsOn`. Month periods
 * align to calendar month boundaries.
 *
 * @category Rules
 */
export type DaysOfWeekPerPeriodOptions = {
  /** Scope to role, skill, or member ID. */
  appliesTo?: string | string[];
  /** Default `MANDATORY`. */
  priority?: Priority;
} & ({ weeks: number; months?: never } | { months: number; weeks?: never });

/**
 * Caps how many times a person works on specific days of the week within
 * each period.
 *
 * @remarks
 * The scheduling window is divided into non-overlapping chunks of the
 * configured period length. Within each chunk, only days matching the
 * `dayOfWeek` filter are counted. The constraint bounds that count.
 *
 * @param days - Maximum number of matching days allowed per period.
 * @param dayOfWeek - Which days of the week count toward the limit.
 * @param opts - Period length and optional scoping.
 *
 * @category Rules
 */
export function maxDaysOfWeekPerPeriod(
  days: number,
  dayOfWeek: readonly [DayOfWeek, ...DayOfWeek[]],
  opts: DaysOfWeekPerPeriodOptions,
): MaxDaysOfWeekPerPeriodRuleEntry {
  const { appliesTo, priority, ...periodOpts } = opts;
  const period =
    "weeks" in periodOpts && periodOpts.weeks != null
      ? { type: "weeks" as const, value: periodOpts.weeks }
      : { type: "months" as const, value: (periodOpts as { months: number }).months };

  return defineRule(
    "max-days-of-week-per-period",
    { days, dayOfWeek: [...dayOfWeek], period, appliesTo, priority },
    (ctx) => {
      const entityScope = resolveAppliesTo(appliesTo, ctx.roles, ctx.skills, ctx.memberIds);
      const resolved = {
        name: "max-days-of-week-per-period",
        days,
        dayOfWeek: [...dayOfWeek],
        period,
        priority: priority ?? "MANDATORY",
        ...entityScope,
      } satisfies ResolvedDaysOfWeekPerPeriodRuleConfig<"max-days-of-week-per-period">;

      return resolved;
    },
  );
}

/**
 * Enforces a minimum number of times a person works on specific days of the
 * week within each period.
 *
 * @remarks
 * The scheduling window is divided into non-overlapping chunks of the
 * configured period length. Within each chunk, only days matching the
 * `dayOfWeek` filter are counted. The constraint ensures the count meets
 * the minimum.
 *
 * When the scheduling window does not align evenly with the period
 * boundaries, the last chunk may contain fewer matching days than the
 * minimum. A MANDATORY priority will make the model infeasible in that
 * case. Use a soft priority (HIGH, MEDIUM, LOW) if partial periods at
 * the edges of the window are expected.
 *
 * @param days - Minimum number of matching days required per period.
 * @param dayOfWeek - Which days of the week count toward the limit.
 * @param opts - Period length and optional scoping.
 *
 * @category Rules
 */
export function minDaysOfWeekPerPeriod(
  days: number,
  dayOfWeek: readonly [DayOfWeek, ...DayOfWeek[]],
  opts: DaysOfWeekPerPeriodOptions,
): MinDaysOfWeekPerPeriodRuleEntry {
  const { appliesTo, priority, ...periodOpts } = opts;
  const period =
    "weeks" in periodOpts && periodOpts.weeks != null
      ? { type: "weeks" as const, value: periodOpts.weeks }
      : { type: "months" as const, value: (periodOpts as { months: number }).months };

  return defineRule(
    "min-days-of-week-per-period",
    { days, dayOfWeek: [...dayOfWeek], period, appliesTo, priority },
    (ctx) => {
      const entityScope = resolveAppliesTo(appliesTo, ctx.roles, ctx.skills, ctx.memberIds);
      const resolved = {
        name: "min-days-of-week-per-period",
        days,
        dayOfWeek: [...dayOfWeek],
        period,
        priority: priority ?? "MANDATORY",
        ...entityScope,
      } satisfies ResolvedDaysOfWeekPerPeriodRuleConfig<"min-days-of-week-per-period">;

      return resolved;
    },
  );
}

// ============================================================================
// Internal: appliesTo resolution (shared with definition.ts)
// ============================================================================

/**
 * Resolves an `appliesTo` value into entity scope fields.
 *
 * Each target string is checked against roles, skills, then member IDs.
 * If all targets resolve to the same namespace, they are combined into one
 * scope field. If they span namespaces, an error is thrown; the caller
 * should use separate rule entries instead.
 *
 * @internal
 */
export function resolveAppliesTo(
  appliesTo: string | string[] | undefined,
  roles: ReadonlySet<string>,
  skills: ReadonlySet<string>,
  memberIds: ReadonlySet<string>,
): {
  memberIds?: [string, ...string[]];
  roleIds?: [string, ...string[]];
  skillIds?: [string, ...string[]];
} {
  if (!appliesTo) return {};

  const targets = Array.isArray(appliesTo) ? appliesTo : [appliesTo];
  if (targets.length === 0) return {};

  const resolvedRoles: string[] = [];
  const resolvedSkills: string[] = [];
  const resolvedMembers: string[] = [];

  for (const target of targets) {
    if (roles.has(target)) {
      resolvedRoles.push(target);
    } else if (skills.has(target)) {
      resolvedSkills.push(target);
    } else if (memberIds.has(target)) {
      resolvedMembers.push(target);
    } else {
      throw new Error(`appliesTo target "${target}" is not a declared role, skill, or member ID.`);
    }
  }

  // Count how many namespaces were used
  const namespacesUsed = [resolvedRoles, resolvedSkills, resolvedMembers].filter(
    (arr) => arr.length > 0,
  ).length;

  if (namespacesUsed > 1) {
    throw new Error(
      `appliesTo targets span multiple namespaces (roles: [${resolvedRoles.join(", ")}], ` +
        `skills: [${resolvedSkills.join(", ")}], members: [${resolvedMembers.join(", ")}]). ` +
        `Use separate rule entries for each namespace.`,
    );
  }

  if (resolvedRoles.length > 0) {
    return { roleIds: resolvedRoles as [string, ...string[]] };
  }
  if (resolvedSkills.length > 0) {
    return { skillIds: resolvedSkills as [string, ...string[]] };
  }
  if (resolvedMembers.length > 0) {
    return { memberIds: resolvedMembers as [string, ...string[]] };
  }
  return {};
}
