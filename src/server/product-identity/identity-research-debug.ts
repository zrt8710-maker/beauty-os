import "server-only";

export type ProductIdentityTimingEvent = {
  stage: string;
  elapsed_ms: number;
  split_candidate_count?: number;
};

export type ProductIdentityTimingReporter = (event: ProductIdentityTimingEvent) => void;

/** Development-only observability for the read-only product identity chain. */
export function productIdentityDebug(stage: string, payload: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") return;
  // Callers may pass a short redacted provider excerpt, never credentials.
  console.info("[Product Identity Research Debug]", stage, payload);
}
