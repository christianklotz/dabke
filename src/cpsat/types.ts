import type { TimeOfDay, DayOfWeek } from "../types.js";
import type { SolverRequest, SolverTerm } from "../client.types.js";
import type { ValidationGroup } from "./validation.types.js";

/**
 * Pay per hour in the caller's smallest currency unit (e.g., pence, cents).
 */
export interface HourlyPay {
  /** Pay per hour in smallest currency unit. */
  hourlyRate: number;
}

/**
 * Annual salary with contracted weekly hours.
 *
 * The solver treats salaried members as having a fixed weekly cost
 * (`annual / 52`) that is incurred once they work any shift in a week.
 * Additional shifts within the same week have zero marginal cost.
 *
 * Note: overtime multiplier rules apply only to hourly members.
 * Overtime surcharge rules apply to all members regardless of pay type.
 */
export interface SalariedPay {
  /** Annual salary in smallest currency unit. */
  annual: number;
  /** Contracted hours per week. Reserved for future overtime support. */
  hoursPerWeek: number;
}

/**
 * How strictly the solver enforces a rule.
 *
 * - `"LOW"`, `"MEDIUM"`, `"HIGH"`: soft constraints with increasing penalty for violations
 * - `"MANDATORY"`: hard constraint; the solver will not produce a solution that violates it
 */
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "MANDATORY";

/**
 * A team member available for scheduling.
 *
 * Members are assigned to shift patterns by the solver based on
 * coverage requirements, rules, and constraints.
 */
export interface SchedulingMember {
  /** Unique identifier for this member. Must not contain colons. */
  id: string;
  /** Roles this member can fill (e.g. "nurse", "doctor"). */
  roles: string[];
  /** Skills this member has (e.g. "charge_nurse", "forklift"). */
  skills?: string[];
  /** Base pay. Required when cost rules are used. */
  pay?: HourlyPay | SalariedPay;
}

/**
 * A shift pattern defines WHEN people can work: the time slots available for assignment.
 *
 * Shift patterns are templates that repeat across all scheduling days. The solver assigns
 * team members to these patterns based on coverage requirements and constraints.
 *
 * @example
 * // Simple setup: one shift type, anyone can work it
 * const patterns: ShiftPattern[] = [
 *   { id: "day", startTime: { hours: 9 }, endTime: { hours: 17 } }
 * ];
 *
 * @example
 * // Role-restricted shifts
 * const patterns: ShiftPattern[] = [
 *   { id: "ward_day", startTime: { hours: 7 }, endTime: { hours: 15 }, roles: ["nurse", "doctor"] },
 *   { id: "reception", startTime: { hours: 8 }, endTime: { hours: 16 }, roles: ["admin"] },
 * ];
 */
export interface ShiftPattern {
  /**
   * Unique identifier for this shift pattern.
   * Used in assignments and rule configurations.
   */
  id: string;

  /**
   * Restricts who can be assigned to this shift based on their roles.
   *
   * - If omitted: anyone can work this shift
   * - If provided: only team members whose roles overlap with this list can be assigned
   *
   * Most venues have the same shifts for everyone and don't need this.
   * Use it when different roles have different schedules (e.g., kitchen staff starts
   * earlier than floor staff).
   */
  roles?: [string, ...string[]];

  /**
   * Restricts which days of the week this shift pattern can be used.
   *
   * - If omitted: shift can be used on any day
   * - If provided: shift can only be assigned on the specified days
   *
   * @example
   * ```typescript
   * // Saturday-only short shift
   * { id: "saturday_shift", startTime: t(9), endTime: t(14), dayOfWeek: ["saturday"] }
   *
   * // Weekday-only full shift
   * { id: "full_shift", startTime: t(9), endTime: t(18), dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"] }
   * ```
   */
  dayOfWeek?: DayOfWeek[];

  /**
   * Physical location where this shift takes place.
   * Used for multi-location scheduling and location-based constraints.
   */
  locationId?: string;

  /** When the shift starts (e.g., `{ hours: 9, minutes: 0 }` for 9:00 AM) */
  startTime: TimeOfDay;

  /** When the shift ends (e.g., `{ hours: 17, minutes: 30 }` for 5:30 PM) */
  endTime: TimeOfDay;
}

export interface TimeInterval {
  day: string;
  startTime: TimeOfDay;
  endTime: TimeOfDay;
}

/**
 * Base fields shared by all coverage requirement variants.
 */
interface CoverageRequirementBase extends TimeInterval {
  targetCount: number;
  priority: Priority;
  /**
   * Groups this requirement with others for validation reporting.
   * All coverage constraints generated from this requirement will share the
   * same group, enabling meaningful aggregation in reports.
   *
   * If not provided, an auto-generated group will be used based on the coverage parameters.
   */
  group?: ValidationGroup;
}

/**
 * Coverage requiring specific roles, optionally filtered by skills.
 * Team members must have ANY of the specified roles (OR logic).
 * If skills provided, they must ALSO have ALL specified skills (AND logic).
 */
interface RoleBasedCoverageRequirement extends CoverageRequirementBase {
  /**
   * Roles that satisfy this coverage (OR logic).
   * A person matches if they have ANY of these roles.
   * Must have at least one role.
   */
  roles: [string, ...string[]];
  /**
   * Additional skill filter (AND logic with roles).
   * If provided, team members must have ALL specified skills in addition to matching a role.
   */
  skills?: [string, ...string[]];
}

/**
 * Coverage requiring specific skills only (any role).
 * Team members must have ALL specified skills (AND logic).
 */
interface SkillBasedCoverageRequirement extends CoverageRequirementBase {
  /**
   * Must not be present for skill-based coverage.
   */
  roles?: never;
  /**
   * Skills required to satisfy this coverage (ALL required, AND logic).
   * Must have at least one skill.
   */
  skills: [string, ...string[]];
}

/**
 * Defines staffing needs for a specific time period.
 *
 * This is a discriminated union that enforces at compile time that at least
 * one of `roles` or `skills` must be provided:
 *
 * - Role-based: `{ roles: ["waiter"], ... }` - anyone with ANY of these roles (OR logic)
 * - Role + skill: `{ roles: ["waiter"], skills: ["senior"], ... }` - role AND skills
 * - Skill-only: `{ skills: ["keyholder"], ... }` - any role with ALL skills (AND logic)
 *
 * @example
 * // Need 2 waiters during lunch (role-based)
 * { day: "2024-01-01", startTime: { hours: 11 }, endTime: { hours: 14 }, roles: ["waiter"], targetCount: 2, priority: "MANDATORY" }
 *
 * @example
 * // Need 1 manager OR supervisor during service (OR logic on roles)
 * { day: "2024-01-01", startTime: { hours: 11 }, endTime: { hours: 22 }, roles: ["manager", "supervisor"], targetCount: 1, priority: "MANDATORY" }
 *
 * @example
 * // Need 1 keyholder for opening (skill-only, any role)
 * { day: "2024-01-01", startTime: { hours: 6 }, endTime: { hours: 8 }, skills: ["keyholder"], targetCount: 1, priority: "MANDATORY" }
 *
 * @example
 * // Need 1 senior waiter for training shift (role + skill filter)
 * { day: "2024-01-01", startTime: { hours: 9 }, endTime: { hours: 17 }, roles: ["waiter"], skills: ["senior"], targetCount: 1, priority: "HIGH" }
 */
export type CoverageRequirement = RoleBasedCoverageRequirement | SkillBasedCoverageRequirement;

/** Optional settings for the model builder. */
export interface ModelBuilderOptions {
  /** Which day starts the week for weekly rules. Defaults to "monday". */
  weekStartsOn?: DayOfWeek;
  /** Solver-level options (time limit, solution limit). */
  solverOptions?: SolverRequest["options"];
  /**
   * Bucket size used when translating coverage requirements into time-indexed constraints.
   * Smaller buckets are more accurate but increase the number of constraints.
   */
  coverageBucketMinutes?: number;
  /**
   * Whether to enable fair distribution of shifts across team members.
   *
   * When enabled (default), the solver minimizes the maximum number of shifts
   * any single person works, ensuring work is distributed evenly. Each person
   * works between floor(total/n) and ceil(total/n) shifts.
   *
   * Disable this if you want other rules (like assignment-priority)
   * to have full control over shift distribution. Defaults to true.
   */
  fairDistribution?: boolean;
}

export type Term = SolverTerm;
