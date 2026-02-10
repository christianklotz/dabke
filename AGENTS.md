# Development Rules

## First Message

If the user did not give you a concrete task, read README.md, then ask what to work on.

## Project Overview

dabke is a TypeScript scheduling library that compiles staff scheduling problems into CP-SAT constraint models. The solver is a separate Python service (in `solver/`).

Key concepts:

- `ModelBuilder` compiles employees, shift patterns, coverage, and rules into a `SolverRequest`
- Rules implement `CompilationRule` with a `compile(builder)` method
- The solver is stateless — it receives a JSON model and returns assignments
- Semantic times map business-friendly names to time ranges that vary by day

## Commands

```bash
npm run build           # Build (tsc)
npm run typecheck       # Type check including tests
npm run test:unit       # Unit tests (no Docker)
npm run test:integration # Integration tests (requires Docker)
```

- After code changes, run `npm run build` and fix all errors before presenting results.
- NEVER commit unless the user asks.

## Code Quality

- TypeScript strict mode, ESM only
- No `any` unless absolutely necessary
- Zod for runtime validation of rule configs
- All rule configs use `withScopes()` from `src/cpsat/rules/scoping.ts`

## Adding a Rule

1. Create `src/cpsat/rules/<name>.ts` — define Zod schema with `withScopes()`, export factory function
2. Export from `src/cpsat/rules/index.ts`
3. Register in `src/cpsat/rules/registry.ts` (`builtInCpsatRuleFactories`)
4. Add config type to `CpsatRuleRegistry` in `src/cpsat/rules/rules.types.ts`
5. Add unit test in `tests/` and integration test in `tests/cpsat/`

Study `src/cpsat/rules/max-hours-day.ts` as the reference implementation.

## Style

- Keep answers concise
- No emojis in commits or code
- Comments should explain non-obvious logic, not narrate changes

## Git

- NEVER use `git add -A` or `git add .`
- Always `git add <specific files>`
- NEVER force push
