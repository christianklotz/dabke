"""Pydantic models for solver requests and responses."""

from typing import Literal

from pydantic import BaseModel, Field, ConfigDict


class Variable(BaseModel):
    """Decision variable.

    Supported types:
    - bool: boolean variable
    - int: integer variable with bounds
    - interval: (optional) fixed interval with an absolute start/end and fixed size.
      When presenceVar is provided, the interval is optional and active iff the
      boolean presenceVar is true.
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal["bool", "int", "interval"]
    name: str

    # int
    min: int | None = None
    max: int | None = None

    # interval
    start: int | None = None
    end: int | None = None
    size: int | None = None
    presenceVar: str | None = None


class Term(BaseModel):
    """Linear term var * coeff."""

    model_config = ConfigDict(extra="forbid")

    var: str
    coeff: int


class Constraint(BaseModel):
    """Supported constraint primitives."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    type: Literal[
        "linear",
        "soft_linear",
        "exactly_one",
        "at_most_one",
        "implication",
        "bool_or",
        "bool_and",
        "no_overlap",
    ]
    terms: list[Term] | None = None
    op: Literal["<=", ">=", "=="] | None = None
    rhs: int | None = None
    penalty: int | None = None
    vars: list[str] | None = None
    intervals: list[str] | None = None
    if_: str | None = Field(default=None, alias="if")
    then: str | None = None
    id: str | None = None


class Objective(BaseModel):
    """Optional objective definition."""

    model_config = ConfigDict(extra="forbid")

    sense: Literal["minimize", "maximize"]
    terms: list[Term]


class Options(BaseModel):
    """Solver tuning options."""

    model_config = ConfigDict(extra="forbid")

    timeLimitSeconds: float = 60.0
    solutionLimit: int | None = None  # Only solutionLimit=1 is supported (stops after first feasible solution)


class SolverRequest(BaseModel):
    """Request payload accepted by the solver service."""

    model_config = ConfigDict(extra="forbid")

    variables: list[Variable]
    constraints: list[Constraint]
    objective: Objective | None = None
    options: Options | None = None


class SoftConstraintViolation(BaseModel):
    """A soft constraint violation in the solver output."""

    model_config = ConfigDict(extra="forbid")

    constraintId: str
    violationAmount: int
    targetValue: int
    actualValue: int


class SolverResponse(BaseModel):
    """Response payload produced by the solver service."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["OPTIMAL", "FEASIBLE", "INFEASIBLE", "TIMEOUT", "ERROR"]
    values: dict[str, int] | None = None
    statistics: dict[str, int | float] | None = None
    error: str | None = None
    solutionInfo: str | None = None
    softViolations: list[SoftConstraintViolation] | None = None
