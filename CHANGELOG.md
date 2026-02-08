# Changelog

All notable changes to this project will be documented in this file.

This changelog was generated from the git history of the project when it was
named `scheduling-core`, prior to the rename to `dabke` in v0.78.0.

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
