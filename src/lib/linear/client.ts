export interface GraphQLPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface GraphQLErrorShape {
  message: string;
  extensions?: { code?: string; [key: string]: unknown };
  path?: Array<string | number>;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLErrorShape[];
}

export class LinearGraphQLClient {
  constructor(
    private readonly apiKey: string,
    private readonly endpoint = "https://api.linear.app/graphql",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<T>(
    query: string,
    variables: Record<string, unknown> = {},
    operationName?: string,
  ): Promise<T> {
    const maximumAttempts = 4;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(this.endpoint, {
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: this.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query, variables, operationName }),
          signal: AbortSignal.timeout(30_000),
        });

        const payload = (await response.json()) as GraphQLResponse<T>;
        const rateLimited = payload.errors?.some(
          (error) => error.extensions?.code === "RATELIMITED",
        );

        if (rateLimited || response.status === 429 || response.status >= 500) {
          if (attempt === maximumAttempts) {
            throw new Error(formatFailure(response.status, payload.errors));
          }
          const retryAfter = retryDelayMs(response.headers, attempt);
          await delay(retryAfter);
          continue;
        }

        if (!response.ok || payload.errors?.length) {
          throw new Error(formatFailure(response.status, payload.errors));
        }
        if (!payload.data) {
          throw new Error("Linear returned no data.");
        }
        return payload.data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const retryable =
          lastError.name === "TimeoutError" ||
          lastError.name === "AbortError" ||
          lastError instanceof TypeError;
        if (!retryable || attempt === maximumAttempts) throw lastError;
        await delay(250 * 2 ** (attempt - 1));
      }
    }

    throw lastError ?? new Error("Linear request failed.");
  }
}

function formatFailure(status: number, errors: GraphQLErrorShape[] | undefined): string {
  const detail = errors
    ?.map((error) => {
      const location = error.path?.length ? ` at ${error.path.join(".")}` : "";
      return `${error.message}${location}`;
    })
    .join("; ");
  return `Linear GraphQL request failed (${status})${detail ? `: ${detail}` : "."}`;
}

function retryDelayMs(headers: Headers, attempt: number): number {
  const retryAfter = headers.get("retry-after");
  if (retryAfter && Number.isFinite(Number(retryAfter))) {
    return Math.min(Number(retryAfter) * 1_000, 30_000);
  }

  const reset = headers.get("x-ratelimit-requests-reset");
  if (reset && Number.isFinite(Number(reset))) {
    return Math.min(Math.max(Number(reset) - Date.now(), 250), 30_000);
  }

  return 500 * 2 ** (attempt - 1);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

