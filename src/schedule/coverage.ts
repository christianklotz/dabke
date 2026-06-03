/**
 * Coverage definitions: lower-bound staffing requirements per semantic time period.
 *
 * Coverage answers "what floor should apply throughout this scoped time, with
 * the chosen priority?". It attaches sustained lower bounds to semantic times,
 * whether those periods are
 * explicit in the requirements or inferred to separate distinct business
 * requirements. Coverage does not express caps, targets, fairness, or other
 * assignment-shaping logic. Use rules for those concerns.
 *
 * @example
 * ```typescript
 * coverage: [
 *   cover("lunch", "waiter", 2, { dayOfWeek: weekdays }),
 *   cover("lunch", "waiter", 3, { dayOfWeek: weekend }),
 *   cover("dinner", ["manager", "supervisor"], 1),
 *   cover("opening", "keyholder", 1),
 *
 *   // Variant form: different counts by day
 *   cover("peak_hours", "agent",
 *     { count: 4 },
 *     { count: 2, dates: ["2025-12-24"] },
 *   ),
 * ]
 * ```
 *
 * @module
 */

import type { DateString, DayOfWeek } from "../types.js";
import type { CoverageVariant } from "../cpsat/semantic-time.js";
import type { Priority } from "../cpsat/types.js";

export type { CoverageVariant } from "../cpsat/semantic-time.js";

/**
 * Options for a {@link cover} call.
 *
 * @remarks
 * Day/date scoping controls which days this coverage entry applies to.
 * An entry without `dayOfWeek` or `dates` applies every day in the
 * scheduling period. Scope answers where the floor applies; it does not change
 * the meaning of coverage itself. `priority` controls how hard the coverage floor is.
 * Use it to distinguish language like "must keep 5 staffed on Saturdays"
 * from "ideally keep 5 staffed on Mondays too" without changing the
 * underlying coverage shape. `skillIds` is a hard filter, not a preference.
 * Use it only when the required minimum truly needs those skills throughout
 * the window. If a role or skill mix is preferred rather than required, model
 * that with rules such as {@link preferAssignment} instead of skill-filtered
 * coverage.
 *
 * @category Coverage
 */
export interface CoverageOptions {
  /** Additional skill ID filter (AND logic with the target role). */
  skillIds?: [string, ...string[]];
  /** Restrict to specific days of the week. */
  dayOfWeek?: readonly [DayOfWeek, ...DayOfWeek[]];
  /** Restrict to specific dates (YYYY-MM-DD). */
  dates?: DateString[];
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
 * Coverage always defines a lower bound that applies throughout the scoped
 * semantic time, with strength controlled by `priority`. If the requirements
 * also state an upper bound or productive
 * cap, model that separately in `rules`, for example with
 * {@link maxConcurrentAssignments}.
 *
 * Scope answers where the floor applies. Priority answers how strictly the
 * solver should preserve that floor when trade-offs are necessary.
 *
 * Attach coverage to the narrowest semantic time that actually carries that
 * minimum. Avoid layering a broad parent coverage window on top of narrower
 * windows unless the same lower bound truly applies throughout the full span.
 * If the requirements talk about hitting full occupancy at the busy point,
 * prefer {@link targetPeakConcurrentAssignments} over turning that into a
 * whole-window minimum. Do not infer a synthetic "peak" semantic time just to attach
 * `cover(..., 5)` unless the requirements really define a sustained window
 * that needs that minimum throughout.
 *
 * Overlapping entries for the same time and role produce independent
 * constraints; the solver enforces the **max** count, not the sum.
 * An unscoped entry acts as a floor that scoped entries cannot reduce.
 * Use mutually exclusive scopes when different days need different coverage.
 *
 * @param timeName - Name of a declared semantic time
 * @param target - Role name (string), array of role names (OR logic), or skill name
 * @param count - Number of people needed
 * @param opts - Options: `skillIds` (AND filter), `dayOfWeek`, `dates`, `priority`
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
