# Scheduler Solver Service

Minimal FastAPI service that accepts scheduling primitives (variables, constraints, optional objective) and solves them with OR-Tools CP-SAT.

## Local run

```sh
uv sync
uvicorn solver.app:app --reload --port 8080
```

## Docker

```sh
docker build -t scheduler-solver .
docker run -p 8080:8080 scheduler-solver
```

## Tests

```sh
uv run pytest
```
