"""FastAPI entrypoint for the solver service."""

from fastapi import FastAPI

from .models import SolverRequest, SolverResponse
from .solver import solve_request

app = FastAPI(
    title="Scheduler Solver",
    description="CP-SAT solver for scheduling primitives",
    version="0.1.0",
)


@app.get("/health")
async def health() -> dict[str, str]:
    """Health probe endpoint."""
    return {"status": "ok", "service": "scheduler-solver"}


@app.post("/solve", response_model=SolverResponse)
async def solve(request: SolverRequest) -> SolverResponse:
    """Solve a scheduling model described by primitive constraints."""
    return solve_request(request)
