import "server-only";

export const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 30_000;

export function providerRequestSignal(timeoutMs = DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS) {
  return AbortSignal.timeout(timeoutMs);
}

const TRANSIENT_PROVIDER_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export type ProviderRequestAttempt = {
  attempt: number;
  durationMs: number;
  response: Response | null;
  error: unknown;
  willRetry: boolean;
};

/**
 * Retries only before a provider response becomes usable. Callers supply a
 * factory so every attempt receives a fresh AbortSignal.
 */
export async function fetchProviderWithEarlyRetry(input: {
  fetchImpl: typeof fetch;
  url: string;
  createInit: () => RequestInit;
  maxAttempts?: number;
  retryCutoffMs?: number;
  onAttempt?: (attempt: ProviderRequestAttempt) => void;
}) {
  const startedAt = Date.now();
  const maxAttempts = input.maxAttempts ?? 3;
  const retryCutoffMs = input.retryCutoffMs ?? 20_000;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptStartedAt = Date.now();
    try {
      const response = await input.fetchImpl(input.url, input.createInit());
      const willRetry = attempt < maxAttempts
        && TRANSIENT_PROVIDER_STATUSES.has(response.status)
        && Date.now() - startedAt <= retryCutoffMs;
      input.onAttempt?.({
        attempt,
        durationMs: Date.now() - attemptStartedAt,
        response,
        error: null,
        willRetry,
      });
      if (!willRetry) return response;
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      const willRetry = attempt < maxAttempts
        && !isProviderTimeout(error)
        && Date.now() - startedAt <= retryCutoffMs;
      input.onAttempt?.({
        attempt,
        durationMs: Date.now() - attemptStartedAt,
        response: null,
        error,
        willRetry,
      });
      if (!willRetry) throw error;
    }
  }
  throw new Error("PROVIDER_RETRY_EXHAUSTED");
}

function isProviderTimeout(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}
