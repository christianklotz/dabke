import { describe, expect, it, vi } from "vitest";
import { HttpSolverClient } from "../src/client.js";
import { SOLVER_STATUS, type SolverRequest, type SolverResponse } from "../src/client.types.js";

const baseRequest: SolverRequest = {
  variables: [{ type: "bool", name: "x" }],
  constraints: [
    {
      type: "linear",
      terms: [{ var: "x", coeff: 1 }],
      op: ">=",
      rhs: 1,
    },
  ],
};

describe("HttpSolverClient", () => {
  it("sends solve request and parses response", async () => {
    const responseBody: SolverResponse = {
      status: "OPTIMAL",
      values: { x: 1 },
      statistics: { solveTimeMs: 5 },
    };

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify(responseBody), { status: 200 });
    });

    const client = new HttpSolverClient(fetchMock, "http://solver");
    const result = await client.solve(baseRequest);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://solver/solve",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(result).toEqual(responseBody);
  });

  it("throws when solver returns non-OK response", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response("boom", { status: 500 });
    });
    const client = new HttpSolverClient(fetchMock, "http://solver");

    await expect(() => client.solve(baseRequest)).rejects.toThrow(/500.*boom/);
  });

  it("fails health check on non-200 responses", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response("unhealthy", { status: 503 });
    });
    const client = new HttpSolverClient(fetchMock, "http://solver");

    await expect(() => client.health()).rejects.toThrow(/503/);
  });

  it("exposes solver status constants", () => {
    expect(SOLVER_STATUS.OPTIMAL).toBe("OPTIMAL");
    expect(SOLVER_STATUS.TIMEOUT).toBe("TIMEOUT");
  });
});
