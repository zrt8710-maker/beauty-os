import "server-only";

export const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 30_000;

export function providerRequestSignal(timeoutMs = DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS) {
  return AbortSignal.timeout(timeoutMs);
}
