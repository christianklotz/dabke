import type { SolverConstraint, SolverRequest, SolverVariable } from "../client.types.js";
import type { DayOfWeek, SchedulingPeriod } from "../types.js";
import { resolveDaysFromPeriod, toDayOfWeekUTC } from "../datetime.utils.js";
import {
  MINUTES_PER_DAY,
  normalizeEndMinutes,
  OBJECTIVE_WEIGHTS,
  parseDayString,
  priorityToPenalty,
  timeOfDayToMinutes,
} from "./utils.js";
import type {
  CoverageRequirement,
  ModelBuilderOptions,
  ShiftPattern,
  SchedulingMember,
  Term,
} from "./types.js";
import type { CpsatRuleConfigEntry, CpsatRuleFactories } from "./rules/rules.types.js";
import { buildCpsatRules } from "./rules/resolver.js";
import { builtInCpsatRuleFactories } from "./rules/registry.js";
import { ValidationReporterImpl } from "./validation-reporter.js";
import type { ValidationReporter } from "./validation-reporter.js";
import type { ScheduleValidation, CoverageExclusion } from "./validation.types.js";
import type { ShiftAssignment, ResolvedShiftAssignment } from "./response.js";

/**
 * Builds a CP-SAT solver request from high-level scheduling constructs
 * (team, shift patterns, coverage, and rule compilers).
 */
/**
 * Context provided to rules during post-solve validation.
 */
export interface RuleValidationContext {
  readonly members: SchedulingMember[];
  readonly days: string[];
  readonly shiftPatterns: ShiftPattern[];
}

/**
 * A rule that adds constraints or objectives to the solver model.
 *
 * Rules implement `compile` to emit solver constraints during model building,
 * and optionally `validate` to check the solution after solving.
 * Use the `create*Rule` functions to create built-in rules.
 */
export interface CompilationRule {
  /** Emit constraints and objectives into the model builder. */
  compile(builder: ModelBuilder): void;
  /** Validate the solved schedule and report violations. */
  validate?(
    assignments: ResolvedShiftAssignment[],
    reporter: ValidationReporter,
    context: RuleValidationContext,
  ): void;
  /** Compute cost contribution for a solved schedule. */
  cost?(
    assignments: ShiftAssignment[],
    members: ReadonlyArray<SchedulingMember>,
    shiftPatterns: ReadonlyArray<ShiftPattern>,
  ): CostContribution;
}

/**
 * Shared context for cost rules.
 *
 * Set by `minimizeCost()` during compilation, read by modifier rules.
 * When undefined, modifier rules skip emitting solver terms.
 */
export interface CostContext {
  /** Normalization divisor: max raw cost of any single assignment. */
  normalizationFactor: number;
  /** Whether minimizeCost() is active (modifier rules check this). */
  active: boolean;
}

/**
 * A cost entry produced by a rule's `cost()` method.
 *
 * The `category` is an open-ended string. Built-in rules use well-known
 * categories from {@link COST_CATEGORY}. Custom rules can use any string.
 */
export interface CostEntry {
  memberId: string;
  day: string;
  category: string;
  amount: number;
}

/**
 * Cost contribution from a single rule.
 */
export interface CostContribution {
  entries: CostEntry[];
}

export interface CompilationResult {
  request: SolverRequest;
  validation: ScheduleValidation;
  canSolve: boolean;
}

/**
 * Configuration for ModelBuilder.
 *
 * @example Date range with day-of-week filtering (restaurant closed Mon/Tue)
 * ```typescript
 * const config: ModelBuilderConfig = {
 *   members: [...],
 *   shiftPatterns: [...],
 *   coverage: [...],
 *   schedulingPeriod: {
 *     dateRange: { start: '2025-02-03', end: '2025-02-09' },
 *     dayOfWeek: ['wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
 *   },
 * };
 * ```
 */
export interface ModelBuilderConfig extends ModelBuilderOptions {
  /** Team members available for scheduling. */
  members: SchedulingMember[];
  /** Available shift patterns (time slots) that members can be assigned to. */
  shiftPatterns: ShiftPattern[];
  /**
   * Defines when scheduling should occur as a date range with optional
   * `dayOfWeek` and `dates` filters that compose to narrow which days are included.
   */
  schedulingPeriod: SchedulingPeriod;
  coverage: CoverageRequirement[];
  /**
   * Pre-compiled rules; use this for custom rules that are not part of the registry.
   */
  rules?: CompilationRule[];
  /**
   * Named rule configurations that will be compiled using the provided rule factories.
   */
  ruleConfigs?: CpsatRuleConfigEntry[];
  /**
   * Rule factories to use when compiling ruleConfigs. Defaults to built-in CP-SAT rules.
   */
  ruleFactories?: CpsatRuleFactories;
  /**
   * Optional validation reporter for diagnostics.
   */
  reporter?: ValidationReporter;
}

/**
 * Compilation context that creates variables, constraints, and objectives
 * and emits a `SolverRequest` for the Python CP-SAT solver service.
 */
export class ModelBuilder {
  readonly members: SchedulingMember[];
  readonly shiftPatterns: ShiftPattern[];
  readonly days: string[];
  readonly coverage: CoverageRequirement[];
  readonly rules: CompilationRule[];
  readonly weekStartsOn: DayOfWeek;
  readonly options: SolverRequest["options"] | undefined;
  readonly coverageBucketMinutes: number;
  readonly reporter: ValidationReporter;
  readonly fairDistribution: boolean;

  /** Shared context for cost rules. Set by minimizeCost(), read by modifiers. */
  costContext: CostContext | undefined;

  #variables = new Map<string, SolverVariable>();
  #constraints: SolverConstraint[] = [];
  #objective: Term[] = [];
  #dayIndex = new Map<string, number>();
  #shiftPatternMap = new Map<string, ShiftPattern>();
  #builtRequest: SolverRequest | undefined;
  #builtCompilation: CompilationResult | undefined;

  constructor(config: ModelBuilderConfig) {
    // Validate IDs don't contain the separator character
    for (const member of config.members) {
      if (member.id.includes(":")) {
        throw new Error(`Member ID "${member.id}" cannot contain colons`);
      }
    }
    for (const pattern of config.shiftPatterns) {
      if (pattern.id.includes(":")) {
        throw new Error(`Shift pattern ID "${pattern.id}" cannot contain colons`);
      }
    }

    // Validate coverage requirements have at least roles or skills
    for (const cov of config.coverage) {
      const hasRoles = cov.roles !== undefined && cov.roles.length > 0;
      const hasSkills = cov.skills !== undefined && cov.skills.length > 0;
      if (!hasRoles && !hasSkills) {
        throw new Error(
          `Coverage requirement for day "${cov.day}" must have at least one of roles or skills`,
        );
      }
    }

    this.members = config.members;
    this.shiftPatterns = config.shiftPatterns;
    this.days = resolveDaysFromPeriod(config.schedulingPeriod);
    this.coverage = config.coverage;
    const compiledRuleConfigs = config.ruleConfigs
      ? buildCpsatRules(
          config.ruleConfigs,
          this.members,
          config.ruleFactories ?? builtInCpsatRuleFactories,
        )
      : [];
    this.rules = [...compiledRuleConfigs, ...(config.rules ?? [])];
    this.weekStartsOn = config.weekStartsOn ?? "monday";
    this.options = config.solverOptions;
    this.coverageBucketMinutes = config.coverageBucketMinutes ?? 15;
    this.reporter = config.reporter ?? new ValidationReporterImpl();
    this.fairDistribution = config.fairDistribution ?? true;

    this.days.forEach((day, idx) => this.#dayIndex.set(day, idx));
    this.shiftPatterns.forEach((pattern) => this.#shiftPatternMap.set(pattern.id, pattern));
  }

  boolVar(name: string): string {
    const existing = this.#variables.get(name);
    if (existing) {
      if (existing.type !== "bool") {
        throw new Error(`Variable ${name} already exists with different type`);
      }
      return name;
    }

    this.#variables.set(name, { type: "bool", name });
    return name;
  }

  intVar(name: string, min: number, max: number): string {
    const existing = this.#variables.get(name);
    if (existing) {
      if (existing.type !== "int" || existing.min !== min || existing.max !== max) {
        throw new Error(`Variable ${name} already exists with different bounds`);
      }
      return name;
    }

    this.#variables.set(name, { type: "int", name, min, max });
    return name;
  }

  shiftActive(patternId: string, day: string): string {
    return this.boolVar(`shift:${patternId}:${day}`);
  }

  assignment(memberId: string, patternId: string, day: string): string {
    return this.boolVar(`assign:${memberId}:${patternId}:${day}`);
  }

  addLinear(terms: Term[], op: "<=" | ">=" | "==", rhs: number): void {
    this.#constraints.push({ type: "linear", terms, op, rhs });
  }

  addSoftLinear(terms: Term[], op: "<=" | ">=", rhs: number, penalty: number, id?: string): void {
    this.#constraints.push({ type: "soft_linear", terms, op, rhs, penalty, id });
  }

  addExactlyOne(vars: string[]): void {
    if (vars.length === 0) return;
    this.#constraints.push({ type: "exactly_one", vars });
  }

  addAtMostOne(vars: string[]): void {
    if (vars.length === 0) return;
    this.#constraints.push({ type: "at_most_one", vars });
  }

  addImplication(ifVar: string, thenVar: string): void {
    // oxlint-disable-next-line unicorn/no-thenable -- This is a constraint property, not a Promise
    this.#constraints.push({ type: "implication", if: ifVar, then: thenVar });
  }

  addBoolOr(vars: string[]): void {
    if (vars.length === 0) return;
    this.#constraints.push({ type: "bool_or", vars });
  }

  addBoolAnd(vars: string[]): void {
    if (vars.length === 0) return;
    this.#constraints.push({ type: "bool_and", vars });
  }

  intervalVar(
    name: string,
    start: number,
    end: number,
    size: number,
    presenceVar?: string,
  ): string {
    const existing = this.#variables.get(name);
    if (existing) {
      if (existing.type !== "interval") {
        throw new Error(`Variable ${name} already exists with different type`);
      }
      if (
        existing.start !== start ||
        existing.end !== end ||
        existing.size !== size ||
        existing.presenceVar !== presenceVar
      ) {
        throw new Error(`Variable ${name} already exists with different parameters`);
      }
      return name;
    }

    this.#variables.set(name, {
      type: "interval",
      name,
      start,
      end,
      size,
      presenceVar,
    });
    return name;
  }

  addNoOverlap(intervals: string[]): void {
    if (intervals.length === 0) return;
    this.#constraints.push({ type: "no_overlap", intervals });
  }

  addPenalty(varName: string, weight: number): void {
    // CP-SAT requires integer coefficients. Round to nearest integer.
    const rounded = Math.round(weight);
    if (rounded === 0) return;
    this.#objective.push({ var: varName, coeff: rounded });
  }

  membersWithRole(roleId: string): SchedulingMember[] {
    return this.members.filter((m) => m.roles.includes(roleId));
  }

  /**
   * Returns team members who can satisfy a coverage requirement.
   *
   * Matching logic:
   * - If only roles: must have ANY of those roles (OR)
   * - If only skills: must have ALL specified skills (AND)
   * - If both: must have a matching role AND ALL specified skills
   */
  membersForCoverage(cov: CoverageRequirement): SchedulingMember[] {
    return this.members.filter((m) => {
      if (cov.roles && cov.roles.length > 0) {
        const hasMatchingRole = cov.roles.some((role) => m.roles.includes(role));
        if (!hasMatchingRole) {
          return false;
        }
      }
      if (cov.skills && cov.skills.length > 0) {
        const memberSkills = m.skills ?? [];
        if (!cov.skills.every((skill) => memberSkills.includes(skill))) {
          return false;
        }
      }
      return true;
    });
  }

  canAssign(member: SchedulingMember, pattern: ShiftPattern): boolean {
    if (!pattern.roles || pattern.roles.length === 0) {
      return true;
    }
    return pattern.roles.some((role) => member.roles.includes(role));
  }

  /**
   * Checks if a shift pattern can be used on a specific day.
   * Returns false if the pattern has dayOfWeek restrictions that exclude this day.
   */
  patternAvailableOnDay(pattern: ShiftPattern, day: string): boolean {
    // If pattern has no day restrictions, it's available every day
    if (!pattern.dayOfWeek || pattern.dayOfWeek.length === 0) {
      return true;
    }
    // Check if this day's day-of-week is in the allowed list
    const date = parseDayString(day);
    const dow = toDayOfWeekUTC(date);
    return pattern.dayOfWeek.includes(dow);
  }

  patternDuration(patternId: string): number {
    const pattern = this.#shiftPatternMap.get(patternId);
    if (!pattern) throw new Error(`Unknown pattern ${patternId}`);

    const start = timeOfDayToMinutes(pattern.startTime);
    const end = normalizeEndMinutes(start, timeOfDayToMinutes(pattern.endTime));
    return end - start;
  }

  startMinutes(pattern: ShiftPattern, day: string): number {
    const base = this.#dayOffset(day);
    return base + timeOfDayToMinutes(pattern.startTime);
  }

  endMinutes(pattern: ShiftPattern, day: string): number {
    const base = this.#dayOffset(day);
    const startOffset = timeOfDayToMinutes(pattern.startTime);
    const endOffset = normalizeEndMinutes(startOffset, timeOfDayToMinutes(pattern.endTime));
    return base + endOffset;
  }

  compile(): CompilationResult {
    if (this.#builtCompilation) {
      return this.#builtCompilation;
    }

    // 0. Apply all rules first (they may report exclusions and add constraints)
    for (const rule of this.rules) {
      rule.compile(this);
    }

    // Build exclusion lookup from reporter (populated by rules during compile)
    const mandatoryExclusions = buildExclusionLookup(this.reporter.getExclusions());

    // 1. Assignment implies shift is active
    for (const emp of this.members) {
      for (const pattern of this.shiftPatterns) {
        if (!this.canAssign(emp, pattern)) continue;
        for (const day of this.days) {
          if (!this.patternAvailableOnDay(pattern, day)) continue;
          this.addImplication(
            this.assignment(emp.id, pattern.id, day),
            this.shiftActive(pattern.id, day),
          );
        }
      }
    }

    // 1b. Build optional interval variables for assignments and prevent overlaps.
    // One optional interval per (person, pattern, day) assignment.
    for (const emp of this.members) {
      const empIntervals: string[] = [];

      for (const pattern of this.shiftPatterns) {
        if (!this.canAssign(emp, pattern)) continue;

        for (const day of this.days) {
          if (!this.patternAvailableOnDay(pattern, day)) continue;
          const presenceVar = this.assignment(emp.id, pattern.id, day);
          const start = this.startMinutes(pattern, day);
          const end = this.endMinutes(pattern, day);
          const size = end - start;

          const intervalName = `interval:${emp.id}:${pattern.id}:${day}`;
          this.intervalVar(intervalName, start, end, size, presenceVar);
          empIntervals.push(intervalName);
        }
      }

      this.addNoOverlap(empIntervals);
    }

    // 2. Coverage requirements (bucketed, time-indexed)
    // Coverage requirements are expressed independently from shift patterns.
    // We discretize each requirement into fixed-size buckets (default: 15 minutes)
    // and ensure enough people are working in EACH bucket.
    //
    // This supports staggered overlapping shifts, where multiple patterns together
    // can satisfy the coverage window.
    const bucket = this.coverageBucketMinutes;
    const allowedBuckets = new Set([5, 10, 15, 30, 60]);
    if (!Number.isInteger(bucket) || !allowedBuckets.has(bucket)) {
      throw new Error(
        `coverageBucketMinutes must be one of ${[...allowedBuckets].join(", ")}, got ${bucket}`,
      );
    }

    // Precompute pattern time ranges and which patterns overlap each bucket start.
    // Patterns are day-invariant (same time-of-day every day), so we can compute once.
    const patternRanges = this.shiftPatterns.map((p) => {
      const start = timeOfDayToMinutes(p.startTime);
      const end = normalizeEndMinutes(start, timeOfDayToMinutes(p.endTime));
      return { pattern: p, start, end };
    });

    const patternsByBucketStart = new Map<number, ShiftPattern[]>();
    for (let t = 0; t < MINUTES_PER_DAY; t += bucket) {
      const bucketStart = t;
      const bucketEnd = Math.min(t + bucket, MINUTES_PER_DAY);

      const patterns: ShiftPattern[] = [];
      for (const { pattern, start, end } of patternRanges) {
        // Standard overlap check
        const standardOverlap = Math.max(start, bucketStart) < Math.min(end, bucketEnd);
        // Overnight pattern wrap-around check: if pattern ends past midnight (end > MINUTES_PER_DAY),
        // the bucket also overlaps if it falls in the early morning portion (0 to end - MINUTES_PER_DAY)
        const wrapAroundOverlap = end > MINUTES_PER_DAY && bucketStart < end - MINUTES_PER_DAY;
        if (standardOverlap || wrapAroundOverlap) patterns.push(pattern);
      }
      patternsByBucketStart.set(bucketStart, patterns);
    }

    for (const cov of this.coverage) {
      const covStart = timeOfDayToMinutes(cov.startTime);
      const covEnd = normalizeEndMinutes(covStart, timeOfDayToMinutes(cov.endTime));
      const covKey = cov.roles?.join(",") ?? cov.skills?.join(",") ?? "unknown";
      const coverageLabel =
        cov.roles && cov.roles.length > 0
          ? cov.roles.length === 1
            ? `role "${cov.roles[0]}"`
            : `role "${cov.roles.join(" or ")}"`
          : `skills [${cov.skills?.join(", ")}]`;
      const coverageWindow = formatTimeRange(covStart, covEnd);

      const eligibleMembers = this.membersForCoverage(cov);
      if (eligibleMembers.length === 0) {
        if (cov.priority === "MANDATORY" && cov.targetCount > 0) {
          this.reporter.reportCoverageError({
            day: cov.day,
            timeSlots: [coverageWindow],
            roles: cov.roles,
            skills: cov.skills,
            reason: `Coverage for ${coverageLabel} on ${cov.day} (${coverageWindow}) cannot be met: no eligible team members available.`,
            suggestions: [
              cov.roles && cov.roles.length > 0
                ? `Add team members with role "${cov.roles.join(" or ")}"`
                : "Add team members with the required skills",
              "Change the coverage requirement to match available team members",
            ],
            group: cov.group,
          });

          const impossibleVar = `infeasible:coverage:${covKey}:${cov.day}`;
          this.intVar(impossibleVar, 0, 0);
          this.addLinear([{ var: impossibleVar, coeff: 1 }], ">=", cov.targetCount);
        }
        continue;
      }

      const bucketIssues = new Map<string, BucketIssueGroup>();

      for (let t = covStart; t < covEnd; t += bucket) {
        const bucketStart = t;
        const bucketEnd = Math.min(t + bucket, covEnd);
        // For overnight coverage (times >= MINUTES_PER_DAY), wrap around to find
        // which shift patterns overlap. E.g., 25:00 wraps to 01:00.
        const lookupBucketStart = bucketStart % MINUTES_PER_DAY;
        // Get patterns that overlap this time bucket, then filter by day availability
        const allPatterns = patternsByBucketStart.get(lookupBucketStart) ?? [];
        const patterns = allPatterns.filter((p) => this.patternAvailableOnDay(p, cov.day));

        if (patterns.length === 0) {
          recordBucketIssue(
            bucketIssues,
            {
              key: "no_patterns",
              severity: cov.priority === "MANDATORY" ? "impossible" : "warning",
              reason: "no shift patterns overlap this time",
              suggestions: [
                "Add shift patterns that overlap this coverage window",
                "Adjust the coverage window to match available shifts",
              ],
            },
            bucketStart,
          );

          if (cov.priority === "MANDATORY" && cov.targetCount > 0) {
            const impossibleVar = `infeasible:coverage:${covKey}:${cov.day}:${bucketStart}`;
            this.intVar(impossibleVar, 0, 0);
            this.addLinear([{ var: impossibleVar, coeff: 1 }], ">=", cov.targetCount);
          }
          continue;
        }

        const assignableMembers = new Set<string>();
        for (const emp of eligibleMembers) {
          for (const pattern of patterns) {
            if (!this.canAssign(emp, pattern)) continue;
            assignableMembers.add(emp.id);
            break;
          }
        }

        if (assignableMembers.size === 0) {
          recordBucketIssue(
            bucketIssues,
            {
              key: "no_assignable",
              severity: cov.priority === "MANDATORY" ? "impossible" : "warning",
              reason: "no eligible team members can work overlapping shift patterns",
              suggestions: [
                "Adjust shift pattern role requirements",
                "Add shift patterns that eligible team members can work",
              ],
            },
            bucketStart,
          );

          if (cov.priority === "MANDATORY" && cov.targetCount > 0) {
            const impossibleVar = `infeasible:coverage:${covKey}:${cov.day}:${bucketStart}`;
            this.intVar(impossibleVar, 0, 0);
            this.addLinear([{ var: impossibleVar, coeff: 1 }], ">=", cov.targetCount);
          }
          continue;
        }

        const availableMembers = new Set<string>();
        for (const memberId of assignableMembers) {
          const exclusions = mandatoryExclusions.get(`${memberId}:${cov.day}`) ?? [];
          const blocked = exclusions.some((exclusion) =>
            rangesOverlap(exclusion.startMinutes, exclusion.endMinutes, bucketStart, bucketEnd),
          );
          if (!blocked) {
            availableMembers.add(memberId);
          }
        }

        if (availableMembers.size === 0) {
          recordBucketIssue(
            bucketIssues,
            {
              key: "mandatory_time_off",
              severity: cov.priority === "MANDATORY" ? "impossible" : "warning",
              reason: "all eligible team members are on mandatory time off",
              suggestions: [
                "Adjust mandatory time-off requests",
                "Add more team members with the required role or skills",
              ],
            },
            bucketStart,
          );
        } else if (availableMembers.size < cov.targetCount) {
          recordBucketIssue(
            bucketIssues,
            {
              key: `insufficient:${availableMembers.size}`,
              severity: cov.priority === "MANDATORY" ? "impossible" : "warning",
              reason: `only ${availableMembers.size} team members available, need ${cov.targetCount}`,
              suggestions: [
                "Add more team members with the required role or skills",
                `Reduce coverage target to ${availableMembers.size}`,
              ],
              values: { required: cov.targetCount, available: availableMembers.size },
            },
            bucketStart,
          );
        }

        const coveringVarsSet = new Set<string>();
        for (const pattern of patterns) {
          for (const emp of eligibleMembers) {
            if (!this.canAssign(emp, pattern)) continue;
            coveringVarsSet.add(this.assignment(emp.id, pattern.id, cov.day));
          }
        }

        const coveringVars = [...coveringVarsSet];
        if (coveringVars.length === 0) {
          continue;
        }

        const terms = coveringVars.map((v) => ({ var: v, coeff: 1 }));

        const constraintId = `coverage:${covKey}:${cov.day}:${bucketStart}`;

        if (cov.priority === "MANDATORY") {
          this.addLinear(terms, ">=", cov.targetCount);
        } else {
          this.addSoftLinear(
            terms,
            ">=",
            cov.targetCount,
            priorityToPenalty(cov.priority),
            constraintId,
          );
        }

        // Track all coverage constraints (mandatory and soft) for post-solve reporting
        this.reporter.trackConstraint({
          id: constraintId,
          type: "coverage",
          description: `${cov.targetCount}x ${covKey} on ${cov.day} at ${formatMinutes(bucketStart)}`,
          targetValue: cov.targetCount,
          comparator: ">=",
          day: cov.day,
          timeSlot: formatMinutes(bucketStart),
          roles: cov.roles,
          skills: cov.skills,
          context: {
            days: [cov.day],
            memberIds: eligibleMembers.map((e) => e.id),
          },
          group: cov.group,
        });
      }

      for (const issue of bucketIssues.values()) {
        const ranges = bucketStartsToRanges(issue.bucketStarts, bucket, covEnd).map(
          (range) => `${formatMinutes(range.start)}-${formatMinutes(range.end)}`,
        );
        if (ranges.length === 0) continue;

        const reason = `Coverage for ${coverageLabel} on ${cov.day} (${ranges.join(", ")}) cannot be met: ${issue.reason}.`;

        if (issue.severity === "impossible") {
          this.reporter.reportCoverageError({
            day: cov.day,
            timeSlots: ranges,
            roles: cov.roles,
            skills: cov.skills,
            reason,
            suggestions: issue.suggestions,
            group: cov.group,
          });
        }
        // Note: soft coverage warnings are tracked via trackConstraint and reported post-solve
      }
    }

    // 3. Default objective: shift minimization with optional fair distribution
    //
    // The objective has three components (see OBJECTIVE_WEIGHTS in utils.ts):
    // a) Minimize number of active shift patterns (SHIFT_ACTIVE=1000)
    // b) Fair distribution (FAIRNESS=5) - minimizes max shifts per person
    // c) Minimize total assignments (ASSIGNMENT_BASE=1) - tiebreaker
    //
    // Weight hierarchy ensures:
    // - SHIFT_ACTIVE >> ASSIGNMENT_PREFERENCE > FAIRNESS > ASSIGNMENT_BASE
    // - Business preferences (±10/shift) override fairness (5 for max)
    // - Fairness overrides pure tiebreaker behavior

    // 3a. Minimize number of active shift patterns (reduces fragmentation)
    for (const pattern of this.shiftPatterns) {
      for (const day of this.days) {
        if (!this.patternAvailableOnDay(pattern, day)) continue;
        this.addPenalty(this.shiftActive(pattern.id, day), OBJECTIVE_WEIGHTS.SHIFT_ACTIVE);
      }
    }

    // 3b. Fair distribution: minimize the maximum shifts any person works
    //
    // When enabled, we use the min-max approach: create an auxiliary variable
    // representing the maximum shifts any person works, constrain each person's
    // total to be <= this max, then minimize it.
    //
    // The FAIRNESS weight (5) is weaker than ASSIGNMENT_PREFERENCE (10), so explicit
    // preferences like "prefer permanent staff over temps" will override fairness.
    if (this.fairDistribution && this.members.length > 1) {
      const maxPossibleAssignments = this.days.length * this.shiftPatterns.length;
      const maxAssignmentsVar = this.intVar("fairness:max_assignments", 0, maxPossibleAssignments);

      for (const emp of this.members) {
        const terms: Term[] = [];
        for (const pattern of this.shiftPatterns) {
          if (!this.canAssign(emp, pattern)) continue;
          for (const day of this.days) {
            if (!this.patternAvailableOnDay(pattern, day)) continue;
            terms.push({ var: this.assignment(emp.id, pattern.id, day), coeff: 1 });
          }
        }
        if (terms.length > 0) {
          // person's total assignments <= maxAssignmentsVar
          terms.push({ var: maxAssignmentsVar, coeff: -1 });
          this.addLinear(terms, "<=", 0);
        }
      }

      this.addPenalty(maxAssignmentsVar, OBJECTIVE_WEIGHTS.FAIRNESS);
    }

    // 3c. Minimize total assignments (tiebreaker)
    for (const emp of this.members) {
      for (const pattern of this.shiftPatterns) {
        if (!this.canAssign(emp, pattern)) continue;
        for (const day of this.days) {
          if (!this.patternAvailableOnDay(pattern, day)) continue;
          this.addPenalty(
            this.assignment(emp.id, pattern.id, day),
            OBJECTIVE_WEIGHTS.ASSIGNMENT_BASE,
          );
        }
      }
    }

    this.#builtRequest = this.#buildRequest();
    this.#builtCompilation = {
      request: this.#builtRequest,
      validation: this.reporter.getValidation(),
      canSolve: !this.reporter.hasErrors(),
    };
    return this.#builtCompilation;
  }

  /**
   * Run post-solve validation on all rules.
   * Call this after solving with the resolved assignments.
   */
  validateSolution(assignments: ResolvedShiftAssignment[]): void {
    const context: RuleValidationContext = {
      members: this.members,
      days: this.days,
      shiftPatterns: this.shiftPatterns,
    };

    for (const rule of this.rules) {
      rule.validate?.(assignments, this.reporter, context);
    }
  }

  #buildRequest(): SolverRequest {
    return {
      variables: Array.from(this.#variables.values()),
      constraints: this.#constraints,
      objective:
        this.#objective.length > 0 ? { sense: "minimize", terms: this.#objective } : undefined,
      options: this.options,
    };
  }

  #dayOffset(day: string): number {
    const idx = this.#dayIndex.get(day);
    if (idx === undefined) {
      throw new Error(`Unknown day '${day}'`);
    }
    return idx * MINUTES_PER_DAY;
  }
}

type BucketIssueGroup = {
  key: string;
  severity: "impossible" | "warning";
  reason: string;
  suggestions: string[];
  bucketStarts: number[];
  values?: Record<string, number>;
};

type ExclusionWindow = {
  startMinutes: number;
  endMinutes: number;
};

function recordBucketIssue(
  bucketIssues: Map<string, BucketIssueGroup>,
  issue: Omit<BucketIssueGroup, "bucketStarts">,
  bucketStart: number,
): void {
  const existing = bucketIssues.get(issue.key);
  if (existing) {
    existing.bucketStarts.push(bucketStart);
    return;
  }
  bucketIssues.set(issue.key, { ...issue, bucketStarts: [bucketStart] });
}

function buildExclusionLookup(exclusions: CoverageExclusion[]): Map<string, ExclusionWindow[]> {
  const lookup = new Map<string, ExclusionWindow[]>();
  for (const exclusion of exclusions) {
    // If no time specified, exclude entire day
    const startMinutes = exclusion.startTime ? timeOfDayToMinutes(exclusion.startTime) : 0;
    const rawEndMinutes = exclusion.endTime
      ? timeOfDayToMinutes(exclusion.endTime)
      : MINUTES_PER_DAY;
    const endMinutes = normalizeEndMinutes(startMinutes, rawEndMinutes);
    const key = `${exclusion.memberId}:${exclusion.day}`;
    const existing = lookup.get(key);
    const window = { startMinutes, endMinutes };
    if (existing) {
      existing.push(window);
    } else {
      lookup.set(key, [window]);
    }
  }
  return lookup;
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return Math.max(startA, startB) < Math.min(endA, endB);
}

function bucketStartsToRanges(
  bucketStarts: number[],
  bucketSize: number,
  coverageEnd: number,
): Array<{ start: number; end: number }> {
  if (bucketStarts.length === 0) return [];
  const sorted = [...bucketStarts].toSorted((a, b) => a - b);
  const ranges: Array<{ start: number; end: number }> = [];
  let currentStart = sorted[0] ?? 0;
  let currentEnd = Math.min(currentStart + bucketSize, coverageEnd);

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (next === undefined) continue;
    if (next <= currentEnd) {
      currentEnd = Math.min(next + bucketSize, coverageEnd);
    } else {
      ranges.push({ start: currentStart, end: currentEnd });
      currentStart = next;
      currentEnd = Math.min(next + bucketSize, coverageEnd);
    }
  }
  ranges.push({ start: currentStart, end: currentEnd });
  return ranges;
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function formatTimeRange(start: number, end: number): string {
  return `${formatMinutes(start)}-${formatMinutes(end)}`;
}
