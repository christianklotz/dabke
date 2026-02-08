import type { TimeOfDay, DayOfWeek } from "../types.js";
import type { SolverRequest, SolverTerm } from "../client.types.js";
import type { GroupKey } from "./validation.types.js";

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "MANDATORY";

export interface SchedulingEmployee {
  id: string;
  roleIds: string[];
  skillIds?: string[];
}

/**
 * @deprecated Use SchedulingEmployee instead. This alias exists for backwards compatibility.
 */
export type Employee = SchedulingEmployee;

/**
 * A shift pattern defines WHEN people can work — the time slots available for assignment.
 *
 * Shift patterns are templates that repeat across all scheduling days. The solver assigns
 * team members to these patterns based on coverage requirements and constraints.
 *
 * @example
 * // Simple venue: one shift type, anyone can work it
 * const patterns: ShiftPattern[] = [
 *   { id: "day", startTime: { hours: 9 }, endTime: { hours: 17 } }
 * ];
 *
 * @example
 * // Restaurant: different shifts for different roles
 * const patterns: ShiftPattern[] = [
 *   { id: "kitchen_morning", startTime: { hours: 6 }, endTime: { hours: 14 }, roleIds: ["chef", "prep_cook"] },
 *   { id: "floor_lunch", startTime: { hours: 11 }, endTime: { hours: 15 }, roleIds: ["waiter", "host"] },
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
   * - If provided: only team members whose roleIds overlap with this list can be assigned
   *
   * Most venues have the same shifts for everyone and don't need this.
   * Use it when different roles have different schedules (e.g., kitchen staff starts
   * earlier than floor staff).
   */
  roleIds?: [string, ...string[]];

  /**
   * Restricts which days of the week this shift pattern can be used.
   *
   * - If omitted: shift can be used on any day
   * - If provided: shift can only be assigned on the specified days
   *
   * @example
   * ```typescript
   * // Saturday-only short shift
   * { id: "saturday_shift", startTime: t(9), endTime: t(14), daysOfWeek: ["saturday"] }
   *
   * // Weekday-only full shift
   * { id: "full_shift", startTime: t(9), endTime: t(18), daysOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"] }
   * ```
   */
  daysOfWeek?: DayOfWeek[];

  /**
   * Physical location where this shift takes place.
   * Used for multi-location scheduling and location-based constraints.
   */
  locationId?: string;

  /** When the shift starts (e.g., { hours: 9, minutes: 0 } for 9:00 AM) */
  startTime: TimeOfDay;

  /** When the shift ends (e.g., { hours: 17, minutes: 30 } for 5:30 PM) */
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
   * Groups this requirement with others sharing the same key for validation reporting.
   * When provided, all coverage constraints generated from this requirement will
   * share the same groupKey, enabling meaningful aggregation in reports.
   *
   * If not provided, an auto-generated key will be used based on the coverage parameters.
   */
  groupKey?: GroupKey;
}

/**
 * Coverage requiring specific roles, optionally filtered by skills.
 * Team members must have ANY of the specified roles (OR logic).
 * If skillIds provided, they must ALSO have ALL specified skills (AND logic).
 */
interface RoleBasedCoverageRequirement extends CoverageRequirementBase {
  /**
   * Roles that satisfy this coverage (OR logic).
   * A person matches if they have ANY of these roles.
   * Must have at least one role.
   */
  roleIds: [string, ...string[]];
  /**
   * Additional skill filter (AND logic with roles).
   * If provided, team members must have ALL specified skills in addition to matching a role.
   */
  skillIds?: [string, ...string[]];
}

/**
 * Coverage requiring specific skills only (any role).
 * Team members must have ALL specified skills (AND logic).
 */
interface SkillBasedCoverageRequirement extends CoverageRequirementBase {
  /**
   * Must not be present for skill-based coverage.
   */
  roleIds?: never;
  /**
   * Skills required to satisfy this coverage (ALL required, AND logic).
   * Must have at least one skill.
   */
  skillIds: [string, ...string[]];
}

/**
 * Defines staffing needs for a specific time period.
 *
 * This is a discriminated union that enforces at compile time that at least
 * one of `roleIds` or `skillIds` must be provided:
 *
 * - Role-based: `{ roleIds: ["waiter"], ... }` - anyone with ANY of these roles (OR logic)
 * - Role + skill: `{ roleIds: ["waiter"], skillIds: ["senior"], ... }` - role AND skills
 * - Skill-only: `{ skillIds: ["keyholder"], ... }` - any role with ALL skills (AND logic)
 *
 * @example
 * // Need 2 waiters during lunch (role-based)
 * { day: "2024-01-01", startTime: { hours: 11 }, endTime: { hours: 14 }, roleIds: ["waiter"], targetCount: 2, priority: "MANDATORY" }
 *
 * @example
 * // Need 1 manager OR supervisor during service (OR logic on roles)
 * { day: "2024-01-01", startTime: { hours: 11 }, endTime: { hours: 22 }, roleIds: ["manager", "supervisor"], targetCount: 1, priority: "MANDATORY" }
 *
 * @example
 * // Need 1 keyholder for opening (skill-only, any role)
 * { day: "2024-01-01", startTime: { hours: 6 }, endTime: { hours: 8 }, skillIds: ["keyholder"], targetCount: 1, priority: "MANDATORY" }
 *
 * @example
 * // Need 1 senior waiter for training shift (role + skill filter)
 * { day: "2024-01-01", startTime: { hours: 9 }, endTime: { hours: 17 }, roleIds: ["waiter"], skillIds: ["senior"], targetCount: 1, priority: "HIGH" }
 */
export type CoverageRequirement = RoleBasedCoverageRequirement | SkillBasedCoverageRequirement;

export interface ModelBuilderOptions {
  weekStartsOn?: DayOfWeek;
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
   * Disable this if you want other rules (like employee-assignment-priority)
   * to have full control over shift distribution.
   *
   * @default true
   */
  fairDistribution?: boolean;
}

export type Term = SolverTerm;
