# dabke

[![npm version](https://img.shields.io/npm/v/dabke.svg)](https://www.npmjs.com/package/dabke)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/christianklotz/dabke/actions/workflows/ci.yml/badge.svg)](https://github.com/christianklotz/dabke/actions/workflows/ci.yml)

TypeScript scheduling library powered by constraint programming.

Define teams, shifts, coverage, and rules declaratively. dabke compiles them into a CP-SAT model and solves for an optimized schedule.

```typescript
import {
  schedule,
  t,
  time,
  cover,
  shift,
  maxHoursPerWeek,
  minRestBetweenShifts,
  timeOff,
  minimizeCost,
  weekdays,
  weekend,
} from "dabke";

const venue = schedule({
  roleIds: ["barista", "server"],

  // Times: WHEN you need people (named periods for coverage + rules)
  times: {
    breakfast: time({ startTime: t(7), endTime: t(10) }),
    lunch_rush: time(
      { startTime: t(11, 30), endTime: t(14) },
      { startTime: t(11), endTime: t(15), dayOfWeek: weekend },
    ),
    closing: time({ startTime: t(20), endTime: t(22) }),
  },

  // Coverage: HOW MANY people you need during each time
  coverage: [
    cover("breakfast", "barista", 1),
    cover("lunch_rush", "barista", 2, { dayOfWeek: weekdays }),
    cover("lunch_rush", "barista", 3, { dayOfWeek: weekend }),
    cover("lunch_rush", "server", 1),
    cover("closing", "server", 1),
  ],

  // Shifts: WHEN people CAN work (the actual time slots)
  // An opener covers breakfast + lunch; a closer covers lunch + closing
  shiftPatterns: [
    shift("opener", t(6), t(14)),
    shift("mid", t(10), t(18)),
    shift("closer", t(14), t(22)),
  ],

  rules: [
    maxHoursPerWeek(40),
    minRestBetweenShifts(11),
    timeOff({ appliesTo: "alice", dayOfWeek: weekend }),
    minimizeCost(),
  ],
});
```

## Quick Start

```bash
npm install dabke
```

dabke compiles scheduling problems into a constraint model. You need a CP-SAT solver to find the solution:

```bash
docker pull christianklotz/dabke-solver
docker run -p 8080:8080 christianklotz/dabke-solver
```

Once you have a schedule definition, add members and solve:

```typescript
import { HttpSolverClient } from "dabke";

const result = await venue
  .with([
    { id: "alice", roleIds: ["barista", "server"], pay: { hourlyRate: 1500 } },
    { id: "bob", roleIds: ["barista"], pay: { hourlyRate: 1200 } },
    { id: "carol", roleIds: ["barista", "server"], pay: { hourlyRate: 1400 } },
    { id: "dave", roleIds: ["barista", "server"], pay: { hourlyRate: 1200 } },
    { id: "eve", roleIds: ["barista", "server"], pay: { hourlyRate: 1300 } },
  ])
  .solve(new HttpSolverClient(fetch, "http://localhost:8080"), {
    dateRange: { start: "2026-02-09", end: "2026-02-15" },
  });

console.log(result.status); // "optimal" | "feasible" | "infeasible" | "no_solution"
console.log(result.assignments); // Shift assignments per member per day
```

Or compile and solve manually for more control:

```typescript
const compiled = venue
  .with([...members])
  .compile({ dateRange: { start: "2026-02-09", end: "2026-02-15" } });

if (compiled.canSolve) {
  const solver = new HttpSolverClient(fetch, "http://localhost:8080");
  const response = await solver.solve(compiled.request);
  // ...
}
```

---

## Key Concepts

**Times vs shift patterns.** These are two distinct things. Times are named periods you need coverage for ("breakfast", "lunch_rush"). Shift patterns are the time slots people actually work ("opener 6-14", "closer 14-22"). They don't need to match. The solver assigns members to shift patterns whose hours overlap with times to satisfy coverage.

**Coverage.** How many people with which roles you need during each time. Coverage can vary by day of week or specific dates using scoping options or the variant form of `cover()`.

**Rules.** Business constraints expressed as function calls. Rules with `priority: "MANDATORY"` (the default) are hard constraints the solver will never violate. Rules with `LOW`, `MEDIUM`, or `HIGH` priority are soft preferences the solver optimizes across.

**Scoping.** Every rule accepts `appliesTo` (a role, skill, or member ID), plus time scoping (`dayOfWeek`, `dateRange`, `dates`, `recurringPeriods`) to target when and who:

```typescript
maxHoursPerDay(8, { appliesTo: "barista", dayOfWeek: weekdays }),
timeOff({ appliesTo: "alice", dateRange: { start: "2026-02-09", end: "2026-02-13" } }),
maxHoursPerWeek(30, { appliesTo: "bob", priority: "MEDIUM" }),
```

**Cost optimization.** Members declare `pay` as hourly or salaried. Cost rules (`minimizeCost`, `dayMultiplier`, `overtimeMultiplier`, `tieredOvertimeMultiplier`, etc.) tell the solver to minimize total labor cost, factoring in overtime, day premiums, and time-based surcharges.

**Composition with `.with()`.** Schedule definitions are immutable. Use `.with()` to merge other schedules or add members at runtime. Each `.with()` returns a new `Schedule` instance:

```typescript
const ready = venue.with([
  { id: "alice", roleIds: ["barista"], pay: { hourlyRate: 1500 } },
  { id: "bob", roleIds: ["barista"], pay: { hourlyRate: 1200 } },
]);
```

---

## Rules

### Scheduling

| Function                   | Description                          |
| -------------------------- | ------------------------------------ |
| `maxHoursPerDay(hours)`    | Max hours per person per day         |
| `maxHoursPerWeek(hours)`   | Max hours per person per week        |
| `minHoursPerDay(hours)`    | Min hours per person per day         |
| `minHoursPerWeek(hours)`   | Min hours per person per week        |
| `maxShiftsPerDay(n)`       | Max shift assignments per day        |
| `maxConsecutiveDays(n)`    | Max consecutive working days         |
| `minConsecutiveDays(n)`    | Min consecutive working days         |
| `minRestBetweenShifts(h)`  | Min rest hours between shifts        |
| `timeOff(opts)`            | Block assignments during periods     |
| `preference(level, opts)`  | Prefer or avoid assigning members    |
| `preferLocation(id, opts)` | Prefer members at specific locations |
| `assignTogether(opts)`     | Keep members on the same shifts      |

### Cost

| Function                                 | Description                              |
| ---------------------------------------- | ---------------------------------------- |
| `minimizeCost()`                         | Minimize total labor cost                |
| `dayMultiplier(factor, opts?)`           | Pay multiplier for specific days         |
| `daySurcharge(amount, opts?)`            | Flat surcharge per hour on specific days |
| `timeSurcharge(amount, window, opts?)`   | Surcharge during a time-of-day window    |
| `overtimeMultiplier(opts)`               | Weekly overtime pay multiplier           |
| `overtimeSurcharge(opts)`                | Weekly overtime flat surcharge           |
| `dailyOvertimeMultiplier(opts)`          | Daily overtime pay multiplier            |
| `dailyOvertimeSurcharge(opts)`           | Daily overtime flat surcharge            |
| `tieredOvertimeMultiplier(tiers, opts?)` | Graduated overtime rates                 |

---

## LLM Integration

dabke ships an `llms.txt` with complete API documentation for AI code generation:

```typescript
import { apiDocs } from "dabke/llms";
```

---

## Development

Unit tests (no dependencies): `npm run test:unit`

Integration tests (requires Docker): `npm run test:integration`

The test harness builds and starts a solver container from `solver/Dockerfile` automatically.

```typescript
import { startSolverContainer } from "dabke/testing";
const solver = await startSolverContainer();
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add rules and contribute.

## License

[MIT](LICENSE)
