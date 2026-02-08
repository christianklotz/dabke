# dabke

Scheduling library powered by constraint programming (CP-SAT).

Define your team, shifts, coverage, and rules — dabke turns them into an optimized schedule.

## Features

- **Declarative scheduling** — describe what you need, not how to solve it
- **Built-in rules** — max hours, time off, rest periods, consecutive days, and more
- **Semantic time** — define named time periods ("lunch", "closing") that resolve per day
- **Soft & hard constraints** — priorities from `LOW` (preference) to `MANDATORY` (hard constraint)
- **Scoped rules** — apply rules globally, per person, per role, or per skill
- **Validation** — detailed error reporting with coverage gaps and rule violations
- **LLM-friendly** — ships `llms.txt` with full API docs for AI code generation

## Install

```bash
npm install dabke
```

## Quick Start

```typescript
import {
  ModelBuilder,
  HttpSolverClient,
  parseSolverResponse,
  resolveAssignments,
} from "dabke";

// Define team
const employees = [
  { id: "alice", roleIds: ["server"] },
  { id: "bob", roleIds: ["server"] },
  { id: "charlie", roleIds: ["chef"] },
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
    roleIds: ["server"],
    targetCount: 1,
    priority: "MANDATORY" as const,
  },
  {
    day: "2026-02-09",
    startTime: { hours: 16 },
    endTime: { hours: 23 },
    roleIds: ["server"],
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

const { request } = builder.compile();

// Solve (requires a CP-SAT solver endpoint)
const solver = new HttpSolverClient(fetch, "https://your-solver-endpoint");
const response = await solver.solve(request);
const result = parseSolverResponse(response);

if (result.status === "OPTIMAL" || result.status === "FEASIBLE") {
  const shifts = resolveAssignments(result.assignments, shiftPatterns);
  for (const shift of shifts) {
    console.log(
      `${shift.employeeId}: ${shift.day} ${shift.startTime.hours}:00–${shift.endTime.hours}:00`
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
    { startTime: { hours: 11, minutes: 30 }, endTime: { hours: 14 }, days: ["monday", "tuesday", "wednesday", "thursday", "friday"] },
    { startTime: { hours: 12 }, endTime: { hours: 15 }, days: ["saturday", "sunday"] },
  ],
  closing: { startTime: { hours: 21 }, endTime: { hours: 23 } },
});

const coverage = times.coverage([
  { semanticTime: "lunch", roleIds: ["server"], targetCount: 3, priority: "MANDATORY" },
  { semanticTime: "closing", roleIds: ["server"], targetCount: 1, priority: "HIGH" },
]);
```

## Built-in Rules

| Rule | Description |
|------|-------------|
| `max-hours-day` | Max hours per person per day |
| `max-hours-week` | Max hours per person per week |
| `min-hours-day` | Min hours per person per day |
| `min-hours-week` | Min hours per person per week |
| `max-shifts-day` | Max shift assignments per day |
| `max-consecutive-days` | Max consecutive working days |
| `min-consecutive-days` | Min consecutive working days |
| `min-rest-between-shifts` | Min rest hours between shifts |
| `time-off` | Block assignments during periods |
| `employee-assignment-priority` | Prefer or avoid assigning team members |
| `assign-together` | Keep team members on the same shifts |
| `location-preference` | Prefer team members at specific locations |

All rules support scoping by person, role, skill, and time period (date ranges, days of week, recurring periods).

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
  console.log(`${s.description}: ${s.status} (${s.passedCount}/${s.passedCount + s.violatedCount})`);
}
```

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

## Solver

dabke compiles scheduling problems into a JSON-based constraint model. You need a CP-SAT solver service to solve it. The model format is compatible with Google OR-Tools CP-SAT solver.

## License

[MIT](LICENSE)
