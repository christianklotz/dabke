/**
 * Test utilities for dabke.
 *
 * Provides helpers for integration testing against a CP-SAT solver.
 * The solver implementation is injectable via the SolverClient interface
 * from the main package. Bring your own Docker container, hosted service, or mock.
 *
 * @packageDocumentation
 */

export type { SolverContainerOptions, SolverContainer } from "./solver-container.js";
export { startSolverContainer } from "./solver-container.js";
