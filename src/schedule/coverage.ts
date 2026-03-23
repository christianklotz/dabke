/**
 * Coverage definitions: staffing requirements per semantic time period.
 *
 * @module
 */

import type { DayOfWeek } from "../types.js";
import type { CoverageVariant } from "../cpsat/semantic-time.js";
import type { Priority } from "../cpsat/types.js";

export type { CoverageVariant } from "../cpsat/semantic-time.js";

/**
 * Options for a {@link cover} call.
 *
 * @remarks
 * Day/date scoping controls which days this coverage entry applies to.
 * An entry without `dayOfWeek` or `dates` applies every day in the
 * scheduling period.
 *
 * @category Coverage
 */
export interface CoverageOptions {
  /** Additional skill ID filter (AND logic with the target role). */
  skillIds?: [string, ...string[]];
  /** Restrict to specific days of the week. */
  dayOfWeek?: readonly [DayOfWeek, ...DayOfWeek[]];
  /** Restrict to specific dates (YYYY-MM-DD). */
  dates?: string[];
  /** Defaults to `"MANDATORY"`. */
  priority?: Priority;
}

/**
 * A coverage entry returned by {@link cover}.
 *
 * @remarks
 * Carries the semantic time name and target type information for
 * compile-time validation by {@link schedule}. This is an opaque
 * token; pass it directly into the `coverage` array.
 */
export interface CoverageEntry<T extends string = string, R extends string = string> {
  /** @internal */ readonly _type: "coverage";
  /** @internal */ readonly timeName: T;
  /** @internal */ readonly target: R | R[];
  /** @internal */ readonly count: number;
  /** @internal */ readonly options: CoverageOptions;
  /** @internal  When present, this entry uses variant-based resolution. */
  readonly variants?: readonly CoverageVariant[];
}

/**
 * Defines a staffing requirement for a semantic time period.
 *
 * @remarks
 * Entries for the same time and role **stack additively**.
 * For weekday vs weekend staffing, use mutually exclusive `dayOfWeek`
 * on both entries.
 *
 * @param timeName - Name of a declared semantic time
 * @param target - Role name (string), array of role names (OR logic), or skill name
 * @param count - Number of people needed
 * @param opts - Options: `skillIds` (AND filter), `dayOfWeek`, `dates`, `priority`
 *
 * @example
 * ```typescript
 * coverage: [
 *   // 2 waiters during lunch
 *   cover("lunch", "waiter", 2),
 *
 *   // 1 manager OR supervisor during dinner
 *   cover("dinner", ["manager", "supervisor"], 1),
 *
 *   // 1 person with keyholder skill at opening
 *   cover("opening", "keyholder", 1),
 *
 *   // 1 senior waiter (role + skill AND)
 *   cover("lunch", "waiter", 1, { skillIds: ["senior"] }),
 *
 *   // Different counts by day (mutually exclusive dayOfWeek!)
 *   cover("lunch", "waiter", 2, { dayOfWeek: weekdays }),
 *   cover("lunch", "waiter", 3, { dayOfWeek: weekend }),
 * ]
 * ```
 *
 * @category Coverage
 */
export function cover<T extends string, const R extends string>(
  timeName: T,
  target: R | [R, ...R[]],
  count: number,
  opts?: CoverageOptions,
): CoverageEntry<T, R>;
export function cover<T extends string, const R extends string>(
  timeName: T,
  target: R | [R, ...R[]],
  ...variants: [CoverageVariant, ...CoverageVariant[]]
): CoverageEntry<T, R>;
export function cover<T extends string, R extends string>(
  timeName: T,
  target: R | [R, ...R[]],
  countOrFirstVariant: number | CoverageVariant,
  ...rest: unknown[]
): CoverageEntry<T, R> {
  if (typeof countOrFirstVariant === "number") {
    // Simple form: cover(time, target, count, opts?)
    return {
      _type: "coverage",
      timeName,
      target,
      count: countOrFirstVariant,
      options: (rest[0] as CoverageOptions | undefined) ?? {},
    };
  }

  // Variant form: cover(time, target, ...variants)
  const variants = [countOrFirstVariant, ...(rest as CoverageVariant[])];

  const defaults = variants.filter((v) => !v.dayOfWeek && !v.dates);
  if (defaults.length > 1) {
    throw new Error(
      "cover() accepts at most one default variant (without dayOfWeek or dates). " +
        `Found ${defaults.length} default variants.`,
    );
  }

  return {
    _type: "coverage",
    timeName,
    target,
    count: 0,
    options: {},
    variants,
  };
}
