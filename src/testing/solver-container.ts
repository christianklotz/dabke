/**
 * Test utility for starting and managing the solver Docker container.
 *
 * This module provides a Node.js-compatible way to spin up the solver container
 * for integration tests. It handles:
 * - Building the Docker image (once per process)
 * - Starting containers on dynamic ports
 * - Health checking before returning
 * - Cleanup on stop
 *
 * @example
 * ```typescript
 * import { startSolverContainer } from "dabke/testing";
 *
 * const solver = await startSolverContainer();
 * // solver.client is ready to use
 * const response = await solver.client.solve(request);
 * solver.stop();
 * ```
 */

import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { HttpSolverClient } from "../client.js";

const __dirname = fileURLToPath(new NodeURL(".", import.meta.url));
// src/testing/ -> src/ -> package root -> solver/
const defaultSolverDir = resolve(__dirname, "..", "..", "solver");

let imageBuilt = false;

const allocatePort = (): Promise<number> =>
  new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", (err) => {
      server.close();
      reject(err);
    });
    server.listen(0, () => {
      const address = server.address();
      if (typeof address === "object" && address) {
        const { port } = address;
        server.close(() => resolvePort(port));
      } else {
        server.close(() => reject(new Error("Could not allocate port")));
      }
    });
  });

export interface SolverContainerOptions {
  /** Port to expose the solver on. If not provided, a random available port is allocated. */
  port?: number;
  /** Directory containing the solver Dockerfile. Defaults to the solver/ directory in the package. */
  solverDir?: string;
  /** Docker image tag to use. Defaults to "dabke-solver:test". */
  imageTag?: string;
  /** Skip building the image (assume it already exists). */
  skipBuild?: boolean;
}

export interface SolverContainer {
  /** The port the solver is running on. */
  port: number;
  /** Pre-configured HTTP client for the solver. */
  client: HttpSolverClient;
  /** Stop and remove the container. */
  stop: () => void;
  /** Check if the solver is still healthy. Throws if not. */
  ensureHealthy: () => Promise<void>;
}

const ensureSolverImage = (solverDir: string, imageTag: string) => {
  if (imageBuilt) return;

  const buildResult = spawnSync("docker", ["build", "-t", imageTag, "."], {
    cwd: solverDir,
    stdio: "inherit",
  });

  if (buildResult.error) {
    throw new Error(`Docker build spawn error: ${buildResult.error.message}`);
  }
  if (buildResult.status !== 0) {
    throw new Error(`Docker build failed with status ${buildResult.status}`);
  }

  imageBuilt = true;
};

/**
 * Start a solver container for testing.
 *
 * Builds the Docker image if needed, starts a container on an available port,
 * waits for the health endpoint to respond, and returns a client.
 */
export const startSolverContainer = async (
  options: SolverContainerOptions = {},
): Promise<SolverContainer> => {
  const {
    port,
    solverDir = defaultSolverDir,
    imageTag = "dabke-solver:test",
    skipBuild = false,
  } = options;

  if (!skipBuild) {
    ensureSolverImage(solverDir, imageTag);
  }

  const resolvedPort = port ?? (await allocatePort());

  const runResult = spawnSync("docker", [
    "run",
    "-d",
    "--rm",
    "-p",
    `${resolvedPort}:8080`,
    imageTag,
  ]);

  if (runResult.error) {
    throw new Error(`Docker run spawn error: ${runResult.error.message}`);
  }
  if (runResult.status !== 0) {
    throw new Error(`Docker run failed: ${runResult.stderr?.toString()}`);
  }

  const containerId = runResult.stdout.toString().trim();

  const client = new HttpSolverClient(fetch, `http://localhost:${resolvedPort}`);

  // Wait for container to be healthy (up to 30 seconds)
  /* oxlint-disable no-await-in-loop -- Retry loop requires sequential attempts */
  let attempts = 0;
  while (attempts < 60) {
    try {
      await client.health?.();
      break;
    } catch {
      attempts += 1;
      await delay(500);
    }
  }
  /* oxlint-enable no-await-in-loop */

  if (attempts >= 60) {
    // Clean up the container if health check never succeeded
    spawnSync("docker", ["rm", "-f", containerId], { stdio: "ignore" });
    throw new Error("Solver container failed to become healthy after 30 seconds");
  }

  return {
    port: resolvedPort,
    client,
    stop: () => {
      spawnSync("docker", ["rm", "-f", containerId], { stdio: "ignore" });
    },
    async ensureHealthy() {
      try {
        await client.health?.();
      } catch (err) {
        throw new Error(
          `Solver container health check failed. Container may have crashed. Error: ${err}`,
        );
      }
    },
  };
};
