import { describe, expect, it } from "vitest";
import { SolverRequestSchema, SolverResponseSchema } from "../src/client.schemas.js";

const makeBaseRequest = () => ({
  variables: [{ type: "bool", name: "x" }],
  constraints: [],
});

const objectiveStage = {
  id: "primary",
  sense: "minimize",
  terms: [{ var: "x", coeff: 1 }],
};

const objective = {
  sense: "minimize",
  terms: [{ var: "x", coeff: 1 }],
};

describe("solver transport schemas", () => {
  it("parses objectiveStages", () => {
    const request = SolverRequestSchema.parse({
      ...makeBaseRequest(),
      objectiveStages: [objectiveStage],
    });

    expect(request.objectiveStages?.[0]?.id).toBe("primary");
    expect(request.objectiveStages?.[0]?.sense).toBe("minimize");
  });

  it("parses staged soft_linear constraints", () => {
    const request = SolverRequestSchema.parse({
      ...makeBaseRequest(),
      constraints: [
        {
          type: "soft_linear",
          terms: [{ var: "x", coeff: 1 }],
          op: "<=",
          rhs: 0,
          penalty: 10,
          stage: "primary",
        },
      ],
      objectiveStages: [objectiveStage],
    });

    const constraint = request.constraints[0];
    if (constraint?.type !== "soft_linear") {
      throw new Error("Expected soft_linear constraint");
    }
    expect(constraint.stage).toBe("primary");
  });

  it("parses stageResults", () => {
    const response = SolverResponseSchema.parse({
      status: "OPTIMAL",
      values: { x: 1 },
      softConstraintViolations: [],
      stageResults: [
        {
          id: "primary",
          status: "OPTIMAL",
          objectiveValue: 0,
          bestObjectiveBound: 0,
          solveTimeMs: 4,
        },
      ],
    });

    expect(response.stageResults?.[0]?.id).toBe("primary");
    expect(response.stageResults?.[0]?.objectiveValue).toBe(0);
  });

  it("parses staged terminal responses without values", () => {
    const response = SolverResponseSchema.parse({
      status: "INFEASIBLE",
      statistics: { solveTimeMs: 4 },
      stageResults: [
        {
          id: "primary",
          status: "INFEASIBLE",
          solveTimeMs: 4,
        },
      ],
    });

    expect(response.status).toBe("INFEASIBLE");
    expect(response.values).toBeUndefined();
  });

  it("rejects staged terminal responses with null values", () => {
    const result = SolverResponseSchema.safeParse({
      status: "INFEASIBLE",
      values: null,
      stageResults: [
        {
          id: "primary",
          status: "INFEASIBLE",
          solveTimeMs: 4,
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("parses satisfy mode", () => {
    const request = SolverRequestSchema.parse({
      ...makeBaseRequest(),
      mode: "satisfy",
    });

    expect(request.mode).toBe("satisfy");
  });

  it("parses hard diagnostic mode", () => {
    const request = SolverRequestSchema.parse({
      ...makeBaseRequest(),
      options: { diagnostics: "hard" },
    });

    expect(request.options?.diagnostics).toBe("hard");
  });

  it("rejects unknown diagnostic modes", () => {
    const result = SolverRequestSchema.safeParse({
      ...makeBaseRequest(),
      options: { diagnostics: "all" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects objective with objectiveStages", () => {
    const result = SolverRequestSchema.safeParse({
      ...makeBaseRequest(),
      objective,
      objectiveStages: [objectiveStage],
    });

    expect(result.success).toBe(false);
  });

  it("rejects empty objectiveStages", () => {
    const result = SolverRequestSchema.safeParse({
      ...makeBaseRequest(),
      objectiveStages: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate objectiveStage ids", () => {
    const result = SolverRequestSchema.safeParse({
      ...makeBaseRequest(),
      objectiveStages: [objectiveStage, objectiveStage],
    });

    expect(result.success).toBe(false);
  });

  it("rejects staged soft_linear constraints without a stage", () => {
    const result = SolverRequestSchema.safeParse({
      ...makeBaseRequest(),
      constraints: [
        {
          type: "soft_linear",
          terms: [{ var: "x", coeff: 1 }],
          op: "<=",
          rhs: 0,
          penalty: 10,
        },
      ],
      objectiveStages: [objectiveStage],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("requires stage");
    }
  });

  it("rejects staged soft_linear constraints with unknown stages", () => {
    const result = SolverRequestSchema.safeParse({
      ...makeBaseRequest(),
      constraints: [
        {
          type: "soft_linear",
          terms: [{ var: "x", coeff: 1 }],
          op: "<=",
          rhs: 0,
          penalty: 10,
          stage: "missing",
        },
      ],
      objectiveStages: [objectiveStage],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("not declared");
    }
  });

  it("rejects objectiveStages with solutionLimit one", () => {
    const result = SolverRequestSchema.safeParse({
      ...makeBaseRequest(),
      objectiveStages: [objectiveStage],
      options: { solutionLimit: 1 },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("solutionLimit=1");
    }
  });

  it("rejects satisfy mode with objective", () => {
    const result = SolverRequestSchema.safeParse({
      ...makeBaseRequest(),
      mode: "satisfy",
      objective,
    });

    expect(result.success).toBe(false);
  });

  it("rejects satisfy mode with objectiveStages", () => {
    const result = SolverRequestSchema.safeParse({
      ...makeBaseRequest(),
      mode: "satisfy",
      objectiveStages: [objectiveStage],
    });

    expect(result.success).toBe(false);
  });
});
