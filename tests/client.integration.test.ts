import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpSolverClient, type SolverRequest } from "../src/client.js";

const __dirname = fileURLToPath(new NodeURL(".", import.meta.url));
// tests/ -> feasible/ -> packages/ -> repo root
const repoRoot = resolve(__dirname, "..", "..", "..");

const hasDocker = (() => {
  const result = spawnSync("docker", ["info"], { stdio: "ignore" });
  return result.status === 0;
})();

const describeIfDocker = hasDocker ? describe : describe.skip;

describeIfDocker("Solver service container", () => {
  const port = 18080;
  const baseUrl = `http://localhost:${port}`;
  let containerId: string | undefined;

  beforeAll(async () => {
    const buildResult = spawnSync(
      "docker",
      ["build", "-t", "scheduler-solver:test", "-f", "solver/Dockerfile", "."],
      {
        cwd: repoRoot,
        stdio: "inherit",
      },
    );
    if (buildResult.error) {
      throw new Error(`Docker build spawn error: ${buildResult.error.message}`);
    }
    if (buildResult.status !== 0) {
      throw new Error(`Docker build failed with status ${buildResult.status}`);
    }

    const runResult = spawnSync("docker", [
      "run",
      "-d",
      "--rm",
      "-p",
      `${port}:8080`,
      "scheduler-solver:test",
    ]);
    if (runResult.error) {
      throw new Error(`Docker run spawn error: ${runResult.error.message}`);
    }
    if (runResult.status !== 0) {
      throw new Error(`Docker run failed: ${runResult.stderr?.toString()}`);
    }
    containerId = runResult.stdout.toString().trim();

    const client = new HttpSolverClient(fetch, baseUrl);
    let attempts = 0;
    while (attempts < 30) {
      try {
        await client.health();
        return;
      } catch {
        attempts += 1;
        await delay(500);
      }
    }

    throw new Error("Solver container did not become healthy in time");
  }, 120_000);

  afterAll(() => {
    if (containerId) {
      spawnSync("docker", ["rm", "-f", containerId], { stdio: "ignore" });
    }
  });

  it("solves a simple boolean constraint", async () => {
    const client = new HttpSolverClient(fetch, baseUrl);
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
