from solver.models import Constraint, Objective, SolverRequest, Term, Variable
from solver.solver import solve_request


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
    assert response.softViolations is not None
    assert response.softViolations[0].constraintId == "coverage:test:2024-02-01:540"
    assert response.softViolations[0].violationAmount == 1
    assert response.softViolations[0].targetValue == 1
    assert response.softViolations[0].actualValue == 0


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
