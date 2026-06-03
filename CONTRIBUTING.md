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
2. `src/cpsat/rules/scope.types.ts` — how entity/time scoping works
3. `src/cpsat/rule-descriptor.ts` — descriptor and artifact contracts
4. `src/cpsat/rules/artifact-helpers.ts` — common artifact constructors
5. `src/cpsat/rules/rules.types.ts` — type registry
6. `src/cpsat/rules/registry.ts` — built-in rule registration

### Feedback model

Rules are the feedback unit. Validation groups summarize rule outcomes for
presentation. Individual solver constraints are implementation details.

That means every rule must make its diagnostic intent explicit:

- If a constraint or check should contribute to user-visible feedback, emit it
  as a tracked hard constraint, soft constraint, precheck, or post-solve
  validator.
- If a constraint is only internal scaffolding, mark it as internal-only with
  an explicit reason. Do not rely on silence or comments as a convention.

When in doubt:

- use a **tracked hard constraint** when a modeled requirement should explain an
  infeasible or violated rule
- use a **soft constraint** when the rule may be violated but should still be
  reported
- use a **precheck** when the impossibility is knowable before solving
- use a **post-solve validator** when the feedback depends on interpreting the
  solved assignment rather than a single tracked constraint

Do not add raw solver-style escape hatches that bypass this feedback model.

### Architecture: co-locate rule knowledge

Each rule is self-contained. Everything specific to a rule (its schema, defaults,
validation, cost calculation) lives in the rule's own file. The scheduling layer
(`schedule.ts`) and the resolver (`resolver.ts`) are generic; they pass config
through without rule-specific knowledge.

Concretely:

- **Default priority** is declared in each rule's Zod schema via `PrioritySchema`
  (which has `.default("MANDATORY")`), not injected by the translation layer.
- **Config shape** is defined by the rule's Zod schema and validated at factory
  call time. The scheduling layer passes fields through generically.
- **Scoping** (entity and time) uses shared builders from `scope.types.ts`
  (`entityScope()`, `timeScope()`, `requiredTimeScope()`).

Do not add rule-specific logic (field lists, default values, special-case
branches) to `schedule.ts` or `resolver.ts`. If a new rule needs something
the generic path cannot provide, the solution is almost always to put it
in the rule's schema or factory, not in the scheduling layer.

### Pattern

Every rule follows the same structure:

1. **Zod schema** using `PrioritySchema`, `entityScope()`, and `timeScope()`
   from `scope.types.ts` for standard fields
2. **Config type** inferred from the schema (`z.infer<typeof Schema>`)
3. **Rule descriptor** via `defineRuleDescriptor({ name, schema, compile })`
4. **Artifact emission** from `compile(config, ctx)`
5. **Built-in registration** in `src/cpsat/rules/index.ts`, `registry.ts`, and
   `rules.types.ts`

The compile function should emit declarative artifacts instead of mutating the
solver model directly. Common helpers live in `artifact-helpers.ts`:

- `boolVariableArtifact()` / `intVariableArtifact()` — declare variables
- `hardConstraintArtifact()` — hard constraints that must contribute to rule
  feedback
- `softConstraintArtifact()` — tracked soft constraints
- `hardConstraintArtifactWithoutFeedback()` — explicit opt-out for helper
  constraints that should not contribute to rule feedback

Rule code may still use compile helpers like `canAssignMemberToPattern()` or
`isPatternAvailableOnDay()`, but the output contract is artifacts, not direct
builder mutation.

### Registration (built-in rules only)

1. Export the descriptor from `src/cpsat/rules/index.ts`
2. Add it to `builtInCpsatRuleRegistry` in `registry.ts`
3. Add its config type to `BuiltInCpsatRuleConfigRegistry` in `rules.types.ts`
4. Add unit test + integration test

For rules in your own project, use `createCpsatRuleRegistry()` — no changes to
dabke needed.

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
