# dabke solver

Minimal FastAPI service that solves scheduling models with [OR-Tools CP-SAT](https://developers.google.com/optimization/cp/cp_solver).

Receives a JSON constraint model from dabke's `ModelBuilder`, returns optimized assignments.

## Quick start (Docker)

```bash
# Use the published image
docker pull christianklotz/dabke-solver
docker run -p 8080:8080 christianklotz/dabke-solver

# Or build from source
docker build -t dabke-solver .
docker run -p 8080:8080 dabke-solver
```

Then point `HttpSolverClient` at it:

```typescript
import { HttpSolverClient } from "dabke";

const solver = new HttpSolverClient(fetch, "http://localhost:8080");
```

## Local development

```bash
uv sync
uvicorn solver.app:app --reload --port 8080
```

## Tests

```bash
uv run pytest
```

## API

### `GET /health`

Returns `{ "status": "ok" }`.

### `POST /solve`

Accepts a solver request JSON body, returns assignments. See dabke's `SolverRequest` type for the schema.
