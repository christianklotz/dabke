/**
 * Error thrown when Google OR Tools scheduling API requests fail.
 *
 * Contains the HTTP status code and raw response data from the API for debugging.
 * Common causes include infeasible constraints, invalid requests, or API unavailability.
 *
 * @category Solver
 */
export class ORSchedulingError extends Error {
  public readonly status: number;
  public readonly data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "ORSchedulingError";
    this.status = status;
    this.data = data;
  }
}
