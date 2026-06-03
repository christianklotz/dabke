import type {
  SolverConstraint,
  SolverObjectiveStage,
  SolverRequest,
  SolverVariable,
} from "../client.types.js";
import type { DayOfWeek, SchedulingDay, SchedulingPeriod } from "../types.js";
import { resolveDaysFromPeriod } from "../datetime.utils.js";
import {
  MINUTES_PER_DAY,
  normalizeEndMinutes,
  OBJECTIVE_WEIGHTS,
  priorityToPenalty,
  timeOfDayToMinutes,
} from "./utils.js";
import type {
  CoverageRequirement,
  ModelBuilderOptions,
  ModelSolveStrategy,
  ShiftPattern,
  SchedulingMember,
  Term,
} from "./types.js";
import type {
  AnyCpsatRuleConfigEntry,
  BuiltInCpsatRuleRegistry,
  CpsatRuleConfigEntry,
  CpsatRuleRegistry,
} from "./rules/rules.types.js";
import { buildCpsatRules } from "./rules/resolver.js";
import { builtInCpsatRuleRegistry } from "./rules/registry.js";
import { TARGET_PEAK_CONCURRENT_ASSIGNMENTS_OBJECTIVE_STAGE_ID } from "./rules/target-peak-concurrent-assignments.js";
import { ValidationReporterImpl } from "./validation-reporter.js";
import type { ValidationReporter } from "./validation-reporter.js";
import type { ScheduleValidation, CoverageExclusion } from "./validation.types.js";
import type { ShiftAssignment, ResolvedShiftAssignment } from "./response.js";
import type {
  CompiledRule,
  CostArtifact,
  CostContribution,
  PostSolveFeedbackArtifact,
  RuleArtifact,
  RuleCompileContext,
} from "./rule-descriptor.js";

type BoundRuleArtifact = {
  readonly rule: string;
  readonly artifact: RuleArtifact;
};

const UNSTAGED_OBJECTIVE_STAGE_ID = "__dabke_unstaged__";

/**
 * Builds a CP-SAT solver request from high-level scheduling constructs
 * (team, shift patterns, coverage, and rule compilers).
 */
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
 * Result of {@link ModelBuilder.compile}.
 *
 * @category Model Builder
 */
export interface CompilationResult {
  request: SolverRequest;
  validation: ScheduleValidation;
  canSolve: boolean;
}

/**
 * Configuration for ModelBuilder.
 *
 * @category Model Builder
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
/**
 * Configuration for {@link ModelBuilder}.
 *
 * @remarks
 * The optional `Registry` generic keeps `ruleConfigs` type-safe for custom rule
 * registries. When omitted, the config defaults to the built-in CP-SAT registry.
 *
 * @category Model Builder
 */
export interface ModelBuilderConfig<
  Registry extends CpsatRuleRegistry = BuiltInCpsatRuleRegistry,
  RuleConfigEntry extends AnyCpsatRuleConfigEntry = CpsatRuleConfigEntry<Registry>,
> extends ModelBuilderOptions {
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
  rules?: CompiledRule[];
  /**
   * Named rule configurations that will be compiled using the provided rule registry.
   */
  ruleConfigs?: RuleConfigEntry[];
  /**
   * Rule registry to use when compiling ruleConfigs. Defaults to the built-in CP-SAT registry.
   */
  ruleRegistry?: Registry;
  /**
   * Optional validation reporter for validation feedback.
   */
  reporter?: ValidationReporter;
}

/**
 * Compilation context that creates variables, constraints, and objectives
 * and emits a `SolverRequest` for the Python CP-SAT solver service.
 *
 * @category Model Builder
 */
export class ModelBuilder {
  readonly members: SchedulingMember[];
  readonly shiftPatterns: ShiftPattern[];
  readonly days: SchedulingDay[];
  readonly coverage: CoverageRequirement[];
  readonly rules: CompiledRule[];
  readonly weekStartsOn: DayOfWeek;
  readonly options: SolverRequest["options"] | undefined;
  readonly strategy: ModelSolveStrategy;
  readonly coverageBucketMinutes: number;
  readonly reporter: ValidationReporter;
  readonly fairDistribution: boolean;

  /** Shared context for cost rules. Set by minimizeCost(), read by modifiers. */
  costContext: CostContext | undefined;

  #variables = new Map<string, SolverVariable>();
  #constraints: SolverConstraint[] = [];
  #objective: Term[] = [];
  #objectiveStageTerms = new Map<string, Term[]>();
  #referencedObjectiveStages = new Set<string>();
  #objectiveStageOrder: readonly string[] | undefined;
  #dayIndex = new Map<string, number>();
  #dayByIso = new Map<string, SchedulingDay>();
  #shiftPatternMap = new Map<string, ShiftPattern>();
  #builtRequest: SolverRequest | undefined;
  #builtCompilation: CompilationResult | undefined;
  #compiledArtifacts: BoundRuleArtifact[] = [];
  #postSolveValidators: PostSolveFeedbackArtifact[] = [];
  #costArtifacts: CostArtifact[] = [];

  constructor(config: ModelBuilderConfig<CpsatRuleRegistry, AnyCpsatRuleConfigEntry>) {
    // Validate IDs don't contain the separator character
    for (const member of config.members) {
      if (member.id.includes(":")) {
        throw new Error(`Member ID "${member.id}" cannot contain colons`);
      }
      for (const roleId of member.roleIds) {
        if (roleId.includes(":")) {
          throw new Error(`Role ID "${roleId}" cannot contain colons`);
        }
      }
    }
    for (const pattern of config.shiftPatterns) {
      if (pattern.id.includes(":")) {
        throw new Error(`Shift pattern ID "${pattern.id}" cannot contain colons`);
      }
      for (const roleId of pattern.roleIds ?? []) {
        if (roleId.includes(":")) {
          throw new Error(`Role ID "${roleId}" cannot contain colons`);
        }
      }
    }

    // Validate coverage requirements have at least roles or skills
    for (const cov of config.coverage) {
      const hasRoles = cov.roleIds !== undefined && cov.roleIds.length > 0;
      const hasSkills = cov.skillIds !== undefined && cov.skillIds.length > 0;
      if (!hasRoles && !hasSkills) {
        throw new Error(
          `Coverage requirement for day "${cov.day}" must have at least one of roles or skills`,
        );
      }
      for (const roleId of cov.roleIds ?? []) {
        if (roleId.includes(":")) {
          throw new Error(`Role ID "${roleId}" cannot contain colons`);
        }
      }
    }

    this.members = config.members;
    this.shiftPatterns = config.shiftPatterns;
    this.days = resolveDaysFromPeriod(config.schedulingPeriod);
    this.coverage = config.coverage;
    const ruleCompileContext: RuleCompileContext = {
      members: this.members,
      shiftPatterns: this.shiftPatterns,
      days: this.days,
      weekStartsOn: config.weekStartsOn ?? "monday",
      coverageBucketMinutes: config.coverageBucketMinutes ?? 15,
    };
    const compiledRuleConfigs = config.ruleConfigs
      ? buildCpsatRules(
          config.ruleConfigs,
          this.members,
          ruleCompileContext,
          config.ruleRegistry ?? builtInCpsatRuleRegistry,
        )
      : [];
    this.rules = [...compiledRuleConfigs, ...(config.rules ?? [])];
    this.weekStartsOn = config.weekStartsOn ?? "monday";
    this.options = config.solverOptions;
    this.strategy = resolveModelSolveStrategy(config.strategy);
    this.#objectiveStageOrder =
      config.objectiveStageOrder === undefined ? undefined : [...config.objectiveStageOrder];
    this.coverageBucketMinutes = config.coverageBucketMinutes ?? 15;
    this.reporter = config.reporter ?? new ValidationReporterImpl();
    this.fairDistribution = config.fairDistribution ?? true;

    this.days.forEach((day, idx) => {
      this.#dayIndex.set(day.iso, idx);
      this.#dayByIso.set(day.iso, day);
    });
    this.shiftPatterns.forEach((pattern) => this.#shiftPatternMap.set(pattern.id, pattern));
    this.#compiledArtifacts = this.rules.flatMap((rule) =>
      rule.artifacts.map((artifact) => ({ rule: rule.rule, artifact })),
    );
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

  shiftActive(patternId: string, day: SchedulingDay): string {
    return this.boolVar(`shift:${patternId}:${day.iso}`);
  }

  /**
   * Returns the aggregate shift assignment variable for a member, pattern, and day.
   *
   * @remarks
   * This variable means "the member works this shift pattern on this day". It is
   * the presence literal for optional interval variables and the common variable
   * used by shift-level rules, objectives, and skill-only coverage. Role-specific
   * assignments are modeled separately and linked to this aggregate variable when
   * a concrete role choice is available.
   */
  assignment(memberId: string, patternId: string, day: SchedulingDay): string {
    return this.boolVar(`assign:${memberId}:${patternId}:${day.iso}`);
  }

  /** Returns the role-specific assignment variable for a concrete role choice. */
  #roleAssignment(memberId: string, patternId: string, roleId: string, day: SchedulingDay): string {
    return this.boolVar(`assign_role:${memberId}:${patternId}:${roleId}:${day.iso}`);
  }

  addLinear(terms: Term[], op: "<=" | ">=" | "==", rhs: number, id?: string): void {
    const constraint: SolverConstraint =
      id === undefined
        ? { type: "linear", terms, op, rhs }
        : { type: "linear", terms, op, rhs, id };
    this.#constraints.push(constraint);
  }

  addSoftLinear(
    terms: Term[],
    op: "<=" | ">=",
    rhs: number,
    penalty: number,
    id?: string,
    stage?: string,
  ): void {
    if (!this.#isOptimizing()) {
      return;
    }
    this.#markObjectiveStageReference(stage);
    const constraint: SolverConstraint =
      stage === undefined
        ? { type: "soft_linear", terms, op, rhs, penalty, id }
        : { type: "soft_linear", terms, op, rhs, penalty, id, stage };
    this.#constraints.push(constraint);
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
    this.#addPenalty(varName, weight);
  }

  #addPenalty(varName: string, weight: number, stage?: string): void {
    if (!this.#isOptimizing()) {
      return;
    }
    this.#markObjectiveStageReference(stage);
    // CP-SAT requires integer coefficients. Round to nearest integer.
    const rounded = Math.round(weight);
    if (rounded === 0) return;
    const term = { var: varName, coeff: rounded };
    if (stage !== undefined) {
      const stageTerms = this.#objectiveStageTerms.get(stage) ?? [];
      stageTerms.push(term);
      this.#objectiveStageTerms.set(stage, stageTerms);
      return;
    }
    this.#objective.push(term);
  }

  membersWithRole(roleId: string): SchedulingMember[] {
    return this.members.filter((m) => m.roleIds.includes(roleId));
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
      if (cov.roleIds && cov.roleIds.length > 0) {
        const hasMatchingRole = cov.roleIds.some((role) => m.roleIds.includes(role));
        if (!hasMatchingRole) {
          return false;
        }
      }
      if (cov.skillIds && cov.skillIds.length > 0) {
        const memberSkills = m.skillIds ?? [];
        if (!cov.skillIds.every((skill) => memberSkills.includes(skill))) {
          return false;
        }
      }
      return true;
    });
  }

  canAssign(member: SchedulingMember, pattern: ShiftPattern): boolean {
    if (!pattern.roleIds || pattern.roleIds.length === 0) {
      return true;
    }
    return pattern.roleIds.some((role) => member.roleIds.includes(role));
  }

  #assignableRoleIds(member: SchedulingMember, pattern: ShiftPattern): string[] {
    const patternRoleIds = pattern.roleIds;
    const roles =
      patternRoleIds && patternRoleIds.length > 0
        ? member.roleIds.filter((roleId) => patternRoleIds.includes(roleId))
        : member.roleIds;

    return [...new Set(roles)];
  }

  /**
   * Returns the variables that can satisfy one coverage bucket for this member and pattern.
   *
   * Role coverage uses role-specific variables so a single shift assignment fills
   * one concrete role. Skill-only coverage has no role to choose, so it uses the
   * aggregate assignment variable directly.
   */
  #coverageRoleAssignmentVars(
    member: SchedulingMember,
    pattern: ShiftPattern,
    cov: CoverageRequirement,
    day: SchedulingDay,
  ): string[] {
    if (!cov.roleIds || cov.roleIds.length === 0) {
      return [this.assignment(member.id, pattern.id, day)];
    }

    const assignableRoles = this.#assignableRoleIds(member, pattern);
    const coverageRoles = assignableRoles.filter((roleId) => cov.roleIds.includes(roleId));

    return coverageRoles.map((roleId) => this.#roleAssignment(member.id, pattern.id, roleId, day));
  }

  #canCoverCoverage(
    member: SchedulingMember,
    pattern: ShiftPattern,
    cov: CoverageRequirement,
  ): boolean {
    const assignableRoles = this.#assignableRoleIds(member, pattern);
    if (cov.roleIds && cov.roleIds.length > 0) {
      return assignableRoles.some((roleId) => cov.roleIds.includes(roleId));
    }
    return true;
  }

  /**
   * Checks if a shift pattern can be used on a specific day.
   * Returns false if the pattern has dayOfWeek restrictions that exclude this day.
   */
  patternAvailableOnDay(pattern: ShiftPattern, day: SchedulingDay): boolean {
    if (!pattern.dayOfWeek || pattern.dayOfWeek.length === 0) {
      return true;
    }
    return pattern.dayOfWeek.includes(day.dayOfWeek);
  }

  patternDuration(patternId: string): number {
    const pattern = this.#shiftPatternMap.get(patternId);
    if (!pattern) throw new Error(`Unknown pattern ${patternId}`);

    const start = timeOfDayToMinutes(pattern.startTime);
    const end = normalizeEndMinutes(start, timeOfDayToMinutes(pattern.endTime));
    return end - start;
  }

  startMinutes(pattern: ShiftPattern, day: SchedulingDay): number {
    const base = this.#dayOffset(day.iso);
    return base + timeOfDayToMinutes(pattern.startTime);
  }

  endMinutes(pattern: ShiftPattern, day: SchedulingDay): number {
    const base = this.#dayOffset(day.iso);
    const startOffset = timeOfDayToMinutes(pattern.startTime);
    const endOffset = normalizeEndMinutes(startOffset, timeOfDayToMinutes(pattern.endTime));
    return base + endOffset;
  }

  compile(): CompilationResult {
    if (this.#builtCompilation) {
      return this.#builtCompilation;
    }

    this.#runRulePrechecks();
    this.#applyRuleArtifacts();

    // Build exclusion lookup from rule artifacts for coverage feasibility analysis.
    const mandatoryExclusions = buildExclusionLookup(this.reporter.getExclusions());

    // Link concrete role choices to the aggregate assignment used by intervals and
    // shift-level rules. This is the CP-SAT channeling pattern: exactly one role
    // literal is true iff the aggregate assignment is true. Role-less members on
    // unrestricted shifts deliberately skip this link; skill-only coverage uses
    // the aggregate variable directly because there is no role decision to report.
    for (const emp of this.members) {
      for (const pattern of this.shiftPatterns) {
        if (!this.canAssign(emp, pattern)) continue;
        for (const day of this.days) {
          if (!this.patternAvailableOnDay(pattern, day)) continue;
          const assignmentVar = this.assignment(emp.id, pattern.id, day);
          const roleTerms = this.#assignableRoleIds(emp, pattern).map((roleId) => ({
            var: this.#roleAssignment(emp.id, pattern.id, roleId, day),
            coeff: 1,
          }));
          if (roleTerms.length === 0) continue;

          this.addLinear([...roleTerms, { var: assignmentVar, coeff: -1 }], "==", 0);
        }
      }
    }

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

          const intervalName = `interval:${emp.id}:${pattern.id}:${day.iso}`;
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
      const covDay = this.#dayByIso.get(cov.day);
      if (!covDay) continue;
      const covStart = timeOfDayToMinutes(cov.startTime);
      const covEnd = normalizeEndMinutes(covStart, timeOfDayToMinutes(cov.endTime));
      const covKey = cov.roleIds?.join(",") ?? cov.skillIds?.join(",") ?? "unknown";
      const coverageLabel =
        cov.roleIds && cov.roleIds.length > 0
          ? cov.roleIds.length === 1
            ? `role "${cov.roleIds[0]}"`
            : `role "${cov.roleIds.join(" or ")}"`
          : `skills [${cov.skillIds?.join(", ")}]`;
      const coverageWindow = formatTimeRange(covStart, covEnd);

      const eligibleMembers = this.membersForCoverage(cov);
      if (eligibleMembers.length === 0) {
        if (cov.priority === "MANDATORY" && cov.targetCount > 0) {
          this.reporter.reportCoverageError({
            day: cov.day,
            timeSlots: [coverageWindow],
            roleIds: cov.roleIds,
            skillIds: cov.skillIds,
            message: `Coverage for ${coverageLabel} on ${cov.day} (${coverageWindow}) cannot be met: no eligible team members available.`,
            suggestions: [
              cov.roleIds && cov.roleIds.length > 0
                ? `Add team members with role "${cov.roleIds.join(" or ")}"`
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
        const patterns = allPatterns.filter((p) => this.patternAvailableOnDay(p, covDay));

        if (patterns.length === 0) {
          recordBucketIssue(
            bucketIssues,
            {
              key: "no_patterns",
              severity: cov.priority === "MANDATORY" ? "impossible" : "warning",
              message: "no shift patterns overlap this time",
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
            if (!this.#canCoverCoverage(emp, pattern, cov)) continue;
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
              message: "no eligible team members can work overlapping shift patterns",
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
              message: "all eligible team members are on mandatory time off",
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
              message: `only ${availableMembers.size} team members available, need ${cov.targetCount}`,
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
            for (const roleAssignment of this.#coverageRoleAssignmentVars(
              emp,
              pattern,
              cov,
              covDay,
            )) {
              coveringVarsSet.add(roleAssignment);
            }
          }
        }

        const coveringVars = [...coveringVarsSet];
        if (coveringVars.length === 0) {
          continue;
        }

        const terms = coveringVars.map((v) => ({ var: v, coeff: 1 }));

        const constraintId = `coverage:${covKey}:${cov.day}:${bucketStart}`;

        if (cov.priority === "MANDATORY") {
          this.addLinear(terms, ">=", cov.targetCount, constraintId);
        } else if (this.#isOptimizing()) {
          this.addSoftLinear(
            terms,
            ">=",
            cov.targetCount,
            priorityToPenalty(cov.priority),
            constraintId,
          );
        }

        // Track coverage constraints that can produce post-solve feedback.
        if (cov.priority === "MANDATORY" || this.#isOptimizing()) {
          this.reporter.trackConstraint({
            id: constraintId,
            type: "coverage",
            source: cov.priority === "MANDATORY" ? "hard" : "soft",
            description: `${cov.targetCount}x ${covKey} on ${cov.day} at ${formatMinutes(bucketStart)}`,
            targetValue: cov.targetCount,
            comparator: ">=",
            day: cov.day,
            timeSlot: formatMinutes(bucketStart),
            roleIds: cov.roleIds,
            skillIds: cov.skillIds,
            context: {
              days: [cov.day],
              memberIds: eligibleMembers.map((e) => e.id),
            },
            group: cov.group,
          });
        }
      }

      for (const issue of bucketIssues.values()) {
        const ranges = bucketStartsToRanges(issue.bucketStarts, bucket, covEnd).map(
          (range) => `${formatMinutes(range.start)}-${formatMinutes(range.end)}`,
        );
        if (ranges.length === 0) continue;

        const message = `Coverage for ${coverageLabel} on ${cov.day} (${ranges.join(", ")}) cannot be met: ${issue.message}.`;

        if (issue.severity === "impossible") {
          this.reporter.reportCoverageError({
            day: cov.day,
            timeSlots: ranges,
            roleIds: cov.roleIds,
            skillIds: cov.skillIds,
            message,
            suggestions: issue.suggestions,
            group: cov.group,
          });
        }
        // Note: optimized solves report soft coverage post-solve via tracked constraints.
      }
    }

    if (this.#isOptimizing()) {
      this.#addDefaultObjective();
    }

    this.#builtRequest = this.#buildRequest();
    this.#builtCompilation = {
      request: this.#builtRequest,
      validation: this.reporter.getValidation(),
      canSolve: !this.reporter.hasErrors(),
    };
    return this.#builtCompilation;
  }

  #addDefaultObjective(): void {
    // Default objective: shift minimization with optional fair distribution
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
  }

  /**
   * Run post-solve validation on all rules.
   * Call this after solving with the resolved assignments.
   */
  validateSolution(assignments: ResolvedShiftAssignment[]): void {
    const context: RuleCompileContext = {
      members: this.members,
      days: this.days,
      shiftPatterns: this.shiftPatterns,
      weekStartsOn: this.weekStartsOn,
    };

    for (const validator of this.#postSolveValidators) {
      validator.run(assignments, this.reporter, context);
    }
  }

  calculateCost(assignments: readonly ShiftAssignment[]): CostContribution {
    const context: RuleCompileContext = {
      members: this.members,
      days: this.days,
      shiftPatterns: this.shiftPatterns,
      weekStartsOn: this.weekStartsOn,
    };

    const entries = this.#costArtifacts.flatMap((artifact) =>
      artifact.calculateCost ? [...artifact.calculateCost(assignments, context).entries] : [],
    );

    return { entries };
  }

  #runRulePrechecks(): void {
    const context: RuleCompileContext = {
      members: this.members,
      days: this.days,
      shiftPatterns: this.shiftPatterns,
      weekStartsOn: this.weekStartsOn,
    };

    for (const rule of this.rules) {
      const hasHardConstraint = rule.artifacts.some(
        (artifact) => artifact.kind === "hard-constraint",
      );
      const shouldRunPrechecks = this.#isOptimizing() || hasHardConstraint;
      if (!shouldRunPrechecks) continue;

      for (const artifact of rule.artifacts) {
        if (artifact.kind === "pre-solve-feedback") {
          artifact.run(context, this.reporter);
        }
      }
    }
  }

  #applyRuleArtifacts(): void {
    this.#postSolveValidators = [];
    this.#costArtifacts = [];

    for (const { rule, artifact } of this.#compiledArtifacts) {
      switch (artifact.kind) {
        case "variable": {
          if (artifact.variable.type === "bool") {
            this.boolVar(artifact.variable.name);
          } else {
            this.intVar(artifact.variable.name, artifact.variable.min, artifact.variable.max);
          }
          break;
        }
        case "hard-constraint": {
          const constraintId =
            artifact.validation.strategy === "report" ? artifact.validation.id : undefined;
          this.addLinear(
            [...artifact.terms],
            artifact.comparator,
            artifact.targetValue,
            constraintId,
          );
          this.#reportHardConstraint(rule, artifact);
          break;
        }
        case "soft-constraint": {
          if (!this.#isOptimizing()) {
            break;
          }
          const solverConstraintId =
            artifact.validation.strategy === "report" ? artifact.constraintId : undefined;
          this.addSoftLinear(
            [...artifact.terms],
            artifact.comparator,
            artifact.targetValue,
            artifact.penalty,
            solverConstraintId,
            artifact.stage,
          );
          this.#reportSoftConstraint(rule, artifact);
          break;
        }
        case "objective": {
          if (!this.#isOptimizing()) {
            break;
          }
          this.#markObjectiveStageReference(artifact.stage);
          for (const term of artifact.terms) {
            this.#addPenalty(term.var, term.coeff, artifact.stage);
          }
          break;
        }
        case "coverage-exclusion": {
          this.reporter.excludeFromCoverage({
            memberId: artifact.memberId,
            day: artifact.day,
            startTime: artifact.startTime,
            endTime: artifact.endTime,
          });
          break;
        }
        case "pre-solve-feedback": {
          break;
        }
        case "post-solve-feedback": {
          if (!this.#isOptimizing()) {
            break;
          }
          this.#postSolveValidators.push(artifact);
          break;
        }
        case "cost": {
          if (!this.#isOptimizing()) {
            break;
          }
          artifact.compileObjective?.(this);
          this.#costArtifacts.push(artifact);
          break;
        }
      }
    }
  }

  #reportHardConstraint(
    rule: string,
    artifact: Extract<RuleArtifact, { kind: "hard-constraint" }>,
  ): void {
    if (artifact.validation.strategy !== "report") {
      return;
    }

    this.reporter.trackConstraint({
      id: artifact.validation.id,
      type: "rule",
      source: "hard",
      rule,
      description: artifact.description,
      targetValue: artifact.targetValue,
      comparator: artifact.comparator,
      context: artifact.context,
      group: artifact.group,
    });
  }

  #reportSoftConstraint(
    rule: string,
    artifact: Extract<RuleArtifact, { kind: "soft-constraint" }>,
  ): void {
    if (artifact.validation.strategy !== "report") {
      return;
    }

    this.reporter.trackConstraint({
      id: artifact.constraintId,
      type: "rule",
      source: "soft",
      rule,
      description: artifact.description,
      targetValue: artifact.targetValue,
      comparator: artifact.comparator,
      context: artifact.context,
      group: artifact.group,
    });
  }

  #buildRequest(): SolverRequest {
    if (!this.#isOptimizing()) {
      return {
        variables: Array.from(this.#variables.values()),
        constraints: this.#constraints,
        mode: "satisfy",
        options: this.#satisfyOptions(),
      };
    }

    const objectiveStageOrder = this.#resolveObjectiveStageOrder();

    if (objectiveStageOrder) {
      return {
        variables: Array.from(this.#variables.values()),
        constraints: this.#constraintsForStagedRequest(),
        objectiveStages: this.#buildObjectiveStages(objectiveStageOrder),
        options: this.options,
      };
    }

    return {
      variables: Array.from(this.#variables.values()),
      constraints: this.#constraints,
      objective:
        this.#objective.length > 0 ? { sense: "minimize", terms: this.#objective } : undefined,
      options: this.options,
    };
  }

  #markObjectiveStageReference(stage: string | undefined): void {
    if (stage === undefined) {
      return;
    }
    this.#referencedObjectiveStages.add(stage);
  }

  #isOptimizing(): boolean {
    return this.strategy.type === "optimize";
  }

  #satisfyOptions(): NonNullable<SolverRequest["options"]> {
    return {
      ...this.options,
      solutionLimit: this.options?.solutionLimit ?? 1,
    };
  }

  #resolveObjectiveStageOrder(): readonly string[] | undefined {
    const referencedStages = [...this.#referencedObjectiveStages];
    if (referencedStages.length === 0) {
      return undefined;
    }

    this.#validateReferencedObjectiveStages(referencedStages);

    if (this.options?.solutionLimit === 1) {
      throw new Error(
        "ModelBuilder objectiveStageOrder cannot be used with solverOptions.solutionLimit=1.",
      );
    }

    const stageOrder = this.#objectiveStageOrder;
    if (stageOrder === undefined) {
      if (referencedStages.length === 1) {
        return [referencedStages[0]!];
      }
      throw new Error(
        `Multiple objective stages were referenced (${referencedStages.join(", ")}); provide ModelBuilder objectiveStageOrder explicitly.`,
      );
    }

    if (referencedStages.includes(TARGET_PEAK_CONCURRENT_ASSIGNMENTS_OBJECTIVE_STAGE_ID)) {
      throw new Error(
        "targetPeakConcurrentAssignments cannot be combined with ModelBuilder objectiveStageOrder until the multi-stage objective API is public.",
      );
    }

    if (stageOrder.length === 0) {
      throw new Error("ModelBuilder objectiveStageOrder cannot be empty when provided.");
    }

    const declaredStages = new Set<string>();
    for (const stage of stageOrder) {
      if (stage.trim() === "") {
        throw new Error("ModelBuilder objectiveStageOrder cannot contain an empty stage id.");
      }
      if (stage === UNSTAGED_OBJECTIVE_STAGE_ID) {
        throw new Error(
          `ModelBuilder objectiveStageOrder cannot contain reserved stage id "${UNSTAGED_OBJECTIVE_STAGE_ID}".`,
        );
      }
      if (declaredStages.has(stage)) {
        throw new Error(`Duplicate objective stage id "${stage}" in objectiveStageOrder.`);
      }
      declaredStages.add(stage);
    }

    const allowedStages = new Set(declaredStages);
    allowedStages.add(UNSTAGED_OBJECTIVE_STAGE_ID);
    for (const stage of referencedStages) {
      if (stage === UNSTAGED_OBJECTIVE_STAGE_ID) {
        throw new Error(
          `Rule artifacts cannot use reserved objective stage id "${UNSTAGED_OBJECTIVE_STAGE_ID}".`,
        );
      }
      if (!allowedStages.has(stage)) {
        throw new Error(
          `Objective stage "${stage}" is not declared in ModelBuilder objectiveStageOrder.`,
        );
      }
    }

    return stageOrder;
  }

  #validateReferencedObjectiveStages(referencedStages: readonly string[]): void {
    for (const stage of referencedStages) {
      if (stage.trim() === "") {
        throw new Error("Rule artifacts cannot use an empty objective stage id.");
      }
      if (stage === UNSTAGED_OBJECTIVE_STAGE_ID) {
        throw new Error(
          `Rule artifacts cannot use reserved objective stage id "${UNSTAGED_OBJECTIVE_STAGE_ID}".`,
        );
      }
    }
  }

  #constraintsForStagedRequest(): SolverConstraint[] {
    return this.#constraints.map((constraint) => {
      if (constraint.type !== "soft_linear" || constraint.stage !== undefined) {
        return constraint;
      }
      return { ...constraint, stage: UNSTAGED_OBJECTIVE_STAGE_ID };
    });
  }

  #buildObjectiveStages(objectiveStageOrder: readonly string[]): SolverObjectiveStage[] {
    const stages = objectiveStageOrder.map((id) => ({
      id,
      sense: "minimize" as const,
      terms: this.#objectiveStageTerms.get(id) ?? [],
    }));
    const hasTailSoftConstraint = this.#constraints.some(
      (constraint) => constraint.type === "soft_linear" && constraint.stage === undefined,
    );

    if (this.#objective.length > 0 || hasTailSoftConstraint) {
      stages.push({
        id: UNSTAGED_OBJECTIVE_STAGE_ID,
        sense: "minimize",
        terms: this.#objective,
      });
    }

    return stages;
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
  message: string;
  suggestions: string[];
  bucketStarts: number[];
  values?: Record<string, number>;
};

type ExclusionWindow = {
  startMinutes: number;
  endMinutes: number;
};

function resolveModelSolveStrategy(strategy: unknown): ModelSolveStrategy {
  if (strategy === undefined) {
    return { type: "optimize" };
  }

  if (typeof strategy !== "object" || strategy === null || !("type" in strategy)) {
    throw new Error("ModelBuilder strategy must be an object with a type field.");
  }

  const strategyType = (strategy as { type: unknown }).type;
  if (strategyType === "optimize" || strategyType === "feasibility-only") {
    return { type: strategyType };
  }

  throw new Error(`Unknown ModelBuilder strategy "${String(strategyType)}".`);
}

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
