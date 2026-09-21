import { describe, expect, it, vi } from "vitest";

import { ExternalProductDiscoveryUnavailableError, createAgentPlanExternalDiscoveryProvider } from "@/server/product-identity/agent-plan-external-discovery-provider";

const discoveryResult = {
  status: "found" as const,
  research_run_id: "run-1",
  candidates: [{
    candidate_id: "candidate-1", brand_name: "Brand", product_name: "Product", aliases: ["Alias"],
    variant_name: null, barcode: null, image_url: "https://example.com/untrusted-model-image.jpg", short_descriptor: "Descriptor", confidence: 81,
    sources: [{ url: "https://example.com/product", title: "Example", source_type: "official" }], uncertainties: ["Variant not confirmed"],
  }],
};

describe("Agent-Plan external identity adapter", () => {
  it("passes a real manual clue with manual_search source", async () => {
    const discover = vi.fn().mockResolvedValue(discoveryResult);
    await createAgentPlanExternalDiscoveryProvider({ discover }).discover({ clue: {
      source: "manual_search", raw_query: "Brand Product", brand_name: "Brand", product_name: "Product", recognition_confidence: null, observed_text: [],
    }, search_results: [] });
    expect(discover).toHaveBeenCalledWith(expect.objectContaining({ source: "manual_search", raw_query: "Brand Product", search_results: [] }));
  });

  it("passes image evidence without disguising it as manual and retains confirmation metadata", async () => {
    const discover = vi.fn().mockResolvedValue(discoveryResult);
    const result = await createAgentPlanExternalDiscoveryProvider({ discover }).discover({ clue: {
      source: "image_recognition", raw_query: null, brand_name: "Brand", product_name: "Product", recognition_confidence: 93,
      observed_text: [{ type: "barcode", value: "8801234567890" }, { type: "marketing_text", value: "Repair" }],
    }, search_results: [] });
    expect(discover).toHaveBeenCalledWith(expect.objectContaining({
      source: "image_recognition", barcode_hint: "8801234567890", recognition_confidence: 93,
      observed_text: [{ type: "barcode", value: "8801234567890" }, { type: "marketing_text", value: "Repair" }],
    }));
    expect(result[0]?.discovery_metadata).toEqual({ aliases: ["Alias"], confidence: 81, sources: discoveryResult.candidates[0].sources, uncertainties: ["Variant not confirmed"] });
    expect(result[0]?.image_url).toBeNull();
  });
  it("does not collapse unavailable discovery into an empty result", async () => {
    const provider = createAgentPlanExternalDiscoveryProvider({ discover: vi.fn().mockResolvedValue({ status: "unavailable", candidates: [], research_run_id: null }) });
    await expect(provider.discover({ clue: { source: "manual_search", raw_query: "Brand Product", brand_name: "Brand", product_name: "Product", recognition_confidence: null, observed_text: [] }, search_results: [] })).rejects.toBeInstanceOf(ExternalProductDiscoveryUnavailableError);
  });
});
