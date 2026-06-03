import pytest

from solver.models import (
    Constraint,
    Objective,
    Options,
    SolverObjectiveStage,
    SolverRequest,
    SolverStageResult,
    Term,
    Variable,
)
from solver.solver import _aggregate_stage_status, solve_request


def test_linear_feasible_solution():
    request = SolverRequest(
        variables=[Variable(type="bool", name="x")],
        constraints=[
            Constraint(
                type="linear",
                terms=[Term(var="x", coeff=1)],
                op="==",
                rhs=1,
            )
        ],
    )

    response = solve_request(request)

    assert response.status == "OPTIMAL"
    assert response.values == {"x": 1}


def test_soft_linear_penalty_drives_feasible_choice():
    request = SolverRequest(
        variables=[Variable(type="bool", name="x")],
        constraints=[
            Constraint(
                type="soft_linear",
                terms=[Term(var="x", coeff=1)],
                op="<=",
                rhs=0,
                penalty=10,
            )
        ],
    )

    response = solve_request(request)

    assert response.status == "OPTIMAL"
    assert response.values == {"x": 0}
    assert response.statistics is not None
    assert "objectiveValue" in response.statistics


def test_penalty_offsets_maximize_objective():
    request = SolverRequest(
        variables=[Variable(type="bool", name="x")],
        constraints=[
            Constraint(
                type="soft_linear",
                terms=[Term(var="x", coeff=1)],
                op="<=",
                rhs=0,
                penalty=15,
            )
        ],
        objective=Objective(
            sense="maximize",
            terms=[Term(var="x", coeff=10)],
        ),
    )

    response = solve_request(request)

    assert response.status == "OPTIMAL"
    # Penalty (15) outweighs reward (10) so the solver prefers x=0
    assert response.values == {"x": 0}


def test_exactly_one_constraint():
    request = SolverRequest(
        variables=[
            Variable(type="bool", name="a"),
            Variable(type="bool", name="b"),
            Variable(type="bool", name="c"),
        ],
        constraints=[
            Constraint(type="exactly_one", vars=["a", "b", "c"]),
        ],
        objective=Objective(
            sense="minimize",
            terms=[Term(var="b", coeff=1)],  # prefer picking a/c over b
        ),
    )

    response = solve_request(request)

    assert response.status == "OPTIMAL"
    assert response.values is not None
    assert sum(response.values.values()) == 1
    assert response.values["b"] == 0


def test_implication_enforced():
    request = SolverRequest(
        variables=[Variable(type="bool", name="x"), Variable(type="bool", name="y")],
        constraints=[
            Constraint.model_validate({"type": "implication", "if": "x", "then": "y"}),
        ],
        objective=Objective(
            sense="maximize",
            terms=[Term(var="x", coeff=1), Term(var="y", coeff=2)],
        ),
    )

    response = solve_request(request)

    assert response.status == "OPTIMAL"
    assert response.values == {"x": 1, "y": 1}


def test_soft_constraint_reports_violation_when_id_provided():
    request = SolverRequest(
        variables=[Variable(type="bool", name="x")],
        constraints=[
            Constraint(
                type="linear",
                terms=[Term(var="x", coeff=1)],
                op="==",
                rhs=0,
            ),
            Constraint(
                type="soft_linear",
                terms=[Term(var="x", coeff=1)],
                op=">=",
                rhs=1,
                penalty=5,
                id="coverage:test:2024-02-01:540",
            ),
        ],
    )

    response = solve_request(request)

    assert response.status == "OPTIMAL"
    assert response.softConstraintViolations is not None
    assert response.softConstraintViolations[0].constraintId == "coverage:test:2024-02-01:540"
    assert response.softConstraintViolations[0].violationAmount == 1
    assert response.softConstraintViolations[0].targetValue == 1
    assert response.softConstraintViolations[0].actualValue == 0


def test_infeasible_solution_reports_solution_info():
    request = SolverRequest(
        variables=[Variable(type="bool", name="x")],
        constraints=[
            Constraint(type="linear", terms=[Term(var="x", coeff=1)], op="==", rhs=0),
            Constraint(type="linear", terms=[Term(var="x", coeff=1)], op="==", rhs=1),
        ],
    )

    response = solve_request(request)

    assert response.status == "INFEASIBLE"
    assert response.solutionInfo is not None


def test_infeasible_solution_reports_tracked_constraint_ids():
    request = SolverRequest(
        variables=[Variable(type="bool", name="x")],
        options=Options(diagnostics="hard"),
        constraints=[
            Constraint(
                type="linear",
                terms=[Term(var="x", coeff=1)],
                op="==",
                rhs=0,
                id="must-be-zero",
            ),
            Constraint(
                type="linear",
                terms=[Term(var="x", coeff=1)],
                op="==",
                rhs=1,
                id="must-be-one",
            ),
        ],
    )

    response = solve_request(request)

    assert response.status == "INFEASIBLE"
    assert response.hardConstraintConflicts is not None
    assert {conflict.constraintId for conflict in response.hardConstraintConflicts} == {
        "must-be-zero",
        "must-be-one",
    }


def test_infeasible_solution_omits_hard_conflicts_by_default():
    request = SolverRequest(
        variables=[Variable(type="bool", name="x")],
        constraints=[
            Constraint(type="linear", terms=[Term(var="x", coeff=1)], op="==", rhs=0, id="zero"),
            Constraint(type="linear", terms=[Term(var="x", coeff=1)], op="==", rhs=1, id="one"),
        ],
    )

    response = solve_request(request)

    assert response.status == "INFEASIBLE"
    assert response.hardConstraintConflicts is None


def test_lexicographic_minimization_freezes_stage_1_before_stage_2():
    request = SolverRequest(
        variables=[Variable(type="bool", name="x")],
        constraints=[],
        objectiveStages=[
            SolverObjectiveStage(id="minimize-x", sense="minimize", terms=[Term(var="x", coeff=1)]),
            SolverObjectiveStage(id="maximize-x", sense="maximize", terms=[Term(var="x", coeff=1)]),
        ],
    )

    response = solve_request(request)

    assert response.status == "OPTIMAL"
    assert response.values == {"x": 0}
    assert response.stageResults is not None
    assert [stage.id for stage in response.stageResults] == ["minimize-x", "maximize-x"]
    assert [stage.objectiveValue for stage in response.stageResults] == [0, 0]


def test_lexicographic_maximization_freezes_stage_1_before_stage_2():
    request = SolverRequest(
        variables=[Variable(type="bool", name="x")],
        constraints=[],
        objectiveStages=[
            SolverObjectiveStage(id="maximize-x", sense="maximize", terms=[Term(var="x", coeff=1)]),
            SolverObjectiveStage(id="minimize-x", sense="minimize", terms=[Term(var="x", coeff=1)]),
        ],
    )

    response = solve_request(request)

    assert response.status == "OPTIMAL"
    assert response.values == {"x": 1}
    assert response.stageResults is not None
    assert [stage.objectiveValue for stage in response.stageResults] == [1, 1]


def test_staged_soft_linear_slack_belongs_to_declared_stage():
    request = SolverRequest(
        variables=[Variable(type="bool", name="x")],
        constraints=[
            Constraint(
                type="soft_linear",
                terms=[Term(var="x", coeff=1)],
                op=">=",
                rhs=1,
                penalty=10,
                id="want-x",
                stage="first",
            ),
            Constraint(
                type="soft_linear",
                terms=[Term(var="x", coeff=1)],
                op="<=",
                rhs=0,
                penalty=100,
                id="avoid-x",
                stage="second",
            ),
        ],
        objectiveStages=[
            SolverObjectiveStage(id="first", sense="minimize", terms=[]),
            SolverObjectiveStage(id="second", sense="minimize", terms=[]),
        ],
    )

    response = solve_request(request)

    assert response.status == "OPTIMAL"
    assert response.values == {"x": 1}
    assert response.stageResults is not None
    assert [stage.objectiveValue for stage in response.stageResults] == [0, 100]
    assert response.softConstraintViolations is not None
    assert [violation.constraintId for violation in response.softConstraintViolations] == ["avoid-x"]


def test_unknown_soft_stage_is_rejected():
    request = SolverRequest(
        variables=[Variable(type="bool", name="x")],
        constraints=[
            Constraint(
                type="soft_linear",
                terms=[Term(var="x", coeff=1)],
                op="<=",
                rhs=0,
                penalty=1,
                stage="missing",
            )
        ],
        objectiveStages=[SolverObjectiveStage(id="known", sense="minimize", terms=[Term(var="x", coeff=1)])],
    )

    response = solve_request(request)

    assert response.status == "ERROR"
    assert response.error is not None
    assert "not declared" in response.error


def test_missing_soft_stage_is_rejected_in_staged_mode():
    request = SolverRequest(
        variables=[Variable(type="bool", name="x")],
        constraints=[
            Constraint(
                type="soft_linear",
                terms=[Term(var="x", coeff=1)],
                op="<=",
                rhs=0,
                penalty=1,
            )
        ],
        objectiveStages=[SolverObjectiveStage(id="known", sense="minimize", terms=[Term(var="x", coeff=1)])],
    )

    response = solve_request(request)

    assert response.status == "ERROR"
    assert response.error is not None
    assert "requires stage" in response.error


def test_objective_and_objective_stages_are_rejected():
    request = SolverRequest(
        variables=[Variable(type="bool", name="x")],
        constraints=[],
        objective=Objective(sense="minimize", terms=[Term(var="x", coeff=1)]),
        objectiveStages=[SolverObjectiveStage(id="stage", sense="minimize", terms=[Term(var="x", coeff=1)])],
    )

    response = solve_request(request)

    assert response.status == "ERROR"
    assert response.error is not None
    assert "cannot both be present" in response.error


def test_satisfy_mode_ignores_soft_penalties_and_returns_hard_feasible_solution():
    request = SolverRequest(
        variables=[Variable(type="bool", name="x")],
        constraints=[
            Constraint(type="linear", terms=[Term(var="x", coeff=1)], op="==", rhs=1),
            Constraint(
                type="soft_linear",
                terms=[Term(var="x", coeff=1)],
                op="<=",
                rhs=0,
                penalty=100,
                id="prefer-zero",
            ),
        ],
        mode="satisfy",
    )

    response = solve_request(request)

    assert response.status == "OPTIMAL"
    assert response.values == {"x": 1}
    assert response.softConstraintViolations == []
    assert response.statistics is not None
    assert "objectiveValue" not in response.statistics


def test_satisfy_mode_validates_soft_constraints_with_unknown_variables():
    request = SolverRequest(
        variables=[Variable(type="bool", name="x")],
        constraints=[
            Constraint(
                type="soft_linear",
                terms=[Term(var="missing", coeff=1)],
                op="<=",
                rhs=0,
                penalty=100,
            ),
        ],
        mode="satisfy",
    )

    response = solve_request(request)

    assert response.status == "ERROR"
    assert response.error is not None
    assert "Unknown variable missing" in response.error


def test_satisfy_mode_validates_soft_constraint_required_fields():
    request = SolverRequest(
        variables=[Variable(type="bool", name="x")],
        constraints=[
            Constraint(
                type="soft_linear",
                terms=[Term(var="x", coeff=1)],
                op="<=",
                rhs=0,
            ),
        ],
        mode="satisfy",
    )

    response = solve_request(request)

    assert response.status == "ERROR"
    assert response.error is not None
    assert "requires terms, op, rhs, and penalty" in response.error


def test_objective_stages_with_solution_limit_one_is_rejected():
    request = SolverRequest(
        variables=[Variable(type="bool", name="x")],
        constraints=[],
        objectiveStages=[SolverObjectiveStage(id="stage", sense="minimize", terms=[Term(var="x", coeff=1)])],
        options=Options(solutionLimit=1),
    )

    response = solve_request(request)

    assert response.status == "ERROR"
    assert response.error is not None
    assert "solutionLimit=1" in response.error


def test_stage_metadata_is_returned():
    request = SolverRequest(
        variables=[Variable(type="bool", name="x")],
        constraints=[],
        objectiveStages=[SolverObjectiveStage(id="stage", sense="minimize", terms=[Term(var="x", coeff=1)])],
    )

    response = solve_request(request)

    assert response.stageResults is not None
    assert len(response.stageResults) == 1
    stage_result = response.stageResults[0]
    assert stage_result.id == "stage"
    assert stage_result.status == "OPTIMAL"
    assert stage_result.objectiveValue == 0
    assert stage_result.bestObjectiveBound == 0
    assert stage_result.solveTimeMs >= 0


def test_staged_failure_omits_values_when_no_stage_has_succeeded():
    request = SolverRequest(
        variables=[Variable(type="bool", name="x")],
        constraints=[
            Constraint(type="linear", terms=[Term(var="x", coeff=1)], op="==", rhs=0),
            Constraint(type="linear", terms=[Term(var="x", coeff=1)], op="==", rhs=1),
        ],
        objectiveStages=[SolverObjectiveStage(id="stage", sense="minimize", terms=[Term(var="x", coeff=1)])],
    )

    response = solve_request(request)

    assert response.status == "INFEASIBLE"
    assert response.values is None
    assert "values" not in response.model_dump(exclude_unset=True)


def test_aggregate_stage_status_returns_optimal_when_all_stages_are_optimal():
    stage_results = [
        SolverStageResult(id="stage-1", status="OPTIMAL", solveTimeMs=1),
        SolverStageResult(id="stage-2", status="OPTIMAL", solveTimeMs=1),
    ]

    assert _aggregate_stage_status(stage_results) == "OPTIMAL"


def test_aggregate_stage_status_downgrades_when_later_stage_is_feasible():
    stage_results = [
        SolverStageResult(id="stage-1", status="OPTIMAL", solveTimeMs=1),
        SolverStageResult(id="stage-2", status="FEASIBLE", solveTimeMs=1),
    ]

    assert _aggregate_stage_status(stage_results) == "FEASIBLE"


def test_aggregate_stage_status_downgrades_when_earlier_stage_is_feasible():
    stage_results = [
        SolverStageResult(id="stage-1", status="FEASIBLE", solveTimeMs=1),
        SolverStageResult(id="stage-2", status="OPTIMAL", solveTimeMs=1),
    ]

    assert _aggregate_stage_status(stage_results) == "FEASIBLE"


def test_aggregate_stage_status_returns_first_terminal_status():
    stage_results = [
        SolverStageResult(id="stage-1", status="OPTIMAL", solveTimeMs=1),
        SolverStageResult(id="stage-2", status="TIMEOUT", solveTimeMs=1),
        SolverStageResult(id="stage-3", status="ERROR", solveTimeMs=1),
    ]

    assert _aggregate_stage_status(stage_results) == "TIMEOUT"


def test_aggregate_stage_status_rejects_empty_stage_results():
    with pytest.raises(ValueError, match="empty stage results"):
        _aggregate_stage_status([])
