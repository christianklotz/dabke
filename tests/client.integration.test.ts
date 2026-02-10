import { beforeAll, describe, expect, it, inject } from "vitest";
import { HttpSolverClient, type SolverRequest } from "../src/client.js";

describe("Solver service container", () => {
  let client: HttpSolverClient;

  beforeAll(() => {
    const port = inject("solverPort");
    client = new HttpSolverClient(fetch, `http://localhost:${port}`);
  });

  it("solves a simple boolean constraint", async () => {
    const request: SolverRequest = {
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

    const response = await client.solve(request);
    expect(response.status).toBe("OPTIMAL");
    expect(response.values?.x).toBe(1);
  }, 20_000);
});
