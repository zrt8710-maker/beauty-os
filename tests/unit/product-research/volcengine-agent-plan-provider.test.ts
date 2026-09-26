import { describe, expect, it, vi } from "vitest";

import { ProductResearchUnavailableError, createVolcengineAgentPlanProductResearchProvider } from "@/server/product-research/volcengine-agent-plan-provider";
import { buildProductResearchDraftResult } from "@/server/services/product-research-draft-builder";

const input = {
  catalog_product_id: "10000000-0000-4000-8000-000000000001",
  brand_name: "HFP", product_name: "乳糖酸毛孔净透水", variant_name: null, barcode: null,
  aliases: ["HomeFacialPro"], identity_sources: [],
};

function providerForOutput(output: unknown) {
  const body = [
    'data: {"type":"response.created","response":{"id":"resp_1"}}', "",
    `data: ${JSON.stringify({ type: "response.output_text.delta", delta: JSON.stringify(output) })}`, "",
    'data: {"type":"response.completed"}', "",
  ].join("\n") + "\n";
  return createVolcengineAgentPlanProductResearchProvider({
    apiKey: "test-key",
    model: "doubao-seed-2.1-turbo",
    baseUrl: "https://example.test/responses",
    fetchImpl: vi.fn(async () => new Response(body, { status: 200 })) as unknown as typeof fetch,
  });
}

function canonicalOutput(usageValue: unknown) {
  const block = (value: unknown) => ({ value, evidence_refs: ["source_1"], confidence: 80, reasons: ["Supported"], has_conflict: false, includes_ai_inference: false });
  return {
    research_payload: {
      identity: block({ aliases: [] }),
      ingredients: block({ status: "partial", raw_text: "Water", items: ["Water"] }),
      claims: block([{ raw_text: "Hydrates", normalized_claim: "帮助保持肌肤水润", confidence: 80, evidence_refs: ["source_1"] }]),
      texture: block("轻薄液体质地"),
      usage: block(usageValue),
      product_type: block("toner"),
    },
    sources: [{ source_id: "source_1", url: "https://example.test/product", title: "Product", source_type: "official_product_page", authority_tier: null, retrieved_at: "2026-08-28T00:00:00.000Z" }],
    overall_confidence: 80,
    research_run_id: null,
  };
}

function ingredientItems(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    raw_name: `INGREDIENT ${index + 1}`,
    normalized_name: `Ingredient ${index + 1}`,
    ingredient_order: index + 1,
    confidence: 90,
    evidence_refs: ["source_1"],
  }));
}

function source(id: string, url: string, title: string, sourceType = "official_product_page") {
  return { source_id: id, url, title, source_type: sourceType, authority_tier: null, retrieved_at: "2026-09-16T00:00:00.000Z" };
}

function lead(url: string, title: string) {
  return { title, url, snippet: null, summary: null, site_name: null, rank_score: null, authority_level: null, authority_description: null };
}

function setSectionRefs(output: ReturnType<typeof canonicalOutput>, name: "ingredients" | "claims" | "texture" | "usage" | "product_type", refs: string[]) {
  const section = output.research_payload[name];
  section.evidence_refs = refs;
  if (name === "claims" && Array.isArray(section.value)) {
    section.value = section.value.map((fact) => typeof fact === "object" && fact !== null ? { ...fact, evidence_refs: refs } : fact);
  }
}

describe("Volcengine Agent-Plan product research provider", () => {
  it("uses the streaming Responses API with adaptive thinking and an explicit research output budget", async () => {
    const fetchMock = vi.fn(async () => new Response("unavailable", { status: 503 }));
    const provider = createVolcengineAgentPlanProductResearchProvider({
      apiKey: "test-key", model: "doubao-seed-2.1-turbo", baseUrl: "https://example.test/responses", fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(provider.research({ ...input, barcode: "3614273991032" })).rejects.toBeInstanceOf(ProductResearchUnavailableError);
    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>;
    const request = calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({
      model: "doubao-seed-2.1-turbo",
      stream: true,
      tools: [{ type: "web_search", web_search: {} }],
      max_output_tokens: 32_768,
      thinking: { type: "auto" },
    });
    expect(body.input).toContain(input.catalog_product_id);
    expect(body.input).not.toContain("owned_product_id");
    expect(body.input).not.toContain("3614273991032");
    expect(body.input).not.toContain('"barcode"');
    expect(body.input).toContain("product-specific support");
    expect(body.input).toContain("another SKU");
    expect(body.input).toContain("LANGUAGE CONTRACT");
    expect(body.input).toContain("natural Simplified Chinese");
    expect(body.input).toContain("raw_name must remain the original INCI/source name");
    expect(body.input).toContain("never weaken the source warning");
    expect(body.input).toContain("Incomplete evidence means a supported partial result");
    expect(body.input).toContain("When INPUT.variant_name is null");
    expect(body.input).toContain("Mark includes_ai_inference:true");
  });

  it("passes application-controlled SearchInfinity leads to Agent3 without changing web_search", async () => {
    const fetchMock = vi.fn(async () => new Response("unavailable", { status: 503 }));
    const provider = createVolcengineAgentPlanProductResearchProvider({
      apiKey: "test-key", model: "doubao-seed-2.1-turbo", baseUrl: "https://example.test/responses", fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(provider.research({ ...input, search_results: [{
      title: "HFP product", url: "https://search.example/hfp", snippet: "exact product", summary: null,
      site_name: "SearchInfinity", rank_score: 0.9, authority_level: null, authority_description: null,
    }] })).rejects.toBeInstanceOf(ProductResearchUnavailableError);
    const request = (fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>)[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.input).toContain("https://search.example/hfp");
    expect(body).toMatchObject({
      tools: [{ type: "web_search", web_search: {} }],
      max_output_tokens: 32_768,
      thinking: { type: "auto" },
    });
  });

  it("accepts explicit top-level source provenance from streamed Agent3 JSON", async () => {
    const output = {
      research_payload: {
        identity: { value: null, evidence_refs: [], confidence: 0, reasons: ["No identity evidence"], has_conflict: false, includes_ai_inference: false },
        ingredients: { value: null, evidence_refs: [], confidence: 0, reasons: ["No ingredient evidence"], has_conflict: false, includes_ai_inference: false },
        claims: { value: null, evidence_refs: [], confidence: 0, reasons: ["No claim evidence"], has_conflict: false, includes_ai_inference: false },
        texture: { value: null, evidence_refs: [], confidence: 0, reasons: ["No texture evidence"], has_conflict: false, includes_ai_inference: false },
        usage: { value: null, evidence_refs: [], confidence: 0, reasons: ["No usage evidence"], has_conflict: false, includes_ai_inference: false },
        product_type: { value: null, evidence_refs: [], confidence: 0, reasons: ["No type evidence"], has_conflict: false, includes_ai_inference: false },
      },
      sources: [{
        source_id: "source_1",
        URL: "https://www.homefacialpro.com/",
        title: "HomeFacialPro",
        source_type: "official_brand",
        authority_tier: 1,
        retrieved_at: "2026-08-28T00:00:00.000Z",
      }],
      overall_confidence: 87.5,
      research_run_id: null,
    };
    const body = [
      'data: {"type":"response.created","response":{"id":"resp_1"}}',
      "",
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: JSON.stringify(output) })}`,
      "",
      'data: {"type":"response.completed"}',
      "",
    ].join("\n") + "\n";
    const provider = createVolcengineAgentPlanProductResearchProvider({
      apiKey: "test-key", model: "doubao-seed-2.1-turbo", baseUrl: "https://example.test/responses",
      fetchImpl: vi.fn(async () => new Response(body, { status: 200 })) as unknown as typeof fetch,
    });

    await expect(provider.research({ ...input, search_results: [{
      title: "Provided lead", url: "https://search.example/provided", snippet: null, summary: null,
      site_name: null, rank_score: null, authority_level: null, authority_description: null,
    }] })).resolves.toMatchObject({
      sources: [expect.objectContaining({ source_id: "source_1", URL: "https://www.homefacialpro.com/" })],
      research_run_id: "resp_1",
    });
  });

  it("normalizes only observed reasons strings before strict transport validation", async () => {
    const output = {
      research_payload: Object.fromEntries(["identity", "ingredients", "claims", "texture", "usage", "product_type"].map((field) => [field, {
        value: null, evidence_refs: [], confidence: 0, reasons: "No product-specific evidence", has_conflict: false, includes_ai_inference: false,
      }])),
      sources: [{ source_id: "source_1", url: "https://example.test/product", title: "Product", source_type: "retailer", authority_tier: null, retrieved_at: "2026-08-28T00:00:00.000Z" }],
      overall_confidence: 0, research_run_id: null,
    };
    const body = [
      'data: {"type":"response.created","response":{"id":"resp_1"}}', "",
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: JSON.stringify(output) })}`, "",
      'data: {"type":"response.completed"}', "",
    ].join("\n") + "\n";
    const provider = createVolcengineAgentPlanProductResearchProvider({
      apiKey: "test-key", model: "doubao-seed-2.1-turbo", baseUrl: "https://example.test/responses",
      fetchImpl: vi.fn(async () => new Response(body, { status: 200 })) as unknown as typeof fetch,
    });

    await expect(provider.research(input)).resolves.toMatchObject({
      research_payload: { identity: { reasons: ["No product-specific evidence"] } },
    });
  });

  it("blocks wrong product-line evidence and caps confidence without relaxing transport validation", async () => {
    const block = (value: unknown) => ({ value, evidence_refs: ["wrong_1"], confidence: 90, reasons: ["Model cited the lead"], has_conflict: false, includes_ai_inference: false });
    const output = {
      research_payload: {
        identity: block({ brand: "芙清" }), ingredients: block({ status: "partial", raw_text: "水杨酸", items: ["水杨酸"] }),
        claims: block(["控油"]), texture: block("泡沫"), usage: block("每日使用"), product_type: block("cleanser"),
      },
      sources: [{ source_id: "wrong_1", url: "https://product.suning.com/wrong", title: "芙清密钥水杨酸焕颜美肤洁面乳", source_type: "retailer", authority_tier: null, retrieved_at: "2026-08-28T00:00:00.000Z" }],
      overall_confidence: 92, research_run_id: null,
    };
    const body = [
      'data: {"type":"response.created","response":{"id":"resp_1"}}', "",
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: JSON.stringify(output) })}`, "",
      'data: {"type":"response.completed"}', "",
    ].join("\n") + "\n";
    const provider = createVolcengineAgentPlanProductResearchProvider({
      apiKey: "test-key", model: "doubao-seed-2.1-turbo", baseUrl: "https://example.test/responses",
      fetchImpl: vi.fn(async () => new Response(body, { status: 200 })) as unknown as typeof fetch,
    });

    const result = await provider.research({
      ...input, brand_name: "芙清", product_name: "焕颜美肤洁面乳", search_results: [{
        title: "芙清密钥水杨酸焕颜美肤洁面乳", url: "https://product.suning.com/wrong", snippet: null, summary: null,
        site_name: "苏宁", rank_score: null, authority_level: null, authority_description: null,
      }],
    });
    expect(result.overall_confidence).toBe(40);
    expect(result.research_payload.identity).toMatchObject({ value: null, evidence_refs: [], confidence: 0, has_conflict: true });
    expect(result.research_payload.ingredients).toMatchObject({ value: null, evidence_refs: [], confidence: 0 });
  });

  it("removes blocked refs per fact while retaining independently supported ingredients, claims, and texture", async () => {
    const block = (value: unknown, refs = ["good_1", "wrong_1"]) => ({
      value, evidence_refs: refs, confidence: 90, reasons: ["Mixed leads"], has_conflict: false, includes_ai_inference: false,
    });
    const output = {
      research_payload: {
        identity: block({ brand: "芙清" }, ["good_1"]),
        ingredients: block({ status: "partial", raw_text: [], items: [
          { name: "甘油", evidence_refs: ["good_1", "wrong_1"] },
          { name: "水杨酸", evidence_refs: ["wrong_1"] },
        ] }),
        claims: block([
          { raw_text: "温和清洁", normalized_claim: "温和清洁肌肤", evidence_refs: ["good_1", "wrong_1"] },
          { raw_text: "水杨酸焕肤", normalized_claim: "帮助改善肌肤粗糙感", evidence_refs: ["wrong_1"] },
        ]),
        texture: block("泡沫质地"),
        usage: block("清水冲洗", ["good_1"]),
        product_type: block("cleanser", ["good_1"]),
        // Legacy Agent3 drift: optional candidates arrived as a raw array.
        care_role_candidates: [{ code: "cleanser", confidence: 70, evidence_refs: ["good_1"] }],
      },
      sources: [
        { source_id: "good_1", url: "https://product.example/good", title: "芙清焕颜美肤洁面乳", source_type: "retailer", authority_tier: 3, retrieved_at: "2026-08-28T00:00:00.000Z" },
        { source_id: "wrong_1", url: "https://product.example/wrong", title: "芙清密钥水杨酸焕颜美肤洁面乳", source_type: "retailer", authority_tier: 3, retrieved_at: "2026-08-28T00:00:00.000Z" },
      ],
      overall_confidence: 90,
      research_run_id: null,
    };
    const body = [
      'data: {"type":"response.created","response":{"id":"resp_1"}}', "",
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: JSON.stringify(output) })}`, "",
      'data: {"type":"response.completed"}', "",
    ].join("\n") + "\n";
    const provider = createVolcengineAgentPlanProductResearchProvider({
      apiKey: "test-key", model: "doubao-seed-2.1-turbo", baseUrl: "https://example.test/responses",
      fetchImpl: vi.fn(async () => new Response(body, { status: 200 })) as unknown as typeof fetch,
    });

    const result = await provider.research({
      ...input,
      brand_name: "芙清",
      product_name: "焕颜美肤洁面乳",
      search_results: [
        { title: "芙清焕颜美肤洁面乳", url: "https://product.example/good", snippet: null, summary: null, site_name: null, rank_score: null, authority_level: null, authority_description: null },
        { title: "芙清密钥水杨酸焕颜美肤洁面乳", url: "https://product.example/wrong", snippet: null, summary: null, site_name: null, rank_score: null, authority_level: null, authority_description: null },
      ],
    });

    expect(result.research_payload.ingredients.value).toMatchObject({
      items: [{ name: "甘油", evidence_refs: ["good_1"] }],
    });
    expect(result.research_payload.claims.value).toEqual([
      expect.objectContaining({ raw_text: "温和清洁", evidence_refs: ["good_1"], confidence: 55 }),
    ]);
    expect(result.research_payload.texture).toMatchObject({ value: "泡沫质地", evidence_refs: ["good_1"] });
    expect(result.research_payload.care_role_candidates).toMatchObject({
      value: [{ code: "cleanser", evidence_refs: ["good_1"] }],
    });
    expect(result.overall_confidence).toBe(55);
  });

  it("captures exact completed output when transport validation rejects it", async () => {
    const recordProviderCompletion = vi.fn(async () => "diagnostic_1");
    const body = [
      'data: {"type":"response.created","response":{"id":"resp_1"}}', "",
      'data: {"type":"response.output_text.delta","delta":"{not-json}"}', "",
      'data: {"type":"response.completed"}', "",
    ].join("\n") + "\n";
    const provider = createVolcengineAgentPlanProductResearchProvider({
      apiKey: "test-key", model: "doubao-seed-2.1-turbo", baseUrl: "https://example.test/responses",
      fetchImpl: vi.fn(async () => new Response(body, { status: 200 })) as unknown as typeof fetch,
      diagnostics: { recordProviderCompletion, recordOutcome: vi.fn() },
    });

    await expect(provider.research(input)).rejects.toMatchObject({ failureKind: "json_parse_error", diagnosticId: "diagnostic_1" });
    expect(recordProviderCompletion).toHaveBeenCalledWith(expect.objectContaining({ ...input, search_results: [] }), expect.objectContaining({
      rawFinalOutput: "{not-json}",
      transportValidation: expect.objectContaining({ json_parse_success: false }),
    }));
  });

  it("accepts canonical usage and preserves the proven usage-string compatibility", async () => {
    const canonical = {
      instructions: ["洁面后使用"], am_pm: ["am", "pm"], frequency: "每天使用",
      routine_order: "洁面后使用", leave_on: true, rinse_off: false, cautions: ["避免接触眼睛"],
    };
    await expect(providerForOutput(canonicalOutput(canonical)).research(input)).resolves.toMatchObject({
      research_payload: { usage: { value: canonical } },
    });
    await expect(providerForOutput(canonicalOutput("洁面后使用")).research(input)).resolves.toMatchObject({
      research_payload: { usage: { value: "洁面后使用" } },
    });
  });

  it("isolates an English-only consumer section instead of persisting it", async () => {
    const output = canonicalOutput("洁面后使用");
    output.research_payload.usage.value = {
      instructions: ["Apply after cleansing"], am_pm: ["pm"], frequency: "daily",
      routine_order: "before moisturizer", leave_on: true, rinse_off: false, cautions: ["Do not use on broken skin"],
    };

    const result = await providerForOutput(output).research(input);

    expect(result.research_payload.usage).toMatchObject({
      value: null,
      confidence: 0,
      reasons: ["Section contract mismatch: usage."],
    });
    expect(result.research_payload.claims.value).toHaveLength(1);
    expect(result.research_payload.ingredients.value).not.toBeNull();
  });

  it("isolates an arbitrary usage object while preserving valid core sections", async () => {
    const output = canonicalOutput({ usage_type: "daily", usage_scene: "morning", suitable_skin_type: "all" });
    const result = await providerForOutput(output).research(input);
    expect(result.research_payload.usage).toMatchObject({
      value: null,
      confidence: 0,
      reasons: ["Section contract mismatch: usage."],
    });
    expect(result.research_payload.ingredients.value).not.toBeNull();
    expect(result.research_payload.claims.value).toHaveLength(1);
    expect(result.research_payload.texture.value).toBe("轻薄液体质地");
  });

  it("isolates malformed claims without discarding ingredients or canonical usage", async () => {
    const output = canonicalOutput({
      instructions: ["洁面后使用"], am_pm: [], frequency: null,
      routine_order: null, leave_on: true, rinse_off: false, cautions: ["避免接触眼睛"],
    });
    output.research_payload.claims.value = { summary: "not a canonical claim array" };
    const result = await providerForOutput(output).research(input);
    expect(result.research_payload.claims).toMatchObject({ value: null, confidence: 0 });
    expect(result.research_payload.ingredients.value).not.toBeNull();
    expect(result.research_payload.usage.value).not.toBeNull();
  });

  it("normalizes localized source taxonomy and derives authority deterministically", async () => {
    const output = canonicalOutput("洁面后使用");
    output.sources[0].source_type = "电商平台";
    (output.sources[0] as { authority_tier: number | null }).authority_tier = 1;
    const result = await providerForOutput(output).research(input);
    expect(result.sources[0]).toMatchObject({ source_type: "retailer", authority_tier: 3 });
  });

  it("wraps the observed Lancome round-one flattened ingredients block without changing its facts", async () => {
    const output = canonicalOutput("洁面后使用");
    const canonical = output.research_payload.ingredients;
    const items = ingredientItems(12);
    const payload: Record<string, unknown> = output.research_payload;
    payload.ingredients = {
      status: "partial",
      raw_text: ["INGREDIENT 1, INGREDIENT 2, ... complete INCI declaration"],
      items,
      conflicts: [],
      evidence_refs: canonical.evidence_refs,
      confidence: canonical.confidence,
      reasons: canonical.reasons,
      has_conflict: canonical.has_conflict,
      includes_ai_inference: canonical.includes_ai_inference,
    };

    const result = await providerForOutput(output).research(input);
    expect(result.research_payload.ingredients.value?.items).toHaveLength(12);
    expect(result.research_payload.ingredients.value?.raw_text).toEqual(["INGREDIENT 1, INGREDIENT 2, ... complete INCI declaration"]);
  });

  it("accepts the Lancome round-two canonical ingredients with one complete INCI declaration", async () => {
    const output = canonicalOutput("洁面后使用");
    const items = ingredientItems(24);
    output.research_payload.ingredients.value = {
      status: "found",
      raw_text: [items.map((item) => item.raw_name).join("\n")],
      items,
    };

    const result = await providerForOutput(output).research(input);
    expect(result.research_payload.ingredients.value?.items).toHaveLength(24);
    expect(result.research_payload.ingredients.value?.raw_text).toHaveLength(1);
  });

  it.each([12, 24, 40])("preserves all %i ingredient items when raw_text redundantly repeats each item", async (count) => {
    const output = canonicalOutput("洁面后使用");
    const items = ingredientItems(count);
    output.research_payload.ingredients.value = {
      status: "found",
      raw_text: items.map((item) => item.raw_name),
      items,
    };

    const result = await providerForOutput(output).research(input);
    expect(result.research_payload.ingredients.value?.items).toHaveLength(count);
    expect(result.research_payload.ingredients.value?.raw_text).toEqual([]);
  });

  it("still isolates genuinely malformed flattened ingredients without affecting other sections", async () => {
    const output = canonicalOutput("洁面后使用");
    const payload: Record<string, unknown> = output.research_payload;
    payload.ingredients = {
      status: "found",
      raw_text: ["WATER"],
      items: [{ ingredient_name: 42, evidence_refs: ["source_1"] }],
      evidence_refs: ["source_1"],
      confidence: 90,
      reasons: ["Supported"],
      has_conflict: false,
      includes_ai_inference: false,
    };

    const result = await providerForOutput(output).research(input);
    expect(result.research_payload.ingredients).toMatchObject({ value: null, confidence: 0 });
    expect(result.research_payload.claims.value).toHaveLength(1);
    expect(result.research_payload.usage.value).toBe("洁面后使用");
  });

  it("logs the stable reason for a 72 to 55 exact-variant-uncertain confidence cap", async () => {
    const output = canonicalOutput("洁面后使用");
    output.overall_confidence = 72;
    output.sources[0].title = "HFP乳糖酸毛孔净透水2.0 官方官网";
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const result = await providerForOutput(output).research({
        ...input,
        search_results: [{
          title: output.sources[0].title,
          url: output.sources[0].url,
          snippet: null,
          summary: null,
          site_name: null,
          rank_score: null,
          authority_level: null,
          authority_description: null,
        }],
      });
      expect(result.overall_confidence).toBe(55);
      expect(info).toHaveBeenCalledWith("AGENT3_RESEARCH_DEBUG", expect.objectContaining({
        stage: "source_confidence",
        raw_confidence: 72,
        cap: 55,
        cap_reason: "exact_variant_uncertain",
        final_confidence: 55,
      }));
    } finally {
      info.mockRestore();
    }
  });

  it("keeps the Lancome-shaped all-official fixture at model confidence instead of a global 55", async () => {
    const output = canonicalOutput("洁面后使用");
    output.overall_confidence = 72;
    output.sources = [source("official", "https://lancome.example/clarifique", "兰蔻超极光活粹晶露 官方官网")];
    output.research_payload.identity.evidence_refs = ["official"];
    for (const name of ["ingredients", "claims", "texture", "usage", "product_type"] as const) setSectionRefs(output, name, ["official"]);

    const result = await providerForOutput(output).research({
      ...input,
      brand_name: "兰蔻",
      product_name: "超极光活粹晶露",
      search_results: [lead("https://lancome.example/clarifique", "兰蔻超极光活粹晶露 官方官网")],
    });

    expect(result.overall_confidence).toBe(72);
    expect(result.research_payload.ingredients.confidence).toBe(80);
  });

  it("classifies current Lancome canonical/alias pages as authoritative while excluding old and other-product pages", async () => {
    const output = canonicalOutput("洁面后使用");
    output.sources = [
      source("tw-current", "https://www.lancome.com.tw/product/A03421-LAC.html", "超极光活粹晶露（极光水）"),
      source("us-current", "https://www.lancome-usa.com/skincare/by-category/toners/clarifique-double-treatment-essence/00369-LAC.html", "Clarifique Double Treatment Essence"),
      source("old", "https://www.lancome-usa.com/discontinued-products/clarifique/00269-LAC.html", "Clarifique Double Treatment Essence 旧版"),
      source("other", "https://www.lancome-usa.com/skincare/by-category/toners/absolue/00142-LAC.html", "Absolue L'Extrait Elixir Lotion"),
    ];
    output.research_payload.identity.evidence_refs = ["tw-current", "us-current"];
    for (const name of ["ingredients", "claims", "texture", "usage", "product_type"] as const) {
      setSectionRefs(output, name, ["tw-current", "us-current"]);
    }
    const searchResults = [
      { ...lead(output.sources[0].url, output.sources[0].title), snippet: "用户评分 2.0，当前产品页" },
      lead(output.sources[1].url, output.sources[1].title),
      lead(output.sources[2].url, output.sources[2].title),
      lead(output.sources[3].url, output.sources[3].title),
    ];
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const result = await providerForOutput(output).research({
        ...input,
        brand_name: "兰蔻（Lancôme）",
        product_name: "超极光活粹晶露",
        aliases: ["极光水", "Clarifique Double Treatment Essence"],
        identity_sources: [
          { url: output.sources[0].url, title: output.sources[0].title, source_type: "official_product_page" },
          { url: output.sources[1].url, title: output.sources[1].title, source_type: "official_product_page" },
        ],
        search_results: searchResults,
      });

      expect(result.overall_confidence).toBe(80);
      expect(result.research_payload.ingredients.confidence).toBe(80);
      expect(info).toHaveBeenCalledWith("AGENT3_RESEARCH_DEBUG", expect.objectContaining({
        stage: "source_confidence",
        source_classifications: expect.arrayContaining([
          expect.objectContaining({ source_id: "tw-current", source_class: "exact_product", source_priority: "official_product", brand_owned_domain: true }),
          expect.objectContaining({ source_id: "us-current", source_class: "exact_product", matched_name_or_alias: "Clarifique Double Treatment Essence" }),
          expect.objectContaining({ source_id: "old", source_class: "exact_variant_uncertain" }),
          expect.objectContaining({ source_id: "other", source_class: "wrong_product_line" }),
        ]),
      }));
    } finally {
      info.mockRestore();
    }
  });

  it("keeps the YSL official identity fixture at model confidence when the formula contains 3.4% glycolic acid", async () => {
    const output = canonicalOutput("洁面后使用");
    output.overall_confidence = 80;
    output.sources = [source(
      "ysl-official",
      "https://www.brand.example/products/pure-shots-lines-away-serum",
      "YSL Pure Shots Lines Away Serum 3.4% Glycolic Acid",
    )];
    output.research_payload.identity.evidence_refs = ["ysl-official"];
    for (const name of ["ingredients", "claims", "texture", "usage", "product_type"] as const) {
      setSectionRefs(output, name, ["ysl-official"]);
    }

    const result = await providerForOutput(output).research({
      ...input,
      brand_name: "YSL",
      product_name: "Pure Shots Lines Away Serum",
      aliases: ["Pure Shots Lines Away"],
      identity_sources: [{
        url: output.sources[0].url,
        title: output.sources[0].title,
        source_type: "官方产品页",
      }],
      search_results: [{ ...lead(output.sources[0].url, output.sources[0].title), snippet: "Formula with 3.4% Glycolic Acid" }],
    });

    expect(result.overall_confidence).toBe(80);
    expect(result.research_payload.ingredients.confidence).toBe(80);
    expect(result.research_payload.claims.confidence).toBe(80);
  });

  it("keeps a weak Marubi texture source from lowering independently official sections", async () => {
    const output = canonicalOutput("洁面后使用");
    output.overall_confidence = 70;
    output.sources = [
      source("official", "https://marubi.example/product", "丸美胶原蛋白奢养精华水 官方官网"),
      source("weak", "https://video.example/review", "丸美胶原蛋白奢养精华水 使用分享", "user_submitted"),
    ];
    output.research_payload.identity.evidence_refs = ["official"];
    for (const name of ["ingredients", "claims", "usage", "product_type"] as const) setSectionRefs(output, name, ["official"]);
    setSectionRefs(output, "texture", ["weak"]);

    const result = await providerForOutput(output).research({
      ...input,
      brand_name: "丸美",
      product_name: "胶原蛋白奢养精华水",
      search_results: [
        lead("https://marubi.example/product", "丸美胶原蛋白奢养精华水 官方官网"),
        lead("https://video.example/review", "丸美胶原蛋白奢养精华水 使用分享"),
      ],
    });

    expect(result.overall_confidence).toBe(70);
    expect(result.research_payload.ingredients.confidence).toBe(80);
    expect(result.research_payload.texture.confidence).toBe(55);
  });

  it("limits an Estee-Lauder-shaped exact-variant uncertainty to the section that cites it", async () => {
    const output = canonicalOutput("洁面后使用");
    output.overall_confidence = 72;
    output.sources = [
      source("official", "https://estee.example/recovery", "雅诗兰黛小棕复活水 官方官网"),
      source("variant", "https://estee.example/recovery-2", "雅诗兰黛小棕复活水2.0 官方官网"),
    ];
    output.research_payload.identity.evidence_refs = ["official"];
    for (const name of ["ingredients", "claims", "usage", "product_type"] as const) setSectionRefs(output, name, ["official"]);
    setSectionRefs(output, "texture", ["variant"]);

    const result = await providerForOutput(output).research({
      ...input,
      brand_name: "雅诗兰黛",
      product_name: "小棕复活水",
      search_results: [
        lead("https://estee.example/recovery", "雅诗兰黛小棕复活水 官方官网"),
        lead("https://estee.example/recovery-2", "雅诗兰黛小棕复活水2.0 官方官网"),
      ],
    });

    expect(result.overall_confidence).toBe(72);
    expect(result.research_payload.ingredients.confidence).toBe(80);
    expect(result.research_payload.texture.confidence).toBe(55);
  });

  it("retains the existing 55 boundary when every usable section relies only on weak sources", async () => {
    const output = canonicalOutput("洁面后使用");
    output.sources[0].title = "HFP乳糖酸毛孔净透水 使用分享";
    const result = await providerForOutput(output).research({
      ...input,
      search_results: [lead(output.sources[0].url, output.sources[0].title)],
    });
    expect(result.overall_confidence).toBe(55);
    expect(result.research_payload.ingredients.confidence).toBe(55);
  });

  it("records source_not_reconciled for only the claim section that cites an unmatched official source", async () => {
    const output = canonicalOutput("洁面后使用");
    output.sources = [
      source("official", "https://hfp.example/product", "HFP乳糖酸毛孔净透水 官方官网"),
      source("unmatched", "https://hfp.example/claim", "HFP乳糖酸毛孔净透水 官方宣称"),
    ];
    output.research_payload.identity.evidence_refs = ["official"];
    for (const name of ["ingredients", "texture", "usage", "product_type"] as const) setSectionRefs(output, name, ["official"]);
    setSectionRefs(output, "claims", ["unmatched"]);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const result = await providerForOutput(output).research({
        ...input,
        search_results: [lead("https://hfp.example/product", "HFP乳糖酸毛孔净透水 官方官网")],
      });
      expect(result.overall_confidence).toBe(75);
      expect(result.research_payload.claims.confidence).toBe(55);
      expect(result.research_payload.ingredients.confidence).toBe(80);
      expect(info).toHaveBeenCalledWith("AGENT3_RESEARCH_DEBUG", expect.objectContaining({
        stage: "source_confidence",
        matched_source_count: 1,
        unmatched_source_count: 1,
        section_trust: expect.objectContaining({ claims: expect.objectContaining({ cap_reason: "source_not_reconciled" }) }),
      }));
    } finally {
      info.mockRestore();
    }
  });

  it("preserves Lancome-style ingredient facts and evidence while downgrading a model-declared formula conflict to uncertainty", async () => {
    const output = canonicalOutput("洁面后使用");
    const ingredients = output.research_payload.ingredients;
    ingredients.value = {
      status: "conflicted",
      raw_text: ["WATER, LACTIC ACID"],
      items: [
        { raw_name: "WATER", normalized_name: "水", ingredient_order: 1, confidence: 90, evidence_refs: ["source_1"] },
        { raw_name: "LACTIC ACID", normalized_name: "乳酸", ingredient_order: 2, confidence: 90, evidence_refs: ["source_1"] },
      ],
      conflicts: [{
        type: "formula_version",
        description: "当前配方表与已停用版本的配方表存在差异。",
        evidence_refs: ["source_1"],
      }],
    };
    ingredients.has_conflict = true;
    ingredients.confidence = 65;

    const result = await providerForOutput(output).research(input);
    expect(result.research_payload.ingredients).toMatchObject({
      value: { status: "partial", items: expect.arrayContaining([expect.objectContaining({ raw_name: "LACTIC ACID" })]), conflicts: [] },
      has_conflict: false,
      confidence: 55,
    });
    expect(result.research_payload.uncertainties).toEqual([{
      field: "ingredients.formula_version",
      description: "当前配方表与已停用版本的配方表存在差异。",
      evidence_refs: ["source_1"],
    }]);

    const persisted = buildProductResearchDraftResult({ ...input, barcode: "3614273991032" }, result);
    expect(persisted.research_payload.identity.barcode).toBe("3614273991032");
    expect(persisted.research_payload.ingredients).toMatchObject({ status: "partial", items: expect.any(Array), conflicts: [] });
    expect(persisted.research_payload.ingredients.items).toHaveLength(2);
    expect(persisted.research_payload.field_confidence.ingredients.has_conflict).toBe(false);
    expect(persisted.research_payload.uncertainties).toEqual([expect.objectContaining({
      field: "ingredients.formula_version",
      evidence_refs: ["source_1"],
    })]);
  });
});
