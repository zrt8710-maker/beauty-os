import { describe, expect, it } from "vitest";

import { agent3ResearchResultSchema } from "@/schemas/product-research";
import { buildProductResearchDraftResult } from "@/server/services/product-research-draft-builder";

const valid = {
  research_payload: {
    identity: { value: null, evidence_refs: [], confidence: 0, reasons: ["No identity evidence"], has_conflict: false, includes_ai_inference: false },
    ingredients: { value: null, evidence_refs: [], confidence: 0, reasons: ["No ingredient evidence"], has_conflict: false, includes_ai_inference: false },
    claims: { value: null, evidence_refs: [], confidence: 0, reasons: ["No claim evidence"], has_conflict: false, includes_ai_inference: false },
    usage: { value: null, evidence_refs: [], confidence: 0, reasons: ["No usage evidence"], has_conflict: false, includes_ai_inference: false },
    product_type: { value: null, evidence_refs: [], confidence: 0, reasons: ["No type evidence"], has_conflict: false, includes_ai_inference: false },
  },
  sources: [{
    source_id: "source_1",
    URL: "https://www.example.com/product",
    title: "Official product page",
    source_type: "official_brand",
    authority_tier: 1,
    retrieved_at: "2026-08-28T00:00:00.000Z",
  }],
  overall_confidence: 87.5,
  research_run_id: "run_1",
};

const catalogIdentity = {
  catalog_product_id: "10000000-0000-4000-8000-000000000001",
  brand_name: "HFP",
  product_name: "果酸毛孔净透精华水",
  variant_name: null,
  barcode: null,
  aliases: ["HFP果酸水"],
  identity_sources: [],
};

const completeProviderResult = {
  research_payload: {
    identity: { value: { aliases: ["HomeFacialPro"] }, evidence_refs: ["source_1"], confidence: 91, reasons: ["Official source names the product"], has_conflict: false, includes_ai_inference: false },
    ingredients: { value: { status: "found", raw_text: ["Water, Glycerin"], items: [{ raw_name: "Water", normalized_name: "水", ingredient_order: 1, confidence: 95, evidence_refs: ["source_1"] }], conflicts: [] }, evidence_refs: ["source_1"], confidence: 95, reasons: ["Ingredient list is published"], has_conflict: false, includes_ai_inference: false },
    claims: { value: [{ raw_text: "Helps refine the appearance of pores", normalized_claim: "帮助改善毛孔外观", confidence: 88, evidence_refs: ["source_1"] }], evidence_refs: ["source_1"], confidence: 88, reasons: ["Official public claim"], has_conflict: false, includes_ai_inference: false },
    texture: { value: "轻薄水润的液体质地", evidence_refs: ["source_1"], confidence: 86, reasons: ["Official texture description"], has_conflict: false, includes_ai_inference: false },
    usage: { value: { instructions: ["洁面后取适量涂抹于面部"], am_pm: ["pm"], frequency: "每晚一次", routine_order: "洁面后、保湿前使用", leave_on: true, rinse_off: false, cautions: ["仅在出现持续不适时停止使用；不要接触眼睛。"] }, evidence_refs: ["source_1"], confidence: 82, reasons: ["Official instructions"], has_conflict: false, includes_ai_inference: false },
    product_type: { value: "toner", evidence_refs: ["source_1"], confidence: 90, reasons: ["Official product category"], has_conflict: false, includes_ai_inference: false },
    uncertainties: [],
    conflicts: [],
  },
  sources: [{
    source_id: "source_1",
    url: "https://www.homefacialpro.com/products/example",
    title: "HFP Product Page",
    source_type: "official_brand",
    authority_tier: "1",
    retrieved_at: "2026-08-28T00:00:00.000Z",
  }],
  overall_confidence: 90,
  research_run_id: "run_complete_1",
};

describe("Agent3 research transport schema", () => {
  it("accepts explicit top-level source provenance", () => {
    expect(agent3ResearchResultSchema.safeParse(valid).success).toBe(true);
  });

  it("normalizes an exact numeric authority tier string", () => {
    const result = agent3ResearchResultSchema.parse({
      ...valid,
      sources: [{ ...valid.sources[0], authority_tier: "1" }],
    });
    expect(result.sources[0]?.authority_tier).toBe(1);
  });

  it("rejects non-numeric authority tier labels", () => {
    expect(agent3ResearchResultSchema.safeParse({
      ...valid,
      sources: [{ ...valid.sources[0], authority_tier: "official" }],
    }).success).toBe(false);
  });

  it("rejects arbitrary unknown top-level keys", () => {
    const result = agent3ResearchResultSchema.safeParse({
      ...valid,
      random_new_ai_field: "must not be silently accepted",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "unrecognized_keys" }),
      ]));
    }
  });

  it("rejects arbitrary unknown research payload sections", () => {
    expect(agent3ResearchResultSchema.safeParse({
      ...valid,
      research_payload: { ...valid.research_payload, invented_semantic_section: {} },
    }).success).toBe(false);
  });

  it("requires a concrete source URL instead of fabricating provenance", () => {
    expect(agent3ResearchResultSchema.safeParse({
      ...valid,
      sources: [{ ...valid.sources[0], URL: undefined }],
    }).success).toBe(false);
  });

  it("passes a realistic complete provider response through transport, adapter, and draft validation", () => {
    const transport = agent3ResearchResultSchema.parse(completeProviderResult);
    const draft = buildProductResearchDraftResult(catalogIdentity, transport);
    expect(draft.overall_confidence).toBe(90);
    expect(draft.research_payload.sources[0]).toMatchObject({ authority_tier: 1, url: completeProviderResult.sources[0].url });
    expect(draft.research_payload.ingredients).toMatchObject({ status: "found", items: [expect.objectContaining({ raw_name: "Water", normalized_name: "水" })] });
    expect(draft.research_payload.claims[0]).toMatchObject({ raw_text: "Helps refine the appearance of pores", normalized_claim: "帮助改善毛孔外观", evidence_refs: ["source_1"] });
    expect(draft.research_payload.texture?.value).toBe("轻薄水润的液体质地");
    expect(draft.research_payload.usage).toMatchObject({
      instructions: ["洁面后取适量涂抹于面部"],
      frequency: "每晚一次",
      routine_order: "洁面后、保湿前使用",
      cautions: ["仅在出现持续不适时停止使用；不要接触眼睛。"],
      evidence_refs: ["source_1"],
    });
    expect(draft.research_payload.sources[0]?.title).toBe("HFP Product Page");
  });

  it("maps the observed string ingredient transport shape through the persisted draft contract", () => {
    const transport = agent3ResearchResultSchema.parse({
      ...completeProviderResult,
      research_payload: {
        ...completeProviderResult.research_payload,
        ingredients: {
          ...completeProviderResult.research_payload.ingredients,
          value: {
            status: "found",
            raw_text: "Water, Glycerin",
            items: ["Water", "Glycerin"],
            conflicts: [],
          },
        },
      },
    });
    const draft = buildProductResearchDraftResult(catalogIdentity, transport);

    expect(draft.research_payload.ingredients.raw_text).toEqual(["Water, Glycerin"]);
    expect(draft.research_payload.ingredients.items).toEqual([
      expect.objectContaining({ raw_name: "Water", normalized_name: null, ingredient_order: null, confidence: null, evidence_refs: ["source_1"] }),
      expect.objectContaining({ raw_name: "Glycerin", normalized_name: null, ingredient_order: null, confidence: null, evidence_refs: ["source_1"] }),
    ]);
  });

  it("passes a complete simplified V1 transport fixture through the deterministic draft adapter", () => {
    const transport = agent3ResearchResultSchema.parse({
      ...completeProviderResult,
      research_payload: {
        identity: { value: { aliases: ["HomeFacialPro"] }, evidence_refs: ["source_1"], confidence: 90, reasons: ["Official page"], has_conflict: false, includes_ai_inference: false },
        ingredients: { value: { status: "found", raw_text: "Water, Glycerin", items: [{ name: "Water" }, "Glycerin"], conflicts: [] }, evidence_refs: ["source_1"], confidence: 90, reasons: ["Published ingredient declaration"], has_conflict: false, includes_ai_inference: false },
        claims: { value: ["帮助保持肌肤水润"], evidence_refs: ["source_1"], confidence: 80, reasons: ["Official public claim"], has_conflict: false, includes_ai_inference: false },
        usage: { value: "洁面后使用", evidence_refs: ["source_1"], confidence: 75, reasons: ["Official usage"], has_conflict: false, includes_ai_inference: false },
        product_type: { value: null, evidence_refs: [], confidence: 0, reasons: ["No supported taxonomy"], has_conflict: false, includes_ai_inference: false },
        uncertainties: ["完整成分声明尚未得到确认"],
        conflicts: [],
      },
    });
    const draft = buildProductResearchDraftResult(catalogIdentity, transport);

    expect(draft.research_payload.ingredients.items).toHaveLength(2);
    expect(draft.research_payload.claims[0]).toMatchObject({ raw_text: "帮助保持肌肤水润", confidence: null });
    expect(draft.research_payload.usage.instructions).toEqual(["洁面后使用"]);
    expect(draft.research_payload.product_type).toEqual({ value: null, confidence: 0, basis: "unknown", evidence_refs: [] });
    expect(draft.research_payload.uncertainties).toEqual([
      { field: "general", description: "完整成分声明尚未得到确认", evidence_refs: [] },
    ]);
  });

  it("rejects English-only consumer fields while preserving source-facing English fields", () => {
    const result = agent3ResearchResultSchema.safeParse({
      ...completeProviderResult,
      research_payload: {
        ...completeProviderResult.research_payload,
        claims: {
          ...completeProviderResult.research_payload.claims,
          value: [{ raw_text: "Helps refine pores", normalized_claim: "Helps refine pores", confidence: 88, evidence_refs: ["source_1"] }],
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it.each([
    ["texture", { ...completeProviderResult.research_payload, texture: { ...completeProviderResult.research_payload.texture, value: "Light liquid texture" } }],
    ["usage instruction", { ...completeProviderResult.research_payload, usage: { ...completeProviderResult.research_payload.usage, value: { ...completeProviderResult.research_payload.usage.value, instructions: ["Apply after cleansing"] } } }],
    ["caution", { ...completeProviderResult.research_payload, usage: { ...completeProviderResult.research_payload.usage, value: { ...completeProviderResult.research_payload.usage.value, cautions: ["Do not use on broken skin"] } } }],
  ])("rejects English-only %s consumer knowledge", (_name, researchPayload) => {
    expect(agent3ResearchResultSchema.safeParse({
      ...completeProviderResult,
      research_payload: researchPayload,
    }).success).toBe(false);
  });

  it("accepts mixed-language sources while keeping all consumer knowledge Chinese", () => {
    const result = agent3ResearchResultSchema.parse({
      ...completeProviderResult,
      sources: [
        ...completeProviderResult.sources,
        { ...completeProviderResult.sources[0], source_id: "source_2", title: "官方中文产品说明", url: "https://www.homefacialpro.com.cn/products/example" },
      ],
      research_payload: {
        ...completeProviderResult.research_payload,
        claims: {
          ...completeProviderResult.research_payload.claims,
          value: [{ raw_text: "Helps refine pores", normalized_claim: "帮助改善毛孔外观", confidence: 88, evidence_refs: ["source_1", "source_2"] }],
          evidence_refs: ["source_1", "source_2"],
        },
      },
    });
    expect(result.research_payload.claims.value).toEqual([
      expect.objectContaining({ raw_text: "Helps refine pores", normalized_claim: "帮助改善毛孔外观", evidence_refs: ["source_1", "source_2"] }),
    ]);
  });
});
