import { type FetcherLike, type SolverClient, type SolverRequest } from "./client.types.js";
import { SolverResponseSchema } from "./client.schemas.js";

export type {
  SolverClient,
  SolverRequest,
  SolverResponse,
  SolverVariable,
  SolverConstraint,
  SolverTerm,
  SolverObjective,
  FetcherLike,
} from "./client.types.js";

const normalizeFetch = (
  fetcher: FetcherLike,
): ((input: string | URL, init?: RequestInit) => Promise<Response>) => {
  if (typeof fetcher === "function") return fetcher;
  return fetcher.fetch.bind(fetcher);
};

/**
 * Generic HTTP client for the solver service.
 *
 * @category Solver
 */
export class HttpSolverClient implements SolverClient {
  #fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
  #baseUrl: string;

  constructor(fetcher: FetcherLike, baseUrl: string = "http://localhost:8080") {
    this.#fetch = normalizeFetch(fetcher);
    this.#baseUrl = baseUrl.replace(/\/$/, "");
  }

  async solve(request: SolverRequest, options?: { signal?: AbortSignal }) {
    const res = await this.#fetch(`${this.#baseUrl}/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: options?.signal,
    });

    const bodyText = await res.text();
    if (!res.ok) {
      const detail = bodyText ? `: ${bodyText}` : "";
      throw new Error(`Solver returned ${res.status}${detail}`);
    }

    if (!bodyText) {
      throw new Error("Solver returned an empty response");
    }

    return SolverResponseSchema.parse(JSON.parse(bodyText));
  }

  async health(): Promise<void> {
    const res = await this.#fetch(`${this.#baseUrl}/health`);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const suffix = detail ? `: ${detail}` : "";
      throw new Error(`Solver health check failed with ${res.status}${suffix}`);
    }
  }
}
