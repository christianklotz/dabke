# dabke

[![npm version](https://img.shields.io/npm/v/dabke.svg)](https://www.npmjs.com/package/dabke)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/christianklotz/dabke/actions/workflows/ci.yml/badge.svg)](https://github.com/christianklotz/dabke/actions/workflows/ci.yml)

Scheduling library powered by constraint programming (CP-SAT).

Define your team, shifts, coverage, and rules — dabke turns them into an optimized schedule.

```typescript
import { ModelBuilder, HttpSolverClient } from "dabke";

const builder = new ModelBuilder({
  employees: [
    { id: "alice", roleIds: ["server"] },
    { id: "bob", roleIds: ["server"] },
  ],
  shiftPatterns: [
    { id: "morning", startTime: { hours: 8 }, endTime: { hours: 16 } },
    { id: "evening", startTime: { hours: 16 }, endTime: { hours: 23 } },
  ],
  coverage: [
    {
      day: "2026-02-09",
      startTime: { hours: 8 },
      endTime: { hours: 16 },
      roleIds: ["server"],
      targetCount: 1,
      priority: "MANDATORY",
    },
    {
      day: "2026-02-09",
      startTime: { hours: 16 },
      endTime: { hours: 23 },
      roleIds: ["server"],
      targetCount: 1,
      priority: "MANDATORY",
    },
  ],
  schedulingPeriod: { specificDates: ["2026-02-09"] },
  ruleConfigs: [
    { name: "max-hours-day", config: { hours: 8, priority: "MANDATORY" } },
    { name: "min-rest-between-shifts", config: { hours: 10, priority: "MANDATORY" } },
  ],
});

const { request } = builder.compile();
const solver = new HttpSolverClient(fetch, "http://localhost:8080");
const response = await solver.solve(request);
```

## Why dabke?

Staff scheduling with constraint programming is dominated by Python ([OR-Tools](https://developers.google.com/optimization)) and Java ([Timefold](https://timefold.ai/)). If you're building in TypeScript, your options have been: call a Python service and figure out the model yourself, or write scheduling heuristics by hand.

dabke gives you a **TypeScript-native API** for expressing scheduling problems declaratively — employees, shifts, coverage requirements, and rules — and compiles them into a CP-SAT model solved by OR-Tools. You describe _what_ you need, not _how_ to solve it.

**Key differences from rolling your own:**

- **Declarative rules** — express constraints like "max 8 hours/day" or "11 hours rest between shifts" as config, not code
- **Semantic time** — define named periods ("lunch_rush", "closing") that vary by day of week
- **Soft and hard constraints** — some rules are mandatory, others are preferences the solver optimizes for
- **Scoped rules** — apply constraints globally, per person, per role, per skill, or during specific time periods
- **Validation** — detailed reporting on coverage gaps and rule violations before and after solving

## Install

```bash
npm install dabke
```

## Quick Start

### 1. Start the solver

dabke compiles scheduling problems into a constraint model. You need a CP-SAT solver to solve it. A ready-to-use solver is included:

```bash
# Pull the solver image
docker pull christianklotz/dabke-solver

# Start it
docker run -p 8080:8080 christianklotz/dabke-solver
```

Or build from source:

```bash
cd node_modules/dabke/solver
docker build -t dabke-solver .
docker run -p 8080:8080 dabke-solver
```

### 2. Build and solve a schedule

```typescript
import { ModelBuilder, HttpSolverClient, parseSolverResponse, resolveAssignments } from "dabke";

// Define team
const employees = [
  { id: "alice", roleIds: ["server"] },
  { id: "bob", roleIds: ["server"] },
];

// Define shift patterns
const shiftPatterns = [
  { id: "morning", startTime: { hours: 8 }, endTime: { hours: 16 } },
  { id: "evening", startTime: { hours: 16 }, endTime: { hours: 23 } },
];

// Define coverage requirements
const coverage = [
  {
    day: "2026-02-09",
    startTime: { hours: 8 },
    endTime: { hours: 16 },
    roleIds: ["server"] as [string],
    targetCount: 1,
    priority: "MANDATORY" as const,
  },
  {
    day: "2026-02-09",
    startTime: { hours: 16 },
    endTime: { hours: 23 },
    roleIds: ["server"] as [string],
    targetCount: 1,
    priority: "MANDATORY" as const,
  },
];

// Build the model
const builder = new ModelBuilder({
  employees,
  shiftPatterns,
  coverage,
  schedulingPeriod: {
    specificDates: ["2026-02-09"],
  },
  ruleConfigs: [
    { name: "max-hours-day", config: { hours: 8, priority: "MANDATORY" } },
    { name: "min-rest-between-shifts", config: { hours: 10, priority: "MANDATORY" } },
  ],
});

const { request, canSolve, validation } = builder.compile();

if (!canSolve) {
  console.error("Cannot solve:", validation.errors);
  process.exit(1);
}

// Solve
const solver = new HttpSolverClient(fetch, "http://localhost:8080");
const response = await solver.solve(request);
const result = parseSolverResponse(response);

if (result.status === "OPTIMAL" || result.status === "FEASIBLE") {
  const shifts = resolveAssignments(result.assignments, shiftPatterns);
  for (const shift of shifts) {
    console.log(
      `${shift.employeeId}: ${shift.day} ${shift.startTime.hours}:00–${shift.endTime.hours}:00`,
    );
  }
}
```

## Semantic Time

Define named time periods that can vary by day, then write coverage requirements in business terms:

```typescript
import { defineSemanticTimes } from "dabke";

const times = defineSemanticTimes({
  lunch: [
    {
      startTime: { hours: 11, minutes: 30 },
      endTime: { hours: 14 },
      days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    },
    {
      startTime: { hours: 12 },
      endTime: { hours: 15 },
      days: ["saturday", "sunday"],
    },
  ],
  closing: { startTime: { hours: 21 }, endTime: { hours: 23 } },
});

const coverage = times.coverage([
  { semanticTime: "lunch", roleIds: ["server"], targetCount: 3, priority: "MANDATORY" },
  { semanticTime: "closing", roleIds: ["server"], targetCount: 1, priority: "HIGH" },
]);

// Resolve against actual scheduling days
const days = ["2026-02-09", "2026-02-10", "2026-02-11"];
const resolved = times.resolve(coverage, days);
```

## Built-in Rules

| Rule                           | Description                               |
| ------------------------------ | ----------------------------------------- |
| `max-hours-day`                | Max hours per person per day              |
| `max-hours-week`               | Max hours per person per week             |
| `min-hours-day`                | Min hours per person per day              |
| `min-hours-week`               | Min hours per person per week             |
| `max-shifts-day`               | Max shift assignments per day             |
| `max-consecutive-days`         | Max consecutive working days              |
| `min-consecutive-days`         | Min consecutive working days              |
| `min-rest-between-shifts`      | Min rest hours between shifts             |
| `time-off`                     | Block assignments during periods          |
| `employee-assignment-priority` | Prefer or avoid assigning team members    |
| `assign-together`              | Keep team members on the same shifts      |
| `location-preference`          | Prefer team members at specific locations |

All rules support scoping by person, role, skill, and time period (date ranges, days of week, recurring periods).

### Scoping Example

```typescript
// Students can work max 4 hours on weekdays
{
  name: "max-hours-day",
  config: {
    roleIds: ["student"],
    hours: 4,
    dayOfWeek: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    priority: "MANDATORY",
  },
}

// Alice has time off next week
{
  name: "time-off",
  config: {
    employeeIds: ["alice"],
    dateRange: { start: "2026-02-09", end: "2026-02-13" },
    priority: "MANDATORY",
  },
}
```

### Soft vs. Hard Constraints

Rules with `priority: "MANDATORY"` are hard constraints — the solver will not violate them. Rules with `LOW`, `MEDIUM`, or `HIGH` priority are soft constraints — the solver tries to satisfy them but will trade them off against each other to find the best overall schedule.

```typescript
// Hard: legally required rest period
{ name: "min-rest-between-shifts", config: { hours: 11, priority: "MANDATORY" } }

// Soft: prefer to keep Bob under 30 hours/week
{ name: "max-hours-week", config: { employeeIds: ["bob"], hours: 30, weekStartsOn: "monday", priority: "MEDIUM" } }
```

## Validation

dabke validates schedules and reports coverage gaps and rule violations:

```typescript
import { ValidationReporterImpl, summarizeValidation } from "dabke";

const reporter = new ValidationReporterImpl();
const builder = new ModelBuilder({ ...config, reporter });
const { request, validation, canSolve } = builder.compile();

// Pre-solve validation
if (!canSolve) {
  for (const error of validation.errors) {
    console.error(error.reason);
  }
}

// Post-solve validation (after solving)
reporter.analyzeSolution(response);
const results = reporter.getValidation();
const summaries = summarizeValidation(results);

for (const s of summaries) {
  console.log(
    `${s.description}: ${s.status} (${s.passedCount}/${s.passedCount + s.violatedCount})`,
  );
}
```

## Custom Rules

dabke's rule system is extensible. You can create custom rules that integrate with the model builder:

```typescript
import { createCpsatRuleFactory, type CompilationRule } from "dabke";

function createNoSundayWorkRule(config: { priority: "MANDATORY" | "HIGH" }): CompilationRule {
  return {
    compile(b) {
      for (const emp of b.employees) {
        for (const day of b.days) {
          const date = new Date(`${day}T00:00:00Z`);
          if (date.getUTCDay() !== 0) continue; // Sunday = 0
          for (const pattern of b.shiftPatterns) {
            if (!b.canAssign(emp, pattern)) continue;
            b.addLinear([{ var: b.assignment(emp.id, pattern.id, day), coeff: 1 }], "<=", 0);
          }
        }
      }
    },
  };
}

const customRules = createCpsatRuleFactory({
  "no-sunday-work": createNoSundayWorkRule,
});
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide on writing custom rules.

## LLM Integration

dabke ships an `llms.txt` file with complete API documentation, designed for AI code generation:

```typescript
import { apiDocs } from "dabke/llms";

// Pass to your LLM as context for generating scheduling code
```

Or read the file directly:

```bash
cat node_modules/dabke/llms.txt
```

## Development

### Running tests

Unit tests have no external dependencies:

```bash
npm run test:unit
```

Integration tests require Docker to run the solver container:

```bash
# Ensure Docker is running, then:
npm run test:integration
```

The integration test harness (`startSolverContainer`) builds and starts a Docker container from `solver/Dockerfile` automatically. It binds to port 18080 by default — make sure no other container is using that port.

To run both unit and integration tests:

```bash
npm test          # runs typecheck + unit tests only
npm run test:integration   # solver integration tests (requires Docker)
```

### Test utilities

dabke exports test helpers for writing your own integration tests:

```typescript
import { startSolverContainer } from "dabke/testing";

const solver = await startSolverContainer();
const response = await solver.client.solve(request);
solver.stop();
```

This builds the solver Docker image, starts a container, waits for the health check, and returns a pre-configured `HttpSolverClient`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, how to add rules, and contribution guidelines.

## License

[MIT](LICENSE)
