import { describe, expect, it, vi } from "vitest";

import { createVolcengineIdentityDiscoveryProvider } from "@/server/product-identity/volcengine-identity-discovery-provider";

const validResult = {
  status: "found",
  research_run_id: null,
  candidates: [{
    candidate_id: "hfp-1", brand_name: "HomeFacialPro", product_name: "果酸净肤水",
    aliases: ["HFP果酸水"], variant_name: null, barcode: null, image_url: null,
    short_descriptor: "果酸护理水", confidence: 88,
    sources: [{ url: "https://www.homefacialpro.com/", title: "HFP", source_type: "official" }],
    uncertainties: [],
  }],
};

const clue = {
  source: "manual_search" as const, raw_query: "HFP果酸水", brand_hint: null,
  product_name_hint: "HFP果酸水", barcode_hint: null, observed_text: [], recognition_confidence: null, search_results: [],
};

describe("Volcengine identity discovery streaming provider", () => {
  it("sends Agent2-only disabled thinking with stream and parses a response without reasoning", async () => {
    const output = JSON.stringify(validResult);
    const fetchImpl = vi.fn().mockResolvedValue(responseFromEvents([
      event("response.created", { response: { id: "resp-1" } }),
      event("response.output_text.delta", { delta: output.slice(0, 20) }),
      event("response.output_text.delta", { delta: output.slice(20) }),
      event("response.output_text.done", {}),
      event("response.completed", {}),
    ]));

    const result = await provider(fetchImpl).discover(clue);

    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: "doubao-seed-2.1-turbo",
      stream: true,
      thinking: { type: "disabled" },
      tools: [{ type: "web_search", web_search: {} }],
    });
    expect(result).toMatchObject({ status: "found", research_run_id: "resp-1", candidates: [{ product_name: "果酸净肤水" }] });
  });

  it("places application-controlled SearchInfinity leads into the Agent2 request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(responseFromEvents([
      event("response.output_text.delta", { delta: JSON.stringify(validResult) }),
      event("response.completed", {}),
    ]));
    await provider(fetchImpl).discover({ ...clue, search_results: [{
      title: "HFP 果酸水", url: "https://example.com/hfp", snippet: "official product", summary: null,
      site_name: "Example", rank_score: 0.9, authority_level: null, authority_description: null,
    }] });

    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).input).toContain("https://example.com/hfp");
  });

  it("safely ignores an unexpected reasoning event as non-business output", async () => {
    const result = await provider(vi.fn().mockResolvedValue(responseFromEvents([
      event("response.reasoning_summary_text.delta", { delta: "not business output" }),
      event("response.output_text.delta", { delta: JSON.stringify(validResult) }),
      event("response.completed", {}),
    ]))).discover(clue);
    expect(result).toMatchObject({ status: "found", candidates: [{ product_name: "果酸净肤水" }] });
  });

  it("returns unavailable for malformed SSE or an invalid final candidate schema", async () => {
    const malformed = await provider(vi.fn().mockResolvedValue(responseFromEvents(["data: not-json\n\n"]))).discover(clue);
    const invalid = await provider(vi.fn().mockResolvedValue(responseFromEvents([
      event("response.output_text.delta", { delta: '{"status":"found","candidates":[]}' }),
      event("response.completed", {}),
    ]))).discover(clue);
    expect(malformed).toEqual(unavailable());
    expect(invalid).toEqual(unavailable());
  });

  it("returns unavailable when the stream closes before response.completed", async () => {
    const result = await provider(vi.fn().mockResolvedValue(responseFromEvents([
      event("response.output_text.delta", { delta: JSON.stringify(validResult) }),
    ]))).discover(clue);
    expect(result).toEqual(unavailable());
  });

  it("returns unavailable when no first SSE event arrives before its deadline", async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
    await expect(provider(fetchImpl as unknown as typeof fetch, { firstEventTimeoutMs: 5, overallTimeoutMs: 50 }).discover(clue)).resolves.toEqual(unavailable());
  });

  it("returns unavailable when completion exceeds the overall deadline after an SSE event", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(encoder.encode(event("response.created", {}))); },
    });
    const result = await provider(vi.fn().mockResolvedValue(new Response(stream)), { firstEventTimeoutMs: 50, overallTimeoutMs: 5 }).discover(clue);
    expect(result).toEqual(unavailable());
  });

  it("returns unavailable for HTTP failure and never calls response.json", async () => {
    const response = new Response("bad gateway", { status: 502 });
    const result = await provider(vi.fn().mockResolvedValue(response)).discover(clue);
    expect(result).toEqual(unavailable());
  });
});

const encoder = new TextEncoder();

function provider(fetchImpl: typeof fetch, timeouts?: { firstEventTimeoutMs?: number; overallTimeoutMs?: number }) {
  return createVolcengineIdentityDiscoveryProvider({
    apiKey: "test-key", model: "doubao-seed-2.1-turbo", baseUrl: "https://example.test/responses", fetchImpl,
    ...timeouts,
  });
}

function responseFromEvents(events: string[]) {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const item of events) controller.enqueue(encoder.encode(item));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function event(type: string, payload: Record<string, unknown>) {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
}

function unavailable() { return { status: "unavailable", candidates: [], research_run_id: null }; }
