"""CP-SAT solver translation layer."""

from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter
from typing import Iterable

from ortools.sat.python import cp_model

from .models import (
    Constraint,
    Objective,
    Options,
    SolverObjectiveStage,
    SolverRequest,
    SolverResponse,
    SolverHardConstraintConflict,
    SolverSoftConstraintViolation,
    SolverStageResult,
    SolverStatus,
    Term,
    Variable,
)

_SUCCESSFUL_STATUSES = (cp_model.OPTIMAL, cp_model.FEASIBLE)
_STATUS_MAP: dict[int, str] = {
    int(cp_model.OPTIMAL): "OPTIMAL",
    int(cp_model.FEASIBLE): "FEASIBLE",
    int(cp_model.INFEASIBLE): "INFEASIBLE",
    int(cp_model.MODEL_INVALID): "ERROR",
    int(cp_model.UNKNOWN): "TIMEOUT",
}
_ObjectiveLike = Objective | SolverObjectiveStage


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


@dataclass
class _TrackedHardConstraint:
    """Tracks hard constraints guarded by CP-SAT assumptions."""

    constraint_id: str
    assumption_var: cp_model.IntVar


@dataclass
class _BuiltModel:
    """CP-SAT model and translation metadata."""

    model: cp_model.CpModel
    vars_map: dict[str, cp_model.IntVar]
    penalty_terms: list[cp_model.LinearExpr]
    penalty_terms_by_stage: dict[str, list[cp_model.LinearExpr]]
    tracked_soft_constraints: list[_TrackedSoftConstraint]
    tracked_hard_constraints: list[_TrackedHardConstraint]


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


def _sum_expr(exprs: list[cp_model.LinearExpr]) -> cp_model.LinearExpr | None:
    if not exprs:
        return None
    total = exprs[0]
    for expr in exprs[1:]:
        total += expr
    return total


def _add_linear_constraint(
    model: cp_model.CpModel,
    constraint: Constraint,
    vars_map: dict[str, cp_model.IntVar],
    tracked_hard_constraints: list[_TrackedHardConstraint],
    constraint_index: int,
    diagnose_hard_conflicts: bool,
) -> None:
    if not constraint.terms or constraint.op is None or constraint.rhs is None:
        raise ValueError("Linear constraint requires terms, op, and rhs")
    expr = sum(vars_map[t.var] * t.coeff for t in constraint.terms)
    constraint_builder: cp_model.Constraint
    match constraint.op:
        case "<=":
            constraint_builder = model.Add(expr <= constraint.rhs)
        case ">=":
            constraint_builder = model.Add(expr >= constraint.rhs)
        case "==":
            constraint_builder = model.Add(expr == constraint.rhs)
        case _:
            raise ValueError(f"Unsupported linear operator {constraint.op}")

    if not diagnose_hard_conflicts:
        return
    if constraint.id is None:
        return

    assumption = model.NewBoolVar(f"assume_{constraint_index}_{constraint.id}")
    constraint_builder.OnlyEnforceIf(assumption)
    model.AddAssumption(assumption)
    tracked_hard_constraints.append(
        _TrackedHardConstraint(constraint_id=constraint.id, assumption_var=assumption)
    )


def _add_soft_linear_constraint(
    model: cp_model.CpModel,
    constraint: Constraint,
    vars_map: dict[str, cp_model.IntVar],
    bounds: dict[str, _VariableBounds],
    penalty_terms: list[cp_model.LinearExpr],
    tracked_soft_constraints: list[_TrackedSoftConstraint],
    constraint_index: int,
) -> None:
    min_expr, max_expr = _validate_soft_linear_constraint(constraint, bounds)
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
            tracked_soft_constraints.append(
                _TrackedSoftConstraint(
                    constraint_id=constraint_id,
                    violation_var=violation,
                    target_value=constraint.rhs,
                    comparator=constraint.op,
                    terms=constraint.terms,
                )
            )


def _validate_soft_linear_constraint(
    constraint: Constraint,
    bounds: dict[str, _VariableBounds],
) -> tuple[int, int]:
    if not constraint.terms or constraint.op is None or constraint.rhs is None or constraint.penalty is None:
        raise ValueError("Soft linear constraint requires terms, op, rhs, and penalty")
    if constraint.op not in ("<=", ">="):
        raise ValueError(f"Unsupported soft linear operator {constraint.op}")
    return _expression_range(constraint.terms, bounds)


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


def _build_model(
    request: SolverRequest,
    *,
    ignore_soft_constraints: bool = False,
    diagnose_hard_conflicts: bool = False,
    stage_ids: set[str] | None = None,
) -> _BuiltModel:
    model = cp_model.CpModel()

    var_bounds = _collect_bounds(request.variables)
    vars_map: dict[str, cp_model.IntVar] = {}
    intervals_map: dict[str, cp_model.IntervalVar] = {}

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
                    raise ValueError(f"Interval variable {var.name} references unknown presenceVar {var.presenceVar}")
                presence = vars_map[var.presenceVar]
                intervals_map[var.name] = model.NewOptionalIntervalVar(start, size, end, presence, var.name)
        else:
            raise ValueError(f"Unsupported variable type {var.type}")

    penalty_terms: list[cp_model.LinearExpr] = []
    penalty_terms_by_stage: dict[str, list[cp_model.LinearExpr]] = (
        {stage_id: [] for stage_id in stage_ids} if stage_ids is not None else {}
    )
    tracked_soft_constraints: list[_TrackedSoftConstraint] = []
    tracked_hard_constraints: list[_TrackedHardConstraint] = []
    constraint_index = 0

    for constraint in request.constraints:
        match constraint.type:
            case "linear":
                _add_linear_constraint(
                    model,
                    constraint,
                    vars_map,
                    tracked_hard_constraints,
                    constraint_index,
                    diagnose_hard_conflicts,
                )
                constraint_index += 1
            case "soft_linear":
                if ignore_soft_constraints:
                    _validate_soft_linear_constraint(constraint, var_bounds)
                    constraint_index += 1
                    continue
                if stage_ids is not None:
                    if constraint.stage is None:
                        raise ValueError("Soft linear constraint requires stage when objectiveStages are used")
                    if constraint.stage not in stage_ids:
                        raise ValueError(f"Soft linear constraint stage {constraint.stage} is not declared")
                    target_penalty_terms = penalty_terms_by_stage[constraint.stage]
                else:
                    target_penalty_terms = penalty_terms
                _add_soft_linear_constraint(
                    model,
                    constraint,
                    vars_map,
                    var_bounds,
                    target_penalty_terms,
                    tracked_soft_constraints,
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

    return _BuiltModel(
        model=model,
        vars_map=vars_map,
        penalty_terms=penalty_terms,
        penalty_terms_by_stage=penalty_terms_by_stage,
        tracked_soft_constraints=tracked_soft_constraints,
        tracked_hard_constraints=tracked_hard_constraints,
    )


def _compose_objective_expression(
    objective: _ObjectiveLike | None,
    vars_map: dict[str, cp_model.IntVar],
    penalty_terms: list[cp_model.LinearExpr],
) -> cp_model.LinearExpr | None:
    penalty_expr = _sum_expr(penalty_terms)

    if objective:
        objective_terms: list[cp_model.LinearExpr] = (
            [vars_map[t.var] * t.coeff for t in objective.terms] if objective.terms else []
        )
        obj_expr: cp_model.LinearExpr | None = _sum_expr(objective_terms)
        if penalty_expr is not None and obj_expr is not None:
            return obj_expr + penalty_expr if objective.sense == "minimize" else obj_expr - penalty_expr
        if obj_expr is not None:
            return obj_expr
        if penalty_expr is not None:
            return penalty_expr if objective.sense == "minimize" else -penalty_expr
        return None

    return penalty_expr


def _build_objective(
    model: cp_model.CpModel,
    objective: _ObjectiveLike | None,
    vars_map: dict[str, cp_model.IntVar],
    penalty_terms: list[cp_model.LinearExpr],
) -> tuple[bool, cp_model.LinearExpr | None]:
    expr = _compose_objective_expression(objective, vars_map, penalty_terms)
    if expr is None:
        return False, None

    if objective is not None and objective.sense == "maximize":
        model.Maximize(expr)
    else:
        model.Minimize(expr)
    return True, expr


def _status_text(status: int) -> str:
    return _STATUS_MAP.get(int(status), "ERROR")


def _new_solver(options: Options, time_limit_seconds: float) -> cp_model.CpSolver:
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_seconds
    if options.solutionLimit == 1:
        solver.parameters.stop_after_first_solution = True
    return solver


def _solver_statistics(solver: cp_model.CpSolver, has_objective: bool) -> dict[str, int | float]:
    statistics: dict[str, int | float] = {
        "solveTimeMs": int(solver.wall_time * 1000),
        "conflicts": solver.num_conflicts,
        "branches": solver.num_branches,
    }

    if has_objective:
        statistics["objectiveValue"] = solver.objective_value
        statistics["bestObjectiveBound"] = solver.best_objective_bound

    return statistics


def _solution_values(vars_map: dict[str, cp_model.IntVar], solver: cp_model.CpSolver) -> dict[str, int]:
    return {name: int(solver.value(var)) for name, var in vars_map.items()}


def _collect_soft_constraint_violations(
    tracked_soft_constraints: list[_TrackedSoftConstraint],
    vars_map: dict[str, cp_model.IntVar],
    solver: cp_model.CpSolver,
) -> list[SolverSoftConstraintViolation]:
    soft_constraint_violations: list[SolverSoftConstraintViolation] = []
    for tracked in tracked_soft_constraints:
        violation_amount = int(solver.value(tracked.violation_var))
        if violation_amount <= 0:
            continue
        actual_value = sum(int(solver.value(vars_map[t.var])) * t.coeff for t in tracked.terms)
        soft_constraint_violations.append(
            SolverSoftConstraintViolation(
                constraintId=tracked.constraint_id,
                violationAmount=violation_amount,
                targetValue=tracked.target_value,
                actualValue=actual_value,
            )
        )
    return soft_constraint_violations


def _collect_hard_constraint_conflicts(
    tracked_hard_constraints: list[_TrackedHardConstraint],
    solver: cp_model.CpSolver,
) -> list[SolverHardConstraintConflict]:
    assumption_index_to_id = {
        tracked.assumption_var.Index(): tracked.constraint_id for tracked in tracked_hard_constraints
    }
    return [
        SolverHardConstraintConflict(constraintId=constraint_id)
        for assumption_index in solver.SufficientAssumptionsForInfeasibility()
        if (constraint_id := assumption_index_to_id.get(assumption_index)) is not None
    ]


def _hard_constraint_conflicts_for_status(
    status: int,
    built: _BuiltModel,
    solver: cp_model.CpSolver,
) -> list[SolverHardConstraintConflict]:
    if status != cp_model.INFEASIBLE:
        return []
    return _collect_hard_constraint_conflicts(built.tracked_hard_constraints, solver)


def _solution_info_kwargs(solver: cp_model.CpSolver) -> dict[str, str]:
    solution_info = solver.response_proto.solution_info
    return {"solutionInfo": solution_info} if solution_info else {}


def _values_kwargs(values: dict[str, int] | None) -> dict[str, dict[str, int]]:
    return {"values": values} if values is not None else {}


def _hard_constraint_conflicts_kwargs(
    conflicts: list[SolverHardConstraintConflict],
) -> dict[str, list[SolverHardConstraintConflict]]:
    return {"hardConstraintConflicts": conflicts} if conflicts else {}


def _response_from_solver(
    status: int,
    solver: cp_model.CpSolver,
    built: _BuiltModel,
    has_objective: bool,
    hard_constraint_conflicts: list[SolverHardConstraintConflict] | None = None,
) -> SolverResponse:
    status_text = _status_text(status)

    if status not in _SUCCESSFUL_STATUSES:
        return SolverResponse(
            status=status_text,
            **_solution_info_kwargs(solver),
            **_hard_constraint_conflicts_kwargs(hard_constraint_conflicts or []),
        )

    return SolverResponse(
        status=status_text,
        values=_solution_values(built.vars_map, solver),
        statistics=_solver_statistics(solver, has_objective),
        **_solution_info_kwargs(solver),
        softConstraintViolations=_collect_soft_constraint_violations(
            built.tracked_soft_constraints,
            built.vars_map,
            solver,
        ),
    )


def _validate_objective_stages(request: SolverRequest) -> list[SolverObjectiveStage]:
    stages = request.objectiveStages
    if stages is None:
        raise ValueError("objectiveStages are required for staged solving")
    if not stages:
        raise ValueError("objectiveStages cannot be empty")

    seen_stage_ids: set[str] = set()
    for stage in stages:
        if stage.id in seen_stage_ids:
            raise ValueError(f"Duplicate objective stage id {stage.id}")
        seen_stage_ids.add(stage.id)

    options = request.options or Options()
    if options.solutionLimit == 1:
        raise ValueError("objectiveStages cannot be used with solutionLimit=1")

    return stages


def _stage_result_from_solver(
    stage: SolverObjectiveStage,
    status: int,
    solver: cp_model.CpSolver,
    has_objective: bool,
) -> SolverStageResult:
    result_fields: dict[str, str | int | float] = {
        "id": stage.id,
        "status": _status_text(status),
        "solveTimeMs": int(solver.wall_time * 1000),
    }
    if has_objective and status in _SUCCESSFUL_STATUSES:
        result_fields["objectiveValue"] = solver.objective_value
        result_fields["bestObjectiveBound"] = solver.best_objective_bound
    return SolverStageResult(**result_fields)


def _aggregate_stage_status(stage_results: list[SolverStageResult]) -> SolverStatus:
    if not stage_results:
        raise ValueError("Cannot aggregate empty stage results")

    aggregate_status: SolverStatus = "OPTIMAL"
    for stage_result in stage_results:
        match stage_result.status:
            case "OPTIMAL":
                continue
            case "FEASIBLE":
                aggregate_status = "FEASIBLE"
            case "INFEASIBLE" | "TIMEOUT" | "ERROR":
                return stage_result.status

    return aggregate_status


def _staged_statistics(
    stage_results: list[SolverStageResult],
    conflicts: int,
    branches: int,
) -> dict[str, int | float]:
    statistics: dict[str, int | float] = {
        "solveTimeMs": sum(stage.solveTimeMs for stage in stage_results),
        "conflicts": conflicts,
        "branches": branches,
    }

    last_successful_stage = next(
        (stage for stage in reversed(stage_results) if stage.status in ("OPTIMAL", "FEASIBLE")),
        None,
    )
    if last_successful_stage is not None and last_successful_stage.objectiveValue is not None:
        statistics["objectiveValue"] = last_successful_stage.objectiveValue
    if last_successful_stage is not None and last_successful_stage.bestObjectiveBound is not None:
        statistics["bestObjectiveBound"] = last_successful_stage.bestObjectiveBound

    return statistics


def _solve_single_objective(request: SolverRequest) -> SolverResponse:
    options: Options = request.options or Options()
    built = _build_model(request, diagnose_hard_conflicts=options.diagnostics == "hard")
    has_objective, _ = _build_objective(
        built.model,
        request.objective,
        built.vars_map,
        built.penalty_terms,
    )

    solver = _new_solver(options, options.timeLimitSeconds)
    status = solver.Solve(built.model)
    hard_constraint_conflicts = _hard_constraint_conflicts_for_status(
        status,
        built,
        solver,
    )

    return _response_from_solver(status, solver, built, has_objective, hard_constraint_conflicts)


def _solve_satisfy(request: SolverRequest) -> SolverResponse:
    options: Options = request.options or Options()
    built = _build_model(
        request,
        ignore_soft_constraints=True,
        diagnose_hard_conflicts=options.diagnostics == "hard",
    )
    solver = _new_solver(options, options.timeLimitSeconds)
    status = solver.Solve(built.model)
    hard_constraint_conflicts = _hard_constraint_conflicts_for_status(
        status,
        built,
        solver,
    )

    return _response_from_solver(
        status,
        solver,
        built,
        has_objective=False,
        hard_constraint_conflicts=hard_constraint_conflicts,
    )


def _solve_staged(request: SolverRequest) -> SolverResponse:
    stages = _validate_objective_stages(request)
    stage_ids = {stage.id for stage in stages}
    options: Options = request.options or Options()
    built = _build_model(
        request,
        stage_ids=stage_ids,
        diagnose_hard_conflicts=options.diagnostics == "hard",
    )
    started_at = perf_counter()

    stage_results: list[SolverStageResult] = []
    last_solver: cp_model.CpSolver | None = None
    last_values: dict[str, int] | None = None
    total_conflicts = 0
    total_branches = 0

    for stage in stages:
        remaining_time = options.timeLimitSeconds - (perf_counter() - started_at)
        if remaining_time <= 0:
            stage_results.append(SolverStageResult(id=stage.id, status="TIMEOUT", solveTimeMs=0))
            return SolverResponse(
                status=_aggregate_stage_status(stage_results),
                **_values_kwargs(last_values),
                statistics=_staged_statistics(stage_results, total_conflicts, total_branches),
                stageResults=stage_results,
            )

        built.model.ClearObjective()
        has_objective, objective_expr = _build_objective(
            built.model,
            stage,
            built.vars_map,
            built.penalty_terms_by_stage[stage.id],
        )
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = remaining_time
        status = solver.Solve(built.model)
        total_conflicts += solver.num_conflicts
        total_branches += solver.num_branches

        stage_result = _stage_result_from_solver(stage, status, solver, has_objective)
        stage_results.append(stage_result)

        if status not in _SUCCESSFUL_STATUSES:
            hard_constraint_conflicts = _hard_constraint_conflicts_for_status(
                status,
                built,
                solver,
            )
            return SolverResponse(
                status=_aggregate_stage_status(stage_results),
                **_values_kwargs(last_values),
                statistics=_staged_statistics(stage_results, total_conflicts, total_branches),
                **_solution_info_kwargs(solver),
                **_hard_constraint_conflicts_kwargs(hard_constraint_conflicts),
                stageResults=stage_results,
            )

        last_solver = solver
        last_values = _solution_values(built.vars_map, solver)

        if has_objective and objective_expr is not None:
            achieved_value = int(solver.value(objective_expr))
            if stage.sense == "maximize":
                built.model.Add(objective_expr >= achieved_value)
            else:
                built.model.Add(objective_expr <= achieved_value)

    return SolverResponse(
        status=_aggregate_stage_status(stage_results),
        **_values_kwargs(last_values),
        statistics=_staged_statistics(stage_results, total_conflicts, total_branches),
        stageResults=stage_results,
        softConstraintViolations=_collect_soft_constraint_violations(
            built.tracked_soft_constraints,
            built.vars_map,
            last_solver,
        )
        if last_solver is not None
        else [],
    )


def solve_request(request: SolverRequest) -> SolverResponse:
    """Solve a scheduling request."""
    try:
        mode = request.mode or "optimize"

        if mode == "satisfy":
            if request.objective is not None:
                raise ValueError('mode "satisfy" cannot be used with objective')
            if request.objectiveStages is not None:
                raise ValueError('mode "satisfy" cannot be used with objectiveStages')
            return _solve_satisfy(request)

        if request.objective is not None and request.objectiveStages is not None:
            raise ValueError("objective and objectiveStages cannot both be present")

        if request.objectiveStages is not None:
            return _solve_staged(request)

        return _solve_single_objective(request)
    except Exception as exc:  # pragma: no cover - surfaced in response
        return SolverResponse(status="ERROR", error=str(exc))
