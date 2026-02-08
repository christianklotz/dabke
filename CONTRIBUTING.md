# Contributing to dabke

Thanks for wanting to contribute! This guide exists to save both of us time.

## The One Rule

**You must understand your code.** If you can't explain what your changes do and how they interact with the solver model, your PR will be closed.

Using AI to write code is fine — dabke even ships `llms.txt` for this purpose. But you need to understand the output. Submitting agent-generated slop without that understanding wastes everyone's time.

## First-Time Contributors

We use an approval gate for new contributors:

1. Open an issue describing what you want to change and why
2. Keep it concise
3. A maintainer will comment `lgtm` if approved
4. Once approved, submit a PR

## Before Submitting a PR

```bash
npm run build         # must pass
npm run typecheck     # must pass with no errors
npm run test:unit     # must pass
```

If your change touches solver behavior, also run integration tests (requires Docker):

```bash
npm run test:integration
```

Do not edit `CHANGELOG.md`. Changelog entries are added by maintainers.

## Adding Rules

The rule system is the main extension point. Study these files in order:

1. `src/cpsat/rules/max-hours-day.ts` — simplest rule, good starting template
2. `src/cpsat/rules/scoping.ts` — how entity/time scoping works
3. `src/cpsat/rules/rules.types.ts` — type registry
4. `src/cpsat/rules/registry.ts` — built-in rule registration

### Pattern

Every rule follows the same structure:

1. **Zod schema** with `withScopes()` for standard scoping fields
2. **Factory function** returning a `CompilationRule` with `compile(builder)`
3. **Optional `validate()`** for post-solve validation

The builder API inside `compile()`:

- `b.assignment(employeeId, patternId, day)` — variable name
- `b.canAssign(employee, pattern)` — role restriction check
- `b.patternAvailableOnDay(pattern, day)` — day-of-week filter
- `b.patternDuration(patternId)` — duration in minutes
- `b.addLinear(terms, op, bound)` — hard constraint
- `b.addSoftLinear(terms, op, bound, penalty)` — soft constraint

### Registration (built-in rules only)

1. Export factory from `src/cpsat/rules/index.ts`
2. Add to `builtInCpsatRuleFactories` in `registry.ts`
3. Add config type to `CpsatRuleRegistry` in `rules.types.ts`
4. Add unit test + integration test

For rules in your own project, use `createCpsatRuleFactory()` — no changes to dabke needed.

## Code Style

- TypeScript with strict mode
- ESM only (no CommonJS)
- Zod for runtime config validation
- No `any` unless absolutely necessary

## Solver Development

The solver is a Python FastAPI service wrapping OR-Tools CP-SAT. See `solver/README.md`.

```bash
cd solver
uv sync
uv run pytest
uvicorn solver.app:app --reload --port 8080
```

## Questions?

Open an [issue](https://github.com/christianklotz/dabke/issues).
