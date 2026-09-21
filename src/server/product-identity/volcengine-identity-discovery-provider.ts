import "server-only";

import {
  productIdentityDiscoveryInputSchema,
  productIdentityDiscoveryResultSchema,
  type ProductIdentityDiscoveryInput,
  type ProductIdentityDiscoveryResult,
} from "@/schemas/product-identity-discovery";
import { productIdentityDebug } from "./identity-research-debug";

export type IdentityDiscoveryProvider = {
  discover(input: ProductIdentityDiscoveryInput): Promise<ProductIdentityDiscoveryResult>;
};

type ProviderOptions = {
  apiKey: string;
  model: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  firstEventTimeoutMs?: number;
  overallTimeoutMs?: number;
};

const DEFAULT_FIRST_EVENT_TIMEOUT_MS = 20_000;
const DEFAULT_OVERALL_TIMEOUT_MS = 45_000;

export function createVolcengineIdentityDiscoveryProvider(options: ProviderOptions): IdentityDiscoveryProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const overallTimeoutMs = options.overallTimeoutMs ?? options.timeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS;
  const firstEventTimeoutMs = Math.min(options.firstEventTimeoutMs ?? DEFAULT_FIRST_EVENT_TIMEOUT_MS, overallTimeoutMs);

  return {
    async discover(raw) {
      const input = productIdentityDiscoveryInputSchema.parse(raw);
      const controller = new AbortController();
      let timeoutKind: "first_event_timeout" | "overall_timeout" | null = null;
      const firstEventTimer = setTimeout(() => { timeoutKind = "first_event_timeout"; controller.abort(); }, firstEventTimeoutMs);
      const overallTimer = setTimeout(() => { timeoutKind = "overall_timeout"; controller.abort(); }, overallTimeoutMs);
      try {
        const response = await awaitWithAbort(fetchImpl(options.baseUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json", Accept: "text/event-stream" },
          signal: controller.signal,
          body: JSON.stringify({
            model: options.model,
            input: `${identityDiscoveryPrompt}\nINPUT:${JSON.stringify(input)}`,
            tools: [{ type: "web_search", web_search: {} }],
            stream: true,
            thinking: { type: "disabled" },
          }),
        }), controller.signal);
        if (!response.ok || response.body === null) return unavailable("http_error");
        const streamed = await readIdentityDiscoveryStream(response.body, controller.signal, () => clearTimeout(firstEventTimer));
        const cleaned = stripJsonFence(streamed.outputText);
        let json: unknown;
        try { json = JSON.parse(cleaned); } catch {
          productIdentityDebug("External Discovery Provider Schema", { json_parse_success: false });
          return unavailable("schema_error");
        }
        const parsed = productIdentityDiscoveryResultSchema.safeParse(json);
        if (!parsed.success) {
          productIdentityDebug("External Discovery Provider Schema", {
            json_parse_success: true, schema_success: false,
            issues: parsed.error.issues.slice(0, 5).map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message })),
          });
          return unavailable("schema_error");
        }
        return { ...parsed.data, research_run_id: parsed.data.research_run_id ?? streamed.researchRunId };
      } catch {
        return unavailable(timeoutKind ?? "unknown");
      } finally {
        clearTimeout(firstEventTimer);
        clearTimeout(overallTimer);
      }
    },
  };
}

async function readIdentityDiscoveryStream(body: ReadableStream<Uint8Array>, signal: AbortSignal, onFirstEvent: () => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outputText = "";
  let researchRunId: string | null = null;
  let receivedEvent = false;
  let completed = false;

  while (!completed) {
    const read = await readWithAbort(reader, signal);
    if (read.done) break;
    buffer += decoder.decode(read.value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const event = parseSseFrame(buffer.slice(0, boundary).replace(/\r/g, ""));
      buffer = buffer.slice(boundary + 2);
      if (event === null) continue;
      if (!receivedEvent) { receivedEvent = true; onFirstEvent(); }
      if (event.type === "response.output_text.delta") {
        if (typeof event.delta !== "string") throw new Error("MALFORMED_OUTPUT_TEXT_DELTA");
        outputText += event.delta;
      }
      if (event.type === "response.created") researchRunId = responseIdFromEvent(event) ?? researchRunId;
      if (event.type === "response.completed") completed = true;
    }
  }
  if (!receivedEvent || !completed || outputText.trim().length === 0) throw new Error("INCOMPLETE_IDENTITY_DISCOVERY_STREAM");
  return { outputText, researchRunId };
}

async function readWithAbort(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal) {
  return awaitWithAbort(reader.read(), signal);
}

async function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) throw new Error("STREAM_ABORTED");
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("STREAM_ABORTED")), { once: true })),
  ]);
}

function parseSseFrame(frame: string): Record<string, unknown> | null {
  const data = frame.split("\n").filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart()).join("\n");
  if (!data || data === "[DONE]") return null;
  const parsed: unknown = JSON.parse(data);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || typeof (parsed as { type?: unknown }).type !== "string") {
    throw new Error("MALFORMED_SSE_EVENT");
  }
  return parsed as Record<string, unknown>;
}

function responseIdFromEvent(event: Record<string, unknown>) {
  const response = event.response;
  return typeof response === "object" && response !== null && typeof (response as { id?: unknown }).id === "string"
    ? (response as { id: string }).id : null;
}

function stripJsonFence(value: string) { return value.trim().replace(/^```json\s*|\s*```$/gi, ""); }

export function createConfiguredVolcengineIdentityDiscoveryProvider() {
  const apiKey = process.env.VOLCENGINE_AGENT_PLAN_KEY?.trim();
  const model = process.env.VOLCENGINE_AGENT_PLAN_MODEL?.trim();
  const baseUrl = process.env.VOLCENGINE_AGENT_PLAN_BASE_URL?.trim();
  return apiKey && model && baseUrl ? createVolcengineIdentityDiscoveryProvider({ apiKey, model, baseUrl }) : null;
}

function unavailable(failureKind: "first_event_timeout" | "overall_timeout" | "http_error" | "schema_error" | "empty_output" | "unknown"): ProductIdentityDiscoveryResult {
  productIdentityDebug("External Discovery Provider", {
    discovery_status: "unavailable",
    failure_kind: failureKind,
  });
  return { status: "unavailable", candidates: [], research_run_id: null };
}

export const identityDiscoveryPrompt = "You are Beauty OS Product Identity Discovery Agent. Use application-supplied SEARCH_RESULTS first as explicit search leads for product identity. They are unverified leads, not facts. Agent-Plan web_search is supplemental only when those leads do not resolve the identity. Return only one strict JSON object: no Markdown fences and no prose. It has exactly status, candidates, research_run_id. status is found, ambiguous, unresolved, or unavailable. research_run_id is string|null. Every candidate includes candidate_id, brand_name, product_name, aliases, variant_name, barcode, image_url, short_descriptor, confidence, sources, uncertainties. candidate_id/brand_name/product_name are strings; aliases/uncertainties are string arrays; variant_name/barcode/short_descriptor are string|null; image_url must always be null; confidence is integer 0-100. Every source is {url,title,source_type}: url is a real HTTPS URL, title/source_type are string|null. Never omit nullable fields or use 'unknown' instead of null. Found/ambiguous needs candidates and each candidate needs at least one source; unresolved/unavailable has no candidates. Return found with one uniquely supported product, ambiguous only for real ambiguity, unresolved when evidence is insufficient. Never invent product facts.";
