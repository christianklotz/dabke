# Changelog

All notable changes to this project will be documented in this file.

This changelog was generated from the git history of the project when it was
named `scheduling-core`, prior to the rename to `dabke` in v0.78.0.

## 0.82.0 (2026-02-23)

### Breaking Changes

- **Replace `defineSchedule` with `schedule`/`with`/`compile`/`solve` API**: the
  `defineSchedule()` function, `ScheduleDefinition`, and `RuntimeArgs` are removed.
  Use `schedule()` to create an immutable `Schedule`, compose data with `.with()`,
  and execute via `.compile()` or `.solve()`.
- **Rename `roles`/`skills` back to `roleIds`/`skillIds`**: all public type fields and
  function options (`SchedulingMember`, `ShiftPattern`, coverage types, `ScheduleConfig`)
  revert to `roleIds`/`skillIds` for unambiguous signaling to LLM consumers.
- **Redesign validation message architecture**: `ValidationGroup` now uses deterministic
  structural keys (e.g. `rule:max-hours-week:40:roles:nurse`) instead of counter-based
  IDs. Validation items use a unified `message` field replacing `reason`/`description`.
  `ValidationSummary.title` replaces `description`.
- **Trim public API surface** (102 to 86 exports): remove internal types
  (`ValidationReporter`, `ValidationContext`, `CostContext`, `ModelBuilderOptions`,
  `CoverageRequirement`, `CpsatRuleRegistry`, `DateTime`), legacy validation, and
  unused datetime utilities.
- **`SolveResult` status** uses lowercase strings: `optimal`, `feasible`, `infeasible`,
  `no_solution`.

### Improvements

- `solve()` runs post-solve validation automatically; `SolveResult.validation` includes
  soft constraint violations.
- `ScheduleConfig` requires `times`, `coverage`, `shiftPatterns`; `partialSchedule()`
  allows partial configs for composition via `.with()`.
- Eager validation in `.with()` for role/skill disjointness and member references.
- All `dayOfWeek` fields typed as `readonly [DayOfWeek, ...DayOfWeek[]]` consistently.
- Add constraint IDs, group keys, and `trackConstraint()` to all soft rules for
  post-solve verification.
- Add `@category` TSDoc tags to all public exports for structured documentation.
- Restructure docs reference nav with automated category-driven generation.

## 0.81.1 (2026-02-20)

### Documentation

- Rewrite README for the v2 `defineSchedule` API with a verified cafe scheduling example.

## 0.81.0 (2026-02-19)

### Breaking Changes

- **Rename employee to member**: `SchedulingEmployee` is now `SchedulingMember`,
  `employeeIds` scope fields are now `memberIds`, and `Employee` type alias is removed.
  The `employee-assignment-priority` rule is renamed to `assignment-priority`.
- **Rename roleIds/skillIds to roles/skills**: on `SchedulingMember`, `ShiftPattern`,
  and all coverage requirement types. Scope fields on rules remain `roleIds`/`skillIds`.
- **Merge ShiftPatternDef into ShiftPattern**: the separate `ShiftPatternDef` type is
  removed. `ShiftPattern` now directly includes `startTime`, `endTime`, and optional
  `roles`/`skills` fields.
- **Flatten CpsatRuleConfigEntry**: rule config entries change from
  `{ name, config: { ... } }` to `{ name, ...config }`. Config fields sit at the same
  level as `name`. The type is now a distributive union preventing mismatched name/config
  pairings at compile time.
- **Rename daysOfWeek to dayOfWeek**: on `SchedulingPeriod`, `SemanticTimeVariant`,
  and coverage requirement types.
- **Remove v1-only exports**: `Employee`, `ShiftPatternDef`, `defineSemanticTimes`,
  and related types removed from the public API. Use `defineSchedule` instead.

### Features

- **defineSchedule API**: new primary API with composable factory functions (`time`,
  `cover`, `shift`, rule helpers like `maxHoursPerWeek`, `timeOff`, etc.) for building
  a complete scheduling configuration declaratively.
- **Cost optimization**: base pay tracking (`HourlyPay`, `SalariedPay` on members),
  cost minimization rule (`minimize-cost`), day/time cost surcharges and multipliers,
  and post-solve cost calculation.
- **Overtime rules**: daily and weekly overtime multipliers and surcharges,
  tiered overtime multiplier for graduated rates.
- **Variant coverage**: day-specific count overrides on coverage requirements
  via `countByDay` on the `cover()` helper.

### Fixes

- Clean up stale solver containers on startup in the test harness.
- Strip all entity-scope fields consistently during scope resolution.

### Improvements

- Simplify rule translation layer; rule-specific knowledge (schemas, defaults,
  validation, cost) is co-located in each rule file.
- Rewrite llms.txt generator as whitelist-based, aligned with the v2 API.
- Enrich TSDoc throughout: schedule.ts, semantic-time.ts, coverage types,
  and package-level documentation updated for the defineSchedule API.

## 0.80.0 (2026-02-14)

### Breaking Changes

- Overhaul rule scoping types: replace `withScopes()` / `normalizeScope()` with
  `entityScope()`, `timeScope()`, and `requiredTimeScope()` builder functions
- Remove exported types `EntityScope`, `TimeScope`, `RuleScope`, `ScopeConfig`
  and functions `withScopes`, `normalizeScope`, `specificity`, `effectiveEmployeeIds`,
  `subtractIds`, `timeScopeKey`, `entityScopeTypeKey`
- Scope fields (`employeeIds`, `roleIds`, `skillIds`, `specificDates`, `dayOfWeek`,
  `recurringPeriods`) now require non-empty arrays; empty arrays are rejected at parse time
- Enforce mutual exclusivity of scope fields at compile time via `?: never` pattern

### Improvements

- Export `SolverStatusSchema` from main entry point
- Export new scoping types: `EntityScopeType`, `OptionalTimeScopeType`,
  `RequiredTimeScopeType`, `ParsedEntityScope`, `ParsedTimeScope`, `RecurringPeriod`
- Add TSDoc to all solver wire types, rule config types, and model builder interfaces

## 0.79.0 (2026-02-10)

### Breaking Changes

- Replace `SchedulingPeriod` discriminated union with a flat interface: `dateRange` is always required, `daysOfWeek` and `dates` are optional composable filters
- Rename `specificDates` to `dates` on `SchedulingPeriod`
- `resolveDaysFromPeriod()` now composes filters with AND logic (a day must pass all specified filters)

### Improvements

- Remove `PatternPenaltyRule` test helper in favor of deterministic constraint assertions
- Share single solver container across integration tests via vitest `globalSetup`
- Expand README Development section with test commands and Docker requirements

## 0.78.2 (2026-02-08)

- Fix solver Docker image to support both amd64 and arm64 (Apple Silicon)
- Fix npm publish by upgrading npm before publish in CI

## 0.78.1 (2026-02-08)

- Add AGENTS.md and CONTRIBUTING.md
- Improve README with hero example, "Why dabke?" section, solver quickstart, scoping and custom rules docs
- Improve solver README with Docker Hub image reference and API docs
- Add GitHub Actions workflow for publishing solver Docker image to Docker Hub

## 0.78.0 (2026-02-07)

- Rename package from `scheduling-core` to `dabke`

## 0.77.0 (2026-02-02)

### Breaking Changes

- Replace singular `roleId` with `roleIds` array in coverage requirements
- Enforce `roleIds`/`skillIds` requirement at compile time with discriminated union types

## 0.76.0 (2026-02-01)

- Add validation grouping with `groupKey` for meaningful summary reports
- Add `summarizeValidation()` to aggregate validation items by source instruction

## 0.75.0 (2026-01-29)

- Add fair distribution of shifts across team members (`fairDistribution` option)
- Track mandatory coverage constraints as passed validation items

## 0.74.0 (2026-01-27)

- Add `SchedulingPeriod` type for date range with day-of-week filtering
- Enforce minimum 2 members in `assign-together` rule at the type level

## 0.73.0 (2026-01-25)

- Add schedule violation diagnostics with detailed error reporting
- Add stable deterministic IDs to validation items
- Fix: preserve scope when IDs don't match during rule resolution

## 0.72.0 (2026-01-13)

### Breaking Changes

- Drop legacy solver and related rules API — CP-SAT is now the only solver path

### Features

- Add skill-based coverage requirements (`skillIds` on coverage)
- Add interval variables, `NoOverlap` constraints, and bucketed coverage
- Better role mapping strategy for multi-role team members
- Inherit `weekStartsOn` from `ModelBuilder` in weekly rules

## 0.71.0 (2026-01-11)

- Fix coverage constraints to use time-indexed approach for accuracy
- Make time horizon end date inclusive
- Handle mandatory coverage priority correctly
- Make role IDs optional on shift patterns (support role-agnostic shifts)
- Support multiple role ID restrictions on `ShiftPattern`
- Improve `ShiftPattern` type documentation and enforce non-empty `roleIds`

## 0.70.0 (2026-01-10)

### Features

- Add CP-SAT compilation path via `ModelBuilder`
- Add semantic time definitions (`defineSemanticTimes`) with day-specific variants
- Type-safe coverage requirements using semantic time names

## 0.69.0 (2026-01-09)

- Initial setup for custom CP-SAT solver integration (replacing hosted OR-Tools)

## 0.68.0 (2026-01-07)

- Add comprehensive tests and API documentation

## 0.67.0 (2025-11-23)

- Improved rules system with better priority handling
- Better prompt injection for LLM code generation
- Time scope resolution for rules (date ranges, days of week, recurring periods)
- Refactored coverage requirements

## 0.66.0 (2025-11-05)

- Refactor to visitor pattern for rule compilation
- Improve LLM performance with better API documentation

## 0.65.0 (2025-10-21)

- Add rules: `max-hours-week`, `min-hours-week`, `max-consecutive-days`,
  `min-consecutive-days`, `min-rest-between-shifts`, `assign-together`

## 0.64.0 (2025-10-13)

- Refactor date period splitting as shared utility
- Fix dependency issues

## 0.63.0 (2025-09-26)

- Add `min-hours-day` rule
- Make rule factory type-safe with `CpsatRuleRegistry`

## 0.62.0 (2025-09-18)

- Add auto-generated `llms.txt` API reference
- Complete migration to modular architecture

## 0.61.0 (2025-09-01)

- Rename "time window" concept to "named period"

## 0.60.0 (2025-08-28)

- Initial release as `scheduling-core`
- `ModelBuilder` for building constraint programming models
- Built-in rules: `max-hours-day`, `max-shifts-day`, `time-off`, `employee-assignment-priority`, `location-preference`
- `HttpSolverClient` for solver communication
- Type-safe configuration with TypeScript
