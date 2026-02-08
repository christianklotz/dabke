"""CP-SAT solver translation layer."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional

from ortools.sat.python import cp_model

from .models import (
    Constraint,
    Objective,
    Options,
    SolverRequest,
    SolverResponse,
    SoftConstraintViolation,
    Term,
    Variable,
)


@dataclass
class _VariableBounds:
    """Simple bounds container for quick min/max calculations."""

    lower: int
    upper: int


@dataclass
class _TrackedSoftConstraint:
    """Tracks soft constraints with identifiers for post-solve diagnostics."""

    constraint_id: str
    violation_var: cp_model.IntVar
    target_value: int
    comparator: str
    terms: list[Term]


def _collect_bounds(variables: Iterable[Variable]) -> dict[str, _VariableBounds]:
    bounds: dict[str, _VariableBounds] = {}
    for var in variables:
        if var.type == "bool":
            bounds[var.name] = _VariableBounds(0, 1)
        elif var.type == "int":
            if var.min is None or var.max is None:
                raise ValueError(f"Int variable {var.name} requires min and max")
            bounds[var.name] = _VariableBounds(var.min, var.max)
        elif var.type == "interval":
            # Interval variables are not referenced in linear expressions.
            continue
        else:
            raise ValueError(f"Unknown variable type {var.type}")
    return bounds


def _term_range(term: Term, bounds: _VariableBounds) -> tuple[int, int]:
    coeff = term.coeff
    if coeff >= 0:
        return coeff * bounds.lower, coeff * bounds.upper
    return coeff * bounds.upper, coeff * bounds.lower


def _expression_range(terms: list[Term], bounds: dict[str, _VariableBounds]) -> tuple[int, int]:
    min_expr = 0
    max_expr = 0
    for term in terms:
        if term.var not in bounds:
            raise ValueError(f"Unknown variable {term.var}")
        term_min, term_max = _term_range(term, bounds[term.var])
        min_expr += term_min
        max_expr += term_max
    return min_expr, max_expr


def _sum_expr(exprs: list[cp_model.LinearExpr]) -> Optional[cp_model.LinearExpr]:
    if not exprs:
        return None
    total = exprs[0]
    for expr in exprs[1:]:
        total += expr
    return total


def _add_linear_constraint(model: cp_model.CpModel, constraint: Constraint, vars_map: dict[str, cp_model.IntVar]) -> None:
    if not constraint.terms or constraint.op is None or constraint.rhs is None:
        raise ValueError("Linear constraint requires terms, op, and rhs")
    expr = sum(vars_map[t.var] * t.coeff for t in constraint.terms)
    match constraint.op:
        case "<=":
            model.Add(expr <= constraint.rhs)
        case ">=":
            model.Add(expr >= constraint.rhs)
        case "==":
            model.Add(expr == constraint.rhs)
        case _:
            raise ValueError(f"Unsupported linear operator {constraint.op}")


def _add_soft_linear_constraint(
    model: cp_model.CpModel,
    constraint: Constraint,
    vars_map: dict[str, cp_model.IntVar],
    bounds: dict[str, _VariableBounds],
    penalty_terms: list[cp_model.LinearExpr],
    tracked_constraints: list[_TrackedSoftConstraint],
    constraint_index: int,
) -> None:
    if not constraint.terms or constraint.op is None or constraint.rhs is None or constraint.penalty is None:
        raise ValueError("Soft linear constraint requires terms, op, rhs, and penalty")

    min_expr, max_expr = _expression_range(constraint.terms, bounds)
    max_violation = 0
    violation: cp_model.IntVar | None = None
    expr = sum(vars_map[t.var] * t.coeff for t in constraint.terms)
    constraint_id = constraint.id or f"soft_{constraint_index}"
    match constraint.op:
        case "<=":
            max_violation = max(0, max_expr - constraint.rhs)
            violation = model.NewIntVar(0, max_violation, f"violation_{constraint_id}")
            model.Add(expr <= constraint.rhs + violation)
        case ">=":
            max_violation = max(0, constraint.rhs - min_expr)
            violation = model.NewIntVar(0, max_violation, f"violation_{constraint_id}")
            model.Add(expr + violation >= constraint.rhs)
        case _:
            raise ValueError(f"Unsupported soft linear operator {constraint.op}")

    if violation is None:
        raise ValueError("Soft linear constraint failed to create violation variable")

    if max_violation > 0:
        penalty_terms.append(violation * constraint.penalty)
        if constraint.id is not None:
            tracked_constraints.append(
                _TrackedSoftConstraint(
                    constraint_id=constraint_id,
                    violation_var=violation,
                    target_value=constraint.rhs,
                    comparator=constraint.op,
                    terms=constraint.terms,
                )
            )


def _add_exactly_one(model: cp_model.CpModel, constraint: Constraint, vars_map: dict[str, cp_model.IntVar]) -> None:
    if not constraint.vars:
        raise ValueError("Exactly one constraint requires vars")
    literals = [vars_map[v] for v in constraint.vars]
    model.AddExactlyOne(literals)


def _add_at_most_one(model: cp_model.CpModel, constraint: Constraint, vars_map: dict[str, cp_model.IntVar]) -> None:
    if not constraint.vars:
        raise ValueError("At most one constraint requires vars")
    literals = [vars_map[v] for v in constraint.vars]
    model.AddAtMostOne(literals)


def _add_implication(model: cp_model.CpModel, constraint: Constraint, vars_map: dict[str, cp_model.IntVar]) -> None:
    if constraint.if_ is None or constraint.then is None:
        raise ValueError("Implication constraint requires if/then")
    model.AddImplication(vars_map[constraint.if_], vars_map[constraint.then])


def _add_bool_or(model: cp_model.CpModel, constraint: Constraint, vars_map: dict[str, cp_model.IntVar]) -> None:
    if not constraint.vars:
        raise ValueError("Bool OR constraint requires vars")
    literals = [vars_map[v] for v in constraint.vars]
    model.AddBoolOr(literals)


def _add_bool_and(model: cp_model.CpModel, constraint: Constraint, vars_map: dict[str, cp_model.IntVar]) -> None:
    if not constraint.vars:
        raise ValueError("Bool AND constraint requires vars")
    literals = [vars_map[v] for v in constraint.vars]
    model.AddBoolAnd(literals)


def _add_no_overlap(
    model: cp_model.CpModel,
    constraint: Constraint,
    intervals_map: dict[str, cp_model.IntervalVar],
) -> None:
    if not constraint.intervals:
        raise ValueError("NoOverlap constraint requires intervals")
    intervals = [intervals_map[name] for name in constraint.intervals]
    model.AddNoOverlap(intervals)


def _build_objective(
    model: cp_model.CpModel,
    objective: Objective | None,
    vars_map: dict[str, cp_model.IntVar],
    penalty_terms: list[cp_model.LinearExpr],
) -> bool:
    penalty_expr: cp_model.LinearExpr | None = _sum_expr(penalty_terms)

    if objective:
        objective_terms: list[cp_model.LinearExpr] = (
            [vars_map[t.var] * t.coeff for t in objective.terms] if objective.terms else []
        )
        obj_expr: cp_model.LinearExpr | None = _sum_expr(objective_terms)
        if penalty_expr is not None and obj_expr is not None:
            expr = obj_expr + penalty_expr if objective.sense == "minimize" else obj_expr - penalty_expr
        elif obj_expr is not None:
            expr = obj_expr
        elif penalty_expr is not None:
            expr = penalty_expr if objective.sense == "minimize" else -penalty_expr
        else:
            return False

        if objective.sense == "maximize":
            model.Maximize(expr)
        else:
            model.Minimize(expr)
        return True

    if penalty_expr is not None:
        model.Minimize(penalty_expr)
        return True

    return False


def solve_request(request: SolverRequest) -> SolverResponse:
    """Solve a scheduling request."""
    try:
        model = cp_model.CpModel()

        var_bounds = _collect_bounds(request.variables)
        vars_map: dict[str, cp_model.IntVar] = {}
        intervals_map: dict[str, cp_model.IntervalVar] = {}

        # Variable creation
        for var in request.variables:
            if var.type == "bool":
                vars_map[var.name] = model.NewBoolVar(var.name)
            elif var.type == "int":
                if var.min is None or var.max is None:
                    raise ValueError(f"Int variable {var.name} requires min and max")
                vars_map[var.name] = model.NewIntVar(var.min, var.max, var.name)
            elif var.type == "interval":
                if var.start is None or var.end is None or var.size is None:
                    raise ValueError(f"Interval variable {var.name} requires start, end, and size")
                if var.end - var.start != var.size:
                    raise ValueError(
                        f"Interval variable {var.name} inconsistent: end-start={var.end - var.start} != size={var.size}"
                    )

                start = model.NewConstant(var.start)
                end = model.NewConstant(var.end)
                size = var.size

                if var.presenceVar is None:
                    intervals_map[var.name] = model.NewIntervalVar(start, size, end, var.name)
                else:
                    if var.presenceVar not in vars_map:
                        raise ValueError(
                            f"Interval variable {var.name} references unknown presenceVar {var.presenceVar}"
                        )
                    presence = vars_map[var.presenceVar]
                    intervals_map[var.name] = model.NewOptionalIntervalVar(start, size, end, presence, var.name)
            else:
                raise ValueError(f"Unsupported variable type {var.type}")

        penalty_terms: list[cp_model.LinearExpr] = []
        tracked_constraints: list[_TrackedSoftConstraint] = []
        constraint_index = 0

        for constraint in request.constraints:
            match constraint.type:
                case "linear":
                    _add_linear_constraint(model, constraint, vars_map)
                case "soft_linear":
                    _add_soft_linear_constraint(
                        model,
                        constraint,
                        vars_map,
                        var_bounds,
                        penalty_terms,
                        tracked_constraints,
                        constraint_index,
                    )
                    constraint_index += 1
                case "exactly_one":
                    _add_exactly_one(model, constraint, vars_map)
                case "at_most_one":
                    _add_at_most_one(model, constraint, vars_map)
                case "implication":
                    _add_implication(model, constraint, vars_map)
                case "bool_or":
                    _add_bool_or(model, constraint, vars_map)
                case "bool_and":
                    _add_bool_and(model, constraint, vars_map)
                case "no_overlap":
                    _add_no_overlap(model, constraint, intervals_map)
                case _:
                    raise ValueError(f"Unsupported constraint type {constraint.type}")

        has_objective = _build_objective(model, request.objective, vars_map, penalty_terms)

        solver = cp_model.CpSolver()
        options: Options = request.options or Options()
        solver.parameters.max_time_in_seconds = options.timeLimitSeconds
        if options.solutionLimit == 1:
            solver.parameters.stop_after_first_solution = True

        status = solver.Solve(model)

        status_map: dict[int, str] = {
            cp_model.OPTIMAL: "OPTIMAL",
            cp_model.FEASIBLE: "FEASIBLE",
            cp_model.INFEASIBLE: "INFEASIBLE",
            cp_model.MODEL_INVALID: "ERROR",
            cp_model.UNKNOWN: "TIMEOUT",
        }
        status_text = status_map.get(int(status), "ERROR")

        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return SolverResponse(
                status=status_text,
                solutionInfo=solver.response_proto.solution_info or None,
            )

        statistics: dict[str, int | float] = {
            "solveTimeMs": int(solver.wall_time * 1000),
            "conflicts": solver.num_conflicts,
            "branches": solver.num_branches,
        }

        if has_objective:
            statistics["objectiveValue"] = solver.objective_value
            statistics["bestObjectiveBound"] = solver.best_objective_bound

        soft_violations: list[SoftConstraintViolation] = []
        for tracked in tracked_constraints:
            violation_amount = int(solver.value(tracked.violation_var))
            if violation_amount <= 0:
                continue
            actual_value = sum(int(solver.value(vars_map[t.var])) * t.coeff for t in tracked.terms)
            soft_violations.append(
                SoftConstraintViolation(
                    constraintId=tracked.constraint_id,
                    violationAmount=violation_amount,
                    targetValue=tracked.target_value,
                    actualValue=actual_value,
                )
            )

        return SolverResponse(
            status=status_text,
            values={name: int(solver.value(var)) for name, var in vars_map.items()},
            statistics=statistics,
            softViolations=soft_violations if soft_violations else None,
        )
    except Exception as exc:  # pragma: no cover - surfaced in response
        return SolverResponse(status="ERROR", error=str(exc))
