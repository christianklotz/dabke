/**
 * Global setup for integration tests.
 *
 * Starts a single solver container shared by all test files and guarantees
 * cleanup even if the process is killed or tests crash.
 */

import type { TestProject } from "vitest/node";
import { startSolverContainer, type SolverContainer } from "../src/testing/solver-container.js";

let solver: SolverContainer | undefined;

export async function setup(project: TestProject) {
  solver = await startSolverContainer();
  project.provide("solverPort", solver.port);
}

export function teardown() {
  solver?.stop();
}

declare module "vitest" {
  export interface ProvidedContext {
    solverPort: number;
  }
}
