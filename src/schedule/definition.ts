/**
 * Schedule definition, compilation, and solving.
 *
 * @module
 */

import type { DateString, DayOfWeek, SchedulingPeriod } from "../types.js";
import type { SemanticTimeEntry } from "../cpsat/semantic-time.js";
import type { MixedCoverageRequirement, CoverageVariant } from "../cpsat/semantic-time.js";
import { defineSemanticTimes } from "../cpsat/semantic-time.js";
import { resolveDaysFromPeriod } from "../datetime.utils.js";
import type { ModelBuilderConfig, CompilationResult } from "../cpsat/model-builder.js";
import { ModelBuilder } from "../cpsat/model-builder.js";
import type { SchedulingMember, ShiftPattern, Priority } from "../cpsat/types.js";
import type {
  AnyCpsatRuleConfigEntry,
  BuiltInCpsatRuleRegistry,
  CpsatRuleConfigEntryFor,
  CpsatRuleRegistry,
} from "../cpsat/rules/rules.types.js";
import {
  assertNoBuiltInCpsatRuleOverrides,
  assertValidCpsatRuleRegistry,
  builtInCpsatRuleRegistry,
} from "../cpsat/rules/registry.js";
import type { SolverClient, SolverRequest, SolverResponse } from "../client.types.js";
import { parseSolverResponse, resolveAssignments } from "../cpsat/response.js";
import type { ShiftAssignment } from "../cpsat/response.js";
import type { ScheduleValidation } from "../cpsat/validation.types.js";
import { calculateScheduleCost } from "../cpsat/cost.js";
import type { CostBreakdown } from "../cpsat/cost.js";

import type { CoverageEntry } from "./coverage.js";
import type { RuleEntry, RuleResolveContext, ScheduleRuleEntry } from "./rules.js";
import { resolveAppliesTo } from "./rules.js";

/** A value that can be passed to {@link Schedule.with}. */
type WithArg = Schedule<CpsatRuleRegistry> | SchedulingMember[];

type EmptyRuleRegistry = Record<never, never>;
type BuiltInRuleRegistry = BuiltInCpsatRuleRegistry;
type CustomRuleRegistry<TRuleRegistry extends BuiltInRuleRegistry> = CpsatRuleRegistry & {
  [K in Extract<Exclude<keyof TRuleRegistry, keyof BuiltInRuleRegistry>, string>]: TRuleRegistry[K];
};

type RegistryFromWithArg<T> = T extends Schedule<infer Registry> ? Registry : EmptyRuleRegistry;

type RuleEntryFields<T> = T extends RuleEntry<any, infer Fields> ? Fields : never;

type BuiltInScheduleRuleAuthoringFields<Name extends keyof BuiltInRuleRegistry> =
  Name extends "max-hours-day"
    ? RuleEntryFields<ReturnType<typeof import("./rules.js").maxHoursPerDay>>
    : Name extends "max-hours-week"
      ? RuleEntryFields<ReturnType<typeof import("./rules.js").maxHoursPerWeek>>
      : Name extends "min-hours-day"
        ? RuleEntryFields<ReturnType<typeof import("./rules.js").minHoursPerDay>>
        : Name extends "min-hours-week"
          ? RuleEntryFields<ReturnType<typeof import("./rules.js").minHoursPerWeek>>
          : Name extends "max-days-week"
            ? RuleEntryFields<ReturnType<typeof import("./rules.js").maxDaysPerWeek>>
            : Name extends "min-days-week"
              ? RuleEntryFields<ReturnType<typeof import("./rules.js").minDaysPerWeek>>
              : Name extends "target-days-week"
                ? RuleEntryFields<ReturnType<typeof import("./rules.js").targetDaysPerWeek>>
                : Name extends "max-shifts-day"
                  ? RuleEntryFields<ReturnType<typeof import("./rules.js").maxShiftsPerDay>>
                  : Name extends "max-concurrent-assignments"
                    ? RuleEntryFields<
                        ReturnType<typeof import("./rules.js").maxConcurrentAssignments>
                      >
                    : Name extends "target-peak-concurrent-assignments"
                      ? RuleEntryFields<
                          ReturnType<typeof import("./rules.js").targetPeakConcurrentAssignments>
                        >
                      : Name extends "max-consecutive-days"
                        ? RuleEntryFields<
                            ReturnType<typeof import("./rules.js").maxConsecutiveDays>
                          >
                        : Name extends "min-consecutive-days"
                          ? RuleEntryFields<
                              ReturnType<typeof import("./rules.js").minConsecutiveDays>
                            >
                          : Name extends "min-rest-between-shifts"
                            ? RuleEntryFields<
                                ReturnType<typeof import("./rules.js").minRestBetweenShifts>
                              >
                            : Name extends "must-assign"
                              ? RuleEntryFields<ReturnType<typeof import("./rules.js").mustAssign>>
                              : Name extends "assignment-priority"
                                ? RuleEntryFields<
                                    ReturnType<typeof import("./rules.js").preferAssignment>
                                  >
                                : Name extends "role-preference"
                                  ? RuleEntryFields<
                                      ReturnType<typeof import("./rules.js").preferRole>
                                    >
                                  : Name extends "location-preference"
                                    ? RuleEntryFields<
                                        ReturnType<typeof import("./rules.js").preferLocation>
                                      >
                                    : Name extends "time-off"
                                      ? RuleEntryFields<
                                          ReturnType<typeof import("./rules.js").timeOff>
                                        >
                                      : Name extends "assign-together"
                                        ? RuleEntryFields<
                                            ReturnType<typeof import("./rules.js").assignTogether>
                                          >
                                        : Name extends "max-days-of-week-per-period"
                                          ? RuleEntryFields<
                                              ReturnType<
                                                typeof import("./rules.js").maxDaysOfWeekPerPeriod
                                              >
                                            >
                                          : Name extends "min-days-of-week-per-period"
                                            ? RuleEntryFields<
                                                ReturnType<
                                                  typeof import("./rules.js").minDaysOfWeekPerPeriod
                                                >
                                              >
                                            : Name extends "minimize-cost"
                                              ? RuleEntryFields<
                                                  ReturnType<
                                                    typeof import("./cost.js").minimizeCost
                                                  >
                                                >
                                              : Name extends "day-cost-multiplier"
                                                ? RuleEntryFields<
                                                    ReturnType<
                                                      typeof import("./cost.js").dayMultiplier
                                                    >
                                                  >
                                                : Name extends "day-cost-surcharge"
                                                  ? RuleEntryFields<
                                                      ReturnType<
                                                        typeof import("./cost.js").daySurcharge
                                                      >
                                                    >
                                                  : Name extends "time-cost-surcharge"
                                                    ? RuleEntryFields<
                                                        ReturnType<
                                                          typeof import("./cost.js").timeSurcharge
                                                        >
                                                      >
                                                    : Name extends "overtime-weekly-multiplier"
                                                      ? RuleEntryFields<
                                                          ReturnType<
                                                            typeof import("./cost.js").overtimeMultiplier
                                                          >
                                                        >
                                                      : Name extends "overtime-weekly-surcharge"
                                                        ? RuleEntryFields<
                                                            ReturnType<
                                                              typeof import("./cost.js").overtimeSurcharge
                                                            >
                                                          >
                                                        : Name extends "overtime-daily-multiplier"
                                                          ? RuleEntryFields<
                                                              ReturnType<
                                                                typeof import("./cost.js").dailyOvertimeMultiplier
                                                              >
                                                            >
                                                          : Name extends "overtime-daily-surcharge"
                                                            ? RuleEntryFields<
                                                                ReturnType<
                                                                  typeof import("./cost.js").dailyOvertimeSurcharge
                                                                >
                                                              >
                                                            : Name extends "overtime-tiered-multiplier"
                                                              ? RuleEntryFields<
                                                                  ReturnType<
                                                                    typeof import("./cost.js").tieredOvertimeMultiplier
                                                                  >
                                                                >
                                                              : never;

type ValidateScheduleRuleEntry<TRuleRegistry extends CpsatRuleRegistry, Entry> =
  Entry extends ScheduleRuleEntry<TRuleRegistry>
    ? Entry
    : Entry extends RuleEntry<infer Name, infer Fields>
      ? string extends Name
        ? Entry
        : Name extends keyof TRuleRegistry & string
          ? Name extends keyof BuiltInRuleRegistry
            ? Fields extends BuiltInScheduleRuleAuthoringFields<Name>
              ? Entry
              : never
            : Fields extends Omit<CpsatRuleConfigEntryFor<Pick<TRuleRegistry, Name>>, "name">
              ? Entry
              : never
          : never
      : never;

type ValidateScheduleRules<
  TRuleRegistry extends CpsatRuleRegistry,
  TRules extends readonly unknown[],
> = {
  readonly [Index in keyof TRules]: ValidateScheduleRuleEntry<TRuleRegistry, TRules[Index]>;
};

type BuiltInScheduleConfigInput<
  R extends readonly string[],
  S extends readonly string[],
  T extends Record<string, SemanticTimeEntry>,
  TRules extends readonly unknown[],
> = Omit<ScheduleConfig<R, S, T, BuiltInRuleRegistry>, "rules" | "ruleRegistry"> & {
  rules?: ValidateScheduleRules<BuiltInRuleRegistry, TRules>;
  ruleRegistry?: undefined;
};

type CustomScheduleConfigInput<
  R extends readonly string[],
  S extends readonly string[],
  T extends Record<string, SemanticTimeEntry>,
  TCustomRuleRegistry extends CpsatRuleRegistry,
  TRules extends readonly unknown[],
> = Omit<
  ScheduleConfig<R, S, T, BuiltInRuleRegistry & TCustomRuleRegistry>,
  "rules" | "ruleRegistry"
> & {
  ruleRegistry: TCustomRuleRegistry;
  rules?: ValidateScheduleRules<BuiltInRuleRegistry & TCustomRuleRegistry, TRules>;
};

type BuiltInPartialScheduleConfigInput<TRules extends readonly unknown[]> = Partial<
  Omit<
    ScheduleConfig<
      readonly string[],
      readonly string[],
      Record<string, SemanticTimeEntry>,
      BuiltInRuleRegistry
    >,
    "rules" | "ruleRegistry"
  >
> & {
  rules?: ValidateScheduleRules<BuiltInRuleRegistry, TRules>;
  ruleRegistry?: undefined;
};

type CustomPartialScheduleConfigInput<
  TCustomRuleRegistry extends CpsatRuleRegistry,
  TRules extends readonly unknown[],
> = Partial<
  Omit<
    ScheduleConfig<
      readonly string[],
      readonly string[],
      Record<string, SemanticTimeEntry>,
      BuiltInRuleRegistry & TCustomRuleRegistry
    >,
    "rules" | "ruleRegistry"
  >
> & {
  ruleRegistry: TCustomRuleRegistry;
  rules?: ValidateScheduleRules<BuiltInRuleRegistry & TCustomRuleRegistry, TRules>;
};

type UnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer Result,
) => void
  ? Result
  : never;

type MergedRegistryFromArgs<Args extends readonly WithArg[]> = UnionToIntersection<
  RegistryFromWithArg<Args[number]>
>;

// ============================================================================
// SolveResult
// ============================================================================

/** Status of a solve attempt, using idiomatic lowercase TypeScript literals. */
export type SolveStatus = "optimal" | "feasible" | "infeasible" | "no_solution";

/**
 * Strategy for {@link Schedule.solve} and {@link Schedule.compile}.
 *
 * @remarks
 * `{ type: "optimize" }` optimizes objectives and soft constraints.
 * `{ type: "feasibility-only" }` asks the solver for a hard-feasible solution
 * only, ignoring objectives and soft-constraint penalties. Feasibility-only
 * results do not guarantee cost, objective optimality, or soft-constraint
 * diagnostics.
 *
 * @category Schedule Definition
 */
export type SolveStrategy =
  | {
      /** Optimize objectives and soft constraints. */
      readonly type: "optimize";
    }
  | {
      /** Find a hard-feasible solution without optimizing objectives or soft constraints. */
      readonly type: "feasibility-only";
    };

/**
 * Result of {@link Schedule.solve}.
 *
 * @remarks
 * Feasibility-only solves return hard-feasible assignments when one is found,
 * but they do not optimize objectives or compute objective-derived metadata.
 * Cost is therefore only produced for optimized solves.
 *
 * @category Schedule Definition
 */
export interface SolveResult {
  /** Outcome of the solve attempt. */
  status: SolveStatus;
  /** Shift assignments (empty when infeasible or no solution). */
  assignments: ShiftAssignment[];
  /** Validation results collected during compilation and solving. */
  validation: ScheduleValidation;
  /** Cost breakdown for optimized solves when cost rules are used and a solution is found. */
  cost?: CostBreakdown;
}

/**
 * Options for {@link Schedule.solve} and {@link Schedule.compile}.
 *
 * @category Schedule Definition
 */
export interface SolveOptions {
  /** The date range to schedule. */
  dateRange: { start: DateString; end: DateString };
  /** Solver time limit in seconds. */
  timeLimitSeconds?: number;
  /**
   * Strategy used by the solver.
   *
   * `{ type: "optimize" }` optimizes objectives and soft constraints.
   * `{ type: "feasibility-only" }` finds any hard-feasible solution, ignoring
   * objectives, soft-constraint penalties, and objective-derived metadata such
   * as cost.
   */
  strategy?: SolveStrategy;
  /**
   * Fixed assignments from a prior solve (e.g., rolling schedule).
   * These are injected as fixed variables in the solver.
   *
   * Not yet implemented. Providing pinned assignments throws an error.
   */
  pinned?: ShiftAssignment[];
}

// ============================================================================
// Schedule Configuration
// ============================================================================

/**
 * Configuration for {@link schedule}.
 *
 * @remarks
 * Coverage entries for the same semantic time and target stack additively.
 * An unscoped entry applies every day; adding a weekend-only entry on top
 * doubles the count on those days. Use mutually exclusive `dayOfWeek` on
 * both entries to avoid stacking. See {@link cover} for details.
 *
 * `roleIds`, `times`, `coverage`, and `shiftPatterns` are required.
 * These four fields form the minimum solvable schedule.
 *
 * The `TRuleRegistry` generic represents the full active rule registry for the
 * schedule. In `schedule()`, that registry always includes the built-in rules,
 * and `ruleRegistry` adds any custom extensions on top.
 *
 * @category Schedule Definition
 */
export interface ScheduleConfig<
  R extends readonly string[] = readonly string[],
  S extends readonly string[] = readonly [],
  T extends Record<string, SemanticTimeEntry> = Record<string, SemanticTimeEntry>,
  TRuleRegistry extends BuiltInRuleRegistry = BuiltInRuleRegistry,
> {
  /** Declared role IDs. */
  roleIds: R;
  /** Declared skill IDs. When omitted, coverage targets can only be roles. */
  skillIds?: S;
  /** Named semantic time periods. */
  times: T;
  /** Staffing requirements per time period (entries stack additively). */
  coverage: NoInfer<CoverageEntry<keyof T & string, R[number] | S[number]>>[];
  /** Available shift patterns. */
  shiftPatterns: ShiftPattern[];
  /** Scheduling rules and constraints. */
  rules?: ScheduleRuleEntry<TRuleRegistry>[];
  /**
   * Additional rule descriptors keyed by rule name.
   *
   * @remarks
   * These entries are merged with the built-in rule registry at compile time.
   * Built-in rule names cannot be overridden.
   */
  ruleRegistry?: CustomRuleRegistry<TRuleRegistry>;
  /** Team members (typically added via `.with()` at runtime). */
  members?: SchedulingMember[];
  /** Days of the week the business operates (inclusion filter). */
  dayOfWeek?: readonly [DayOfWeek, ...DayOfWeek[]];
  /** Which day starts the week for weekly rules. Defaults to `"monday"`. */
  weekStartsOn?: DayOfWeek;
}

/**
 * Configuration for {@link scheduleWithRuleRegistry}.
 *
 * @remarks
 * Unlike {@link ScheduleConfig}, this config does not implicitly include the
 * built-in rule registry. The provided registry is the complete active rule
 * registry for the schedule.
 *
 * @category Schedule Definition
 */
export interface ScheduleWithRuleRegistryConfig<
  R extends readonly string[] = readonly string[],
  S extends readonly string[] = readonly [],
  T extends Record<string, SemanticTimeEntry> = Record<string, SemanticTimeEntry>,
  TRuleRegistry extends CpsatRuleRegistry = CpsatRuleRegistry,
> {
  /** Declared role IDs. */
  roleIds: R;
  /** Declared skill IDs. When omitted, coverage targets can only be roles. */
  skillIds?: S;
  /** Named semantic time periods. */
  times: T;
  /** Staffing requirements per time period (entries stack additively). */
  coverage: NoInfer<CoverageEntry<keyof T & string, R[number] | S[number]>>[];
  /** Available shift patterns. */
  shiftPatterns: ShiftPattern[];
  /** Scheduling rules and constraints. */
  rules?: ScheduleRuleEntry<TRuleRegistry>[];
  /** Team members (typically added via `.with()` at runtime). */
  members?: SchedulingMember[];
  /** Days of the week the business operates (inclusion filter). */
  dayOfWeek?: readonly [DayOfWeek, ...DayOfWeek[]];
  /** Which day starts the week for weekly rules. Defaults to `"monday"`. */
  weekStartsOn?: DayOfWeek;
}

// ============================================================================
// Internal merged config
// ============================================================================

/** Internal representation of a fully merged schedule. */
interface MergedScheduleConfig {
  roleIds: string[];
  skillIds: string[];
  times: Record<string, SemanticTimeEntry>;
  coverage: CoverageEntry[];
  shiftPatterns: ShiftPattern[];
  rules: ScheduleRuleEntry<CpsatRuleRegistry>[];
  ruleRegistry: CpsatRuleRegistry;
  members: SchedulingMember[];
  dayOfWeek?: readonly [DayOfWeek, ...DayOfWeek[]];
  weekStartsOn?: DayOfWeek;
}

// ============================================================================
// Schedule class
// ============================================================================

/**
 * An immutable schedule definition.
 *
 * Created by {@link schedule}, composed via {@link Schedule.with},
 * and solved via {@link Schedule.solve}.
 *
 * @category Schedule Definition
 */
export class Schedule<TRuleRegistry extends CpsatRuleRegistry = BuiltInRuleRegistry> {
  readonly #config: Readonly<MergedScheduleConfig>;

  /** @internal */
  constructor(config: MergedScheduleConfig) {
    this.#config = config;
  }

  /** @internal Returns a defensive copy of the config for merging. */
  _getConfig(): MergedScheduleConfig {
    return {
      ...this.#config,
      roleIds: [...this.#config.roleIds],
      skillIds: [...this.#config.skillIds],
      times: { ...this.#config.times },
      coverage: [...this.#config.coverage],
      shiftPatterns: [...this.#config.shiftPatterns],
      rules: [...this.#config.rules],
      ruleRegistry: { ...this.#config.ruleRegistry },
      members: [...this.#config.members],
    };
  }

  // --------------------------------------------------------------------------
  // Inspection
  // --------------------------------------------------------------------------

  /** Declared role IDs. */
  get roleIds(): readonly string[] {
    return this.#config.roleIds;
  }

  /** Declared skill IDs. */
  get skillIds(): readonly string[] {
    return this.#config.skillIds;
  }

  /** Names of declared semantic times. */
  get timeNames(): readonly string[] {
    return Object.keys(this.#config.times);
  }

  /** Shift pattern IDs. */
  get shiftPatternIds(): readonly string[] {
    return this.#config.shiftPatterns.map((sp) => sp.id);
  }

  /** Internal rule identifiers in kebab-case. */
  get ruleNames(): readonly string[] {
    return this.#config.rules.map((r) => r._rule);
  }

  // --------------------------------------------------------------------------
  // Composition
  // --------------------------------------------------------------------------

  /**
   * Merges schedules or members onto this schedule, returning a new
   * immutable `Schedule`. The original is untouched.
   *
   * Accepts any mix of `Schedule` instances and `SchedulingMember[]` arrays.
   *
   * Merge semantics (when merging schedules):
   * - Roles: union (additive)
   * - Skills: union (additive)
   * - Times: additive; error on name collision
   * - Coverage: additive
   * - Shift patterns: additive; error on ID collision
   * - Rules: additive
   * - Members: additive; error on duplicate ID
   *
   * Validation runs eagerly: role/skill disjointness, coverage targets
   * referencing declared roles/skills, member role references, etc.
   */
  with<const Args extends readonly WithArg[]>(
    ...args: Args
  ): Schedule<TRuleRegistry & MergedRegistryFromArgs<Args>> {
    const merged = mergeConfig(this.#config, args);
    return new Schedule(merged);
  }

  // --------------------------------------------------------------------------
  // Solve / compile
  // --------------------------------------------------------------------------

  /**
   * Compiles, validates, solves, and parses in one call.
   *
   * @param client - Solver client (e.g., `new HttpSolverClient(fetch, url)`)
   * @param options - Date range and optional pinned assignments
   */
  async solve(client: SolverClient, options: SolveOptions): Promise<SolveResult> {
    const strategy = resolveSolveStrategy(options.strategy);
    const compiled = this.compile(options);
    if (!compiled.canSolve) {
      return {
        status: "infeasible",
        assignments: [],
        validation: compiled.validation,
      };
    }

    const response = await client.solve(compiled.request);
    return buildSolveResult(response, compiled, this.#config, strategy);
  }

  /**
   * Diagnostic escape hatch. Compiles the schedule without solving.
   *
   * @param options - Date range and optional pinned assignments
   */
  compile(options: SolveOptions): CompilationResult & { builder: ModelBuilder } {
    if (options.pinned && options.pinned.length > 0) {
      throw new Error("Pinned assignments are not yet supported.");
    }

    const strategy = resolveSolveStrategy(options.strategy);
    const modelConfig = resolveToModelConfig(this.#config, options, strategy);
    const builder = new ModelBuilder(modelConfig);
    const result = builder.compile();
    return { ...result, builder };
  }
}

// ============================================================================
// schedule() factory
// ============================================================================

/**
 * Create a schedule definition.
 *
 * Returns an immutable {@link Schedule} that can be composed via `.with()`
 * and solved via `.solve()`.
 *
 * @remarks
 * `schedule()` always uses the built-in rule registry as its default. Passing
 * `ruleRegistry` extends that default with custom rules.
 *
 * @example
 * ```typescript
 * const venue = schedule({
 *   roleIds: ["waiter", "runner", "manager"],
 *   skillIds: ["senior"],
 *   times: {
 *     lunch: time({ startTime: t(12), endTime: t(15) }),
 *     dinner: time(
 *       { startTime: t(17), endTime: t(21) },
 *       { startTime: t(18), endTime: t(22), dayOfWeek: weekend },
 *     ),
 *   },
 *   coverage: [
 *     cover("lunch", "waiter", 2),
 *     cover("dinner", "waiter", 4, { dayOfWeek: weekdays }),
 *     cover("dinner", "waiter", 5, { dayOfWeek: weekend }),
 *     cover("dinner", "manager", 1),
 *   ],
 *   shiftPatterns: [
 *     shift("lunch_shift", t(11, 30), t(15)),
 *     shift("evening", t(17), t(22)),
 *   ],
 *   rules: [
 *     maxHoursPerDay(10),
 *     maxHoursPerWeek(48),
 *     minRestBetweenShifts(11),
 *   ],
 * });
 * ```
 *
 * @category Schedule Definition
 */
export function schedule<
  const R extends readonly string[],
  const S extends readonly string[] = readonly [],
  const T extends Record<string, SemanticTimeEntry> = Record<string, SemanticTimeEntry>,
  const TRules extends readonly unknown[] = readonly ScheduleRuleEntry<BuiltInRuleRegistry>[],
>(config: BuiltInScheduleConfigInput<R, S, T, TRules>): Schedule<BuiltInRuleRegistry>;
export function schedule<
  const R extends readonly string[],
  const S extends readonly string[] = readonly [],
  const T extends Record<string, SemanticTimeEntry> = Record<string, SemanticTimeEntry>,
  TCustomRuleRegistry extends CpsatRuleRegistry = CpsatRuleRegistry,
  const TRules extends readonly unknown[] = readonly ScheduleRuleEntry<
    BuiltInRuleRegistry & TCustomRuleRegistry
  >[],
>(
  config: CustomScheduleConfigInput<R, S, T, TCustomRuleRegistry, TRules>,
): Schedule<BuiltInRuleRegistry & TCustomRuleRegistry>;
export function schedule(config: {
  roleIds: readonly string[];
  skillIds?: readonly string[];
  times: Record<string, SemanticTimeEntry>;
  coverage: CoverageEntry[];
  shiftPatterns: ShiftPattern[];
  rules?: readonly RuleEntry[];
  ruleRegistry?: CpsatRuleRegistry;
  members?: SchedulingMember[];
  dayOfWeek?: readonly [DayOfWeek, ...DayOfWeek[]];
  weekStartsOn?: DayOfWeek;
}): Schedule<CpsatRuleRegistry> {
  const customRuleRegistry = config.ruleRegistry ?? {};
  validateRuleRegistryExtension(customRuleRegistry);
  const merged = buildMergedConfig(config, {
    ...builtInCpsatRuleRegistry,
    ...customRuleRegistry,
  });
  validateConfig(merged);
  return new Schedule(merged);
}

/**
 * Create a schedule definition with an explicit complete rule registry.
 *
 * @remarks
 * Use this when you want full control over the active rule registry, including
 * schedules that do not include the built-in rules.
 *
 * @category Schedule Definition
 */
export function scheduleWithRuleRegistry<
  const R extends readonly string[],
  const S extends readonly string[] = readonly [],
  const T extends Record<string, SemanticTimeEntry> = Record<string, SemanticTimeEntry>,
  TRuleRegistry extends CpsatRuleRegistry = CpsatRuleRegistry,
  const TRules extends readonly unknown[] = readonly ScheduleRuleEntry<TRuleRegistry>[],
>(
  ruleRegistry: TRuleRegistry,
  config: Omit<ScheduleWithRuleRegistryConfig<R, S, T, TRuleRegistry>, "rules"> & {
    rules?: ValidateScheduleRules<TRuleRegistry, TRules>;
  },
): Schedule<TRuleRegistry> {
  assertValidCpsatRuleRegistry(ruleRegistry);
  assertNoBuiltInCpsatRuleOverrides(ruleRegistry);
  const merged = buildMergedConfig(config, ruleRegistry);
  validateConfig(merged);
  return new Schedule(merged);
}

/**
 * Create a partial schedule for composition via `.with()`.
 *
 * Unlike {@link schedule}, all fields are optional. Use this for
 * schedules that layer rules, coverage, or other config onto a
 * complete base schedule.
 *
 * @example
 * ```typescript
 * const companyPolicy = partialSchedule({
 *   rules: [maxHoursPerWeek(40), minRestBetweenShifts(11)],
 * });
 *
 * const ready = venue.with(companyPolicy, teamMembers);
 * ```
 *
 * @category Schedule Definition
 */
export function partialSchedule<
  const TRules extends readonly unknown[] = readonly ScheduleRuleEntry<BuiltInRuleRegistry>[],
>(config: BuiltInPartialScheduleConfigInput<TRules>): Schedule<BuiltInRuleRegistry>;
export function partialSchedule<
  TCustomRuleRegistry extends CpsatRuleRegistry = CpsatRuleRegistry,
  const TRules extends readonly unknown[] = readonly ScheduleRuleEntry<
    BuiltInRuleRegistry & TCustomRuleRegistry
  >[],
>(
  config: CustomPartialScheduleConfigInput<TCustomRuleRegistry, TRules>,
): Schedule<BuiltInRuleRegistry & TCustomRuleRegistry>;
export function partialSchedule(
  config: Partial<{
    roleIds: readonly string[];
    skillIds: readonly string[];
    times: Record<string, SemanticTimeEntry>;
    coverage: CoverageEntry[];
    shiftPatterns: ShiftPattern[];
    rules: readonly RuleEntry[];
    ruleRegistry: CpsatRuleRegistry;
    members: SchedulingMember[];
    dayOfWeek: readonly [DayOfWeek, ...DayOfWeek[]];
    weekStartsOn: DayOfWeek;
  }>,
): Schedule<CpsatRuleRegistry> {
  const customRuleRegistry = config.ruleRegistry ?? {};
  validateRuleRegistryExtension(customRuleRegistry);
  const merged = buildMergedConfig(
    {
      roleIds: [],
      times: {},
      coverage: [],
      shiftPatterns: [],
      ...config,
    } as ScheduleConfig,
    {
      ...builtInCpsatRuleRegistry,
      ...customRuleRegistry,
    },
  );
  validateConfig(merged);
  return new Schedule(merged);
}

// ============================================================================
// Internal: Build merged config from user input
// ============================================================================

function buildMergedConfig<
  R extends readonly string[],
  S extends readonly string[],
  T extends Record<string, SemanticTimeEntry>,
  TRuleRegistry extends CpsatRuleRegistry,
  TRules extends readonly unknown[] = readonly ScheduleRuleEntry<CpsatRuleRegistry>[],
>(
  config:
    | (Omit<ScheduleConfig<R, S, T, BuiltInRuleRegistry & TRuleRegistry>, "rules"> & {
        rules?: TRules;
      })
    | (Omit<ScheduleWithRuleRegistryConfig<R, S, T, TRuleRegistry>, "rules"> & {
        rules?: TRules;
      }),
  ruleRegistry: CpsatRuleRegistry,
): MergedScheduleConfig {
  return {
    roleIds: [...config.roleIds],
    skillIds: [...(config.skillIds ?? [])],
    times: { ...config.times },
    coverage: [...config.coverage],
    shiftPatterns: [...config.shiftPatterns],
    rules: [...(config.rules ?? [])] as ScheduleRuleEntry<CpsatRuleRegistry>[],
    ruleRegistry: { ...ruleRegistry },
    members: [...(config.members ?? [])],
    dayOfWeek: config.dayOfWeek,
    weekStartsOn: config.weekStartsOn,
  };
}

// ============================================================================
// Internal: Validate merged config
// ============================================================================

function validateRuleRegistryExtension(ruleRegistry: CpsatRuleRegistry): void {
  assertValidCpsatRuleRegistry(ruleRegistry);
  assertNoBuiltInCpsatRuleOverrides(ruleRegistry);
}

function validateConfig(config: MergedScheduleConfig): void {
  const roles = new Set<string>(config.roleIds);
  const skills = new Set<string>(config.skillIds);

  assertValidCpsatRuleRegistry(config.ruleRegistry);

  // Validate role/skill disjointness
  for (const skill of skills) {
    if (roles.has(skill)) {
      throw new Error(
        `"${skill}" is declared as both a role and a skill. Roles and skills must be disjoint.`,
      );
    }
  }

  // Validate shift pattern role references
  for (const sp of config.shiftPatterns) {
    if (sp.roleIds) {
      for (const role of sp.roleIds) {
        if (!roles.has(role)) {
          throw new Error(
            `Shift pattern "${sp.id}" references unknown role "${role}". ` +
              `Declared roles: ${[...roles].join(", ")}`,
          );
        }
      }
    }
  }

  // Validate coverage entries
  for (const entry of config.coverage) {
    validateCoverageEntry(entry, roles, skills);
  }

  // Validate member references
  const memberIds = new Set<string>();
  for (const member of config.members) {
    if (memberIds.has(member.id)) {
      throw new Error(`Duplicate member ID "${member.id}".`);
    }
    memberIds.add(member.id);

    if (roles.has(member.id)) {
      throw new Error(`Member ID "${member.id}" collides with a declared role name.`);
    }
    if (skills.has(member.id)) {
      throw new Error(`Member ID "${member.id}" collides with a declared skill name.`);
    }

    for (const role of member.roleIds) {
      if (!roles.has(role)) {
        throw new Error(
          `Member "${member.id}" references unknown role "${role}". ` +
            `Declared roles: ${[...roles].join(", ")}`,
        );
      }
    }
    if (member.skillIds) {
      for (const skill of member.skillIds) {
        if (!skills.has(skill)) {
          throw new Error(
            `Member "${member.id}" references unknown skill "${skill}". ` +
              `Declared skills: ${[...skills].join(", ")}`,
          );
        }
      }
    }
  }
}

function validateCoverageEntry(
  entry: CoverageEntry,
  roles: Set<string>,
  skills: Set<string>,
): void {
  const targets = Array.isArray(entry.target) ? entry.target : [entry.target];
  if (Array.isArray(entry.target)) {
    for (const target of targets) {
      if (!roles.has(target)) {
        throw new Error(
          `Coverage for "${entry.timeName}" references "${target}" in a role OR group, ` +
            `but it is not a declared role. Declared roles: ${[...roles].join(", ")}`,
        );
      }
    }
  } else {
    if (!roles.has(entry.target) && !skills.has(entry.target)) {
      throw new Error(
        `Coverage for "${entry.timeName}" references unknown target "${entry.target}". ` +
          `Declared roles: ${[...roles].join(", ")}. ` +
          `Declared skills: ${[...skills].join(", ")}`,
      );
    }
  }
  if (entry.options.skillIds) {
    for (const s of entry.options.skillIds) {
      if (!skills.has(s)) {
        throw new Error(
          `Coverage for "${entry.timeName}" uses skill filter "${s}" ` +
            `which is not a declared skill. Declared skills: ${[...skills].join(", ")}`,
        );
      }
    }
  }
}

// ============================================================================
// Internal: Merge logic
// ============================================================================

function mergeConfig(
  base: Readonly<MergedScheduleConfig>,
  args: readonly WithArg[],
): MergedScheduleConfig {
  const result: MergedScheduleConfig = {
    roleIds: [...base.roleIds],
    skillIds: [...base.skillIds],
    times: { ...base.times },
    coverage: [...base.coverage],
    shiftPatterns: [...base.shiftPatterns],
    rules: [...base.rules],
    ruleRegistry: { ...base.ruleRegistry },
    members: [...base.members],
    dayOfWeek: base.dayOfWeek,
    weekStartsOn: base.weekStartsOn,
  };

  for (const arg of args) {
    if (arg instanceof Schedule) {
      mergeScheduleFragment(result, arg);
    } else if (Array.isArray(arg)) {
      mergeMembers(result, arg);
    } else {
      throw new Error(
        `Unexpected argument passed to .with(): expected Schedule or SchedulingMember[], got ${typeof arg}`,
      );
    }
  }

  // Validate the merged result
  validateConfig(result);
  return result;
}

function mergeScheduleFragment(result: MergedScheduleConfig, s: Schedule<CpsatRuleRegistry>): void {
  const other = s._getConfig();

  // dayOfWeek: error on conflict (semantics of union vs intersection are ambiguous)
  if (other.dayOfWeek !== undefined) {
    if (result.dayOfWeek !== undefined) {
      const baseSet = new Set(result.dayOfWeek);
      const same =
        result.dayOfWeek.length === other.dayOfWeek.length &&
        other.dayOfWeek.every((d) => baseSet.has(d));
      if (!same) {
        throw new Error(
          "Cannot merge schedules with different dayOfWeek filters. " +
            `Base has [${result.dayOfWeek.join(", ")}], ` +
            `incoming has [${other.dayOfWeek.join(", ")}].`,
        );
      }
    } else {
      result.dayOfWeek = other.dayOfWeek;
    }
  }

  // weekStartsOn: error on conflict (only one week boundary for weekly rules)
  if (other.weekStartsOn !== undefined) {
    if (result.weekStartsOn !== undefined && result.weekStartsOn !== other.weekStartsOn) {
      throw new Error(
        "Cannot merge schedules with different weekStartsOn values. " +
          `Base has "${result.weekStartsOn}", incoming has "${other.weekStartsOn}".`,
      );
    }
    result.weekStartsOn = other.weekStartsOn;
  }

  // Roles: union
  for (const role of other.roleIds) {
    if (!result.roleIds.includes(role)) {
      result.roleIds.push(role);
    }
  }

  // Skills: union
  for (const skill of other.skillIds) {
    if (!result.skillIds.includes(skill)) {
      result.skillIds.push(skill);
    }
  }

  // Times: additive, error on collision
  for (const [name, entry] of Object.entries(other.times)) {
    if (name in result.times) {
      throw new Error(
        `Time name "${name}" already exists. Cannot merge schedules with colliding time names.`,
      );
    }
    result.times[name] = entry;
  }

  // Coverage: additive
  result.coverage.push(...other.coverage);

  // Shift patterns: additive, error on ID collision
  const existingIds = new Set(result.shiftPatterns.map((sp) => sp.id));
  for (const sp of other.shiftPatterns) {
    if (existingIds.has(sp.id)) {
      throw new Error(
        `Shift pattern ID "${sp.id}" already exists. Cannot merge schedules with colliding shift pattern IDs.`,
      );
    }
    result.shiftPatterns.push(sp);
    existingIds.add(sp.id);
  }

  // Rules: additive
  result.rules.push(...other.rules);

  // Rule registry: merge, error on collision
  for (const [name, descriptor] of Object.entries(other.ruleRegistry)) {
    if (name in result.ruleRegistry && result.ruleRegistry[name] !== descriptor) {
      throw new Error(
        `Rule registry entry "${name}" already registered. Cannot merge schedules with colliding rule registries.`,
      );
    }
    result.ruleRegistry[name] = descriptor;
  }

  // Members: additive, error on duplicate ID
  const existingMemberIds = new Set(result.members.map((m) => m.id));
  for (const member of other.members) {
    if (existingMemberIds.has(member.id)) {
      throw new Error(
        `Duplicate member ID "${member.id}". Cannot merge schedules with colliding member IDs.`,
      );
    }
    result.members.push(member);
    existingMemberIds.add(member.id);
  }
}

function mergeMembers(result: MergedScheduleConfig, incoming: SchedulingMember[]): void {
  const existingIds = new Set(result.members.map((m) => m.id));
  for (const member of incoming) {
    if (existingIds.has(member.id)) {
      throw new Error(
        `Duplicate member ID "${member.id}". Cannot merge members with colliding IDs.`,
      );
    }
    result.members.push(member);
    existingIds.add(member.id);
  }
}

// ============================================================================
// Internal: Resolve to ModelBuilderConfig
// ============================================================================

function resolveToModelConfig(
  config: Readonly<MergedScheduleConfig>,
  options: SolveOptions,
  strategy: SolveStrategy,
): ModelBuilderConfig<CpsatRuleRegistry, AnyCpsatRuleConfigEntry> {
  const roles = new Set<string>(config.roleIds);
  const skills = new Set<string>(config.skillIds);
  const memberIds = new Set<string>(config.members.map((m) => m.id));

  // Build semantic time context
  const semanticTimes = defineSemanticTimes(config.times);

  // Convert coverage entries to semantic coverage requirements
  const coverageReqs = buildCoverageRequirements(config.coverage, roles, skills);

  // Resolve scheduling period with dayOfWeek filter
  const schedulingPeriod: SchedulingPeriod = {
    dateRange: options.dateRange,
  };
  const resolvedPeriod = applyDaysFilter(schedulingPeriod, config.dayOfWeek);
  const days = resolveDaysFromPeriod(resolvedPeriod);

  // Resolve coverage
  const resolvedCoverage = semanticTimes.resolve(coverageReqs, days);

  // Resolve rules
  const allRules = [...config.rules];

  // Validate pay data when cost rules are present
  const costRuleNames = new Set([
    "minimize-cost",
    "day-cost-multiplier",
    "day-cost-surcharge",
    "time-cost-surcharge",
    "overtime-weekly-multiplier",
    "overtime-weekly-surcharge",
    "overtime-daily-multiplier",
    "overtime-daily-surcharge",
    "overtime-tiered-multiplier",
  ]);
  const hasCostRules = allRules.some((r) => costRuleNames.has(r._rule));
  if (strategy.type === "optimize" && hasCostRules) {
    const missingPay = config.members.filter((m) => !m.pay).map((m) => m.id);
    if (missingPay.length > 0) {
      throw new Error(
        `Cost rules require pay data on all members. Missing pay: ${missingPay.join(", ")}`,
      );
    }
  }

  // Sort rules so minimize-cost compiles before modifier rules
  const sortedRules = sortCostRulesFirst(allRules);
  const ruleConfigs = resolveRules(sortedRules, roles, skills, memberIds);

  return {
    members: config.members,
    shiftPatterns: config.shiftPatterns,
    schedulingPeriod: resolvedPeriod,
    coverage: resolvedCoverage,
    ruleConfigs,
    ruleRegistry: config.ruleRegistry,
    weekStartsOn: config.weekStartsOn,
    solverOptions: buildSolverOptions(options),
    strategy,
  };
}

// ============================================================================
// Internal: Build SolveResult from solver response
// ============================================================================

function resolveSolveStrategy(strategy: unknown): SolveStrategy {
  if (strategy === undefined) {
    return { type: "optimize" };
  }

  if (typeof strategy !== "object" || strategy === null || !("type" in strategy)) {
    throw new Error("Solve strategy must be an object with a type field.");
  }

  const strategyType = (strategy as { type: unknown }).type;
  if (strategyType === "optimize" || strategyType === "feasibility-only") {
    return { type: strategyType };
  }

  throw new Error(`Unknown solve strategy "${String(strategyType)}".`);
}

function buildSolverOptions(options: SolveOptions): SolverRequest["options"] | undefined {
  if (options.timeLimitSeconds === undefined) {
    return undefined;
  }
  return { timeLimitSeconds: options.timeLimitSeconds };
}

function mapSolverStatus(
  solverStatus: SolverResponse["status"],
  strategy: SolveStrategy,
): SolveStatus {
  switch (solverStatus) {
    case "OPTIMAL":
      return strategy.type === "feasibility-only" ? "feasible" : "optimal";
    case "FEASIBLE":
      return "feasible";
    case "INFEASIBLE":
      return "infeasible";
    case "TIMEOUT":
    case "ERROR":
      return "no_solution";
    default:
      return "no_solution";
  }
}

function buildSolveResult(
  response: SolverResponse,
  compiled: CompilationResult & { builder: ModelBuilder },
  config: Readonly<MergedScheduleConfig>,
  strategy: SolveStrategy,
): SolveResult {
  const status = mapSolverStatus(response.status, strategy);
  const hasFinalSolution = status === "optimal" || status === "feasible";
  const parsed = hasFinalSolution
    ? parseSolverResponse(response)
    : {
        status: response.status,
        assignments: [],
        statistics: response.statistics,
        error: response.error,
      };

  compiled.builder.reporter.analyzeSolution(response, {
    analyzeSoftConstraints: strategy.type === "optimize",
  });

  // Run post-solve validation when a solution exists
  if (parsed.assignments.length > 0 && hasFinalSolution && strategy.type === "optimize") {
    const resolved = resolveAssignments(parsed.assignments, compiled.builder.shiftPatterns);
    compiled.builder.validateSolution(resolved);
  }

  const validation = compiled.builder.reporter.getValidation();

  const result: SolveResult = {
    status,
    assignments: parsed.assignments,
    validation,
  };

  // Compute cost breakdown when cost artifacts are present and a solution was found
  if (parsed.assignments.length > 0 && hasFinalSolution && strategy.type === "optimize") {
    const hasCostArtifacts = compiled.builder.rules.some((rule) =>
      rule.artifacts.some((artifact) => artifact.kind === "cost"),
    );
    if (hasCostArtifacts) {
      result.cost = calculateScheduleCost(parsed.assignments, {
        members: config.members,
        shiftPatterns: config.shiftPatterns,
        rules: compiled.builder.rules,
        days: compiled.builder.days,
        weekStartsOn: compiled.builder.weekStartsOn,
      });
    }
  }

  return result;
}

// ============================================================================
// Internal: Coverage Translation
// ============================================================================

function buildCoverageRequirements<T extends string>(
  entries: CoverageEntry<T, string>[],
  roles: Set<string>,
  skills: Set<string>,
): MixedCoverageRequirement<T>[] {
  return entries.map((entry) => {
    // Variant form: produce a VariantCoverageRequirement
    if (entry.variants) {
      return buildVariantCoverageRequirement(entry, roles, skills);
    }

    // Simple form: produce a SemanticCoverageRequirement
    const base: {
      semanticTime: T;
      targetCount: number;
      priority?: Priority;
      dayOfWeek?: [DayOfWeek, ...DayOfWeek[]];
      dates?: DateString[];
    } = {
      semanticTime: entry.timeName,
      targetCount: entry.count,
    };

    if (entry.options.priority) base.priority = entry.options.priority;
    if (entry.options.dayOfWeek && entry.options.dayOfWeek.length > 0) {
      base.dayOfWeek = entry.options.dayOfWeek as [DayOfWeek, ...DayOfWeek[]];
    }
    if (entry.options.dates) base.dates = entry.options.dates;

    return buildSimpleCoverageTarget(entry, base, roles, skills);
  }) as MixedCoverageRequirement<T>[];
}

/**
 * Resolve the target (role/skill) for a simple coverage entry.
 */
function buildSimpleCoverageTarget<T extends string>(
  entry: CoverageEntry<T, string>,
  base: {
    semanticTime: T;
    targetCount: number;
    priority?: Priority;
    dayOfWeek?: [DayOfWeek, ...DayOfWeek[]];
    dates?: DateString[];
  },
  roles: Set<string>,
  skills: Set<string>,
): MixedCoverageRequirement<T> {
  if (Array.isArray(entry.target)) {
    return {
      ...base,
      roleIds: entry.target as [string, ...string[]],
    } satisfies MixedCoverageRequirement<T>;
  }

  const singleTarget = entry.target as string;
  if (roles.has(singleTarget)) {
    if (entry.options.skillIds) {
      return {
        ...base,
        roleIds: [singleTarget] as [string, ...string[]],
        skillIds: entry.options.skillIds,
      } satisfies MixedCoverageRequirement<T>;
    }
    return {
      ...base,
      roleIds: [singleTarget] as [string, ...string[]],
    } satisfies MixedCoverageRequirement<T>;
  }

  if (skills.has(singleTarget)) {
    return {
      ...base,
      skillIds: [singleTarget] as [string, ...string[]],
    } satisfies MixedCoverageRequirement<T>;
  }

  throw new Error(`Coverage target "${singleTarget}" is not a declared role or skill.`);
}

/**
 * Build a VariantCoverageRequirement from a variant-form CoverageEntry.
 */
function requireCoverageVariants<T extends string>(
  entry: CoverageEntry<T, string>,
): [CoverageVariant, ...CoverageVariant[]] {
  if (!entry.variants || entry.variants.length === 0) {
    throw new Error(`Coverage entry for "${entry.timeName}" must define at least one variant.`);
  }

  const first = entry.variants[0];
  if (!first) {
    throw new Error(`Coverage entry for "${entry.timeName}" must define at least one variant.`);
  }

  return [first, ...entry.variants.slice(1)];
}

function buildVariantCoverageRequirement<T extends string>(
  entry: CoverageEntry<T, string>,
  roles: Set<string>,
  skills: Set<string>,
): MixedCoverageRequirement<T> {
  const variants = requireCoverageVariants(entry);

  const resolveTarget = (): {
    roleIds?: [string, ...string[]];
    skillIds?: [string, ...string[]];
  } => {
    if (Array.isArray(entry.target)) {
      return { roleIds: entry.target as [string, ...string[]] };
    }
    const singleTarget = entry.target as string;
    if (roles.has(singleTarget)) {
      return { roleIds: [singleTarget] as [string, ...string[]] };
    }
    if (skills.has(singleTarget)) {
      return { skillIds: [singleTarget] as [string, ...string[]] };
    }
    throw new Error(`Coverage target "${singleTarget}" is not a declared role or skill.`);
  };

  return {
    semanticTime: entry.timeName,
    variants,
    ...resolveTarget(),
  } as MixedCoverageRequirement<T>;
}

// ============================================================================
// Internal: Rule Translation
// ============================================================================

function resolveRules(
  rules: ScheduleRuleEntry<CpsatRuleRegistry>[],
  roles: Set<string>,
  skills: Set<string>,
  memberIds: Set<string>,
): AnyCpsatRuleConfigEntry[] {
  const ctx: RuleResolveContext = { roles, skills, memberIds };

  return rules.map((rule) => {
    // Rules with custom resolvers handle their own translation
    if (rule._resolve) {
      return rule._resolve(ctx) as AnyCpsatRuleConfigEntry;
    }

    // Default resolution: appliesTo → entity scope, dates → specificDates
    const { _type, _rule, _resolve, appliesTo, dates, ...passthrough } = rule as RuleEntry & {
      appliesTo?: string | string[];
      dates?: DateString[];
    };

    const entityScope = resolveAppliesTo(appliesTo, roles, skills, memberIds);
    const resolvedDates = dates ? { specificDates: dates } : {};

    return {
      name: _rule,
      ...passthrough,
      ...entityScope,
      ...resolvedDates,
    } as AnyCpsatRuleConfigEntry;
  }) as AnyCpsatRuleConfigEntry[];
}

// ============================================================================
// Internal: Cost Rule Ordering
// ============================================================================

/**
 * Sorts rules so that `minimize-cost` compiles before cost modifier rules.
 *
 * The `minimize-cost` rule must be compiled first because modifier rules
 * (multipliers, surcharges) reference cost variables it creates.
 * Non-cost rules retain their original relative order.
 */
function sortCostRulesFirst(
  rules: ScheduleRuleEntry<CpsatRuleRegistry>[],
): ScheduleRuleEntry<CpsatRuleRegistry>[] {
  return rules.toSorted((a, b) => {
    const aIsCostBase = a._rule === "minimize-cost" ? 0 : 1;
    const bIsCostBase = b._rule === "minimize-cost" ? 0 : 1;
    return aIsCostBase - bIsCostBase;
  });
}

// ============================================================================
// Internal: Scheduling Period Helpers
// ============================================================================

function applyDaysFilter(
  schedulingPeriod: SchedulingPeriod,
  dayOfWeek?: readonly [DayOfWeek, ...DayOfWeek[]],
): SchedulingPeriod {
  if (!dayOfWeek || dayOfWeek.length === 0) {
    return schedulingPeriod;
  }

  const existingDays = schedulingPeriod.dayOfWeek;
  if (!existingDays || existingDays.length === 0) {
    return { ...schedulingPeriod, dayOfWeek: [...dayOfWeek] };
  }

  const existingSet = new Set(existingDays);
  const intersected = dayOfWeek.filter((day) => existingSet.has(day));
  return { ...schedulingPeriod, dayOfWeek: intersected };
}
