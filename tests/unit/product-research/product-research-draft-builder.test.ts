import { describe, expect, it } from "vitest";
import type { Agent3ResearchResult } from "@/schemas/product-research";

import { buildProductResearchDraftResult } from "@/server/services/product-research-draft-builder";

const input = {
  catalog_product_id: "10000000-0000-4000-8000-000000000001",
  brand_name: "HFP（HomeFacialPro）",
  product_name: "果酸毛孔净透精华水",
  variant_name: null,
  barcode: null,
  aliases: ["HFP果酸水"],
  identity_sources: [],
};
const source = { source_id: "source_1", URL: "https://example.test/product", title: "Product page", source_type: "official", authority_tier: 1, retrieved_at: "2026-08-27T00:00:00.000Z" };
const evidence = (value: unknown, confidence = 0, evidence_refs: string[] = []) => ({ value, evidence_refs, confidence, reasons: ["research evidence"], has_conflict: false, includes_ai_inference: false });

function result(overrides: Record<string, unknown> = {}): Agent3ResearchResult {
  return {
    sources: [source],
    overall_confidence: 87.5,
    research_run_id: "run_1",
    research_payload: {
      identity: evidence({ brand_name: "wrong model brand", product_name: "wrong model product", aliases: ["model alias"], variant_name: "wrong", barcode: "12345678" }, 90, ["source_1"]),
      ingredients: evidence(null), claims: evidence(null), texture: evidence(null), usage: evidence(null), product_type: evidence(null),
      field_confidence: { identity: 87.5, ingredients: 0, claims: 0, texture: 0, usage: 0, product_type: 0, care_role_candidates: 0, capability_candidates: 0, risk_cautions: 0 },
      uncertainties: [], conflicts: [],
      ...overrides,
    },
  } as unknown as Agent3ResearchResult;
}

describe("Agent3 research result to draft adapter", () => {
  it("maps only AI identity evidence and cannot overwrite Catalog identity", () => {
    const composed = buildProductResearchDraftResult(input, result());
    expect(composed.research_payload.identity).toMatchObject({ brand_name: input.brand_name, product_name: input.product_name, variant_name: null, barcode: null, aliases: ["model alias"], uncertainties: [] });
    expect(composed.research_payload.identity).not.toHaveProperty("value");
    expect(composed.research_payload.field_confidence.identity).toMatchObject({ score: 90, evidence_refs: ["source_1"] });
  });

  it("uses empty aliases and uncertainties when Agent3 omits them", () => {
    const composed = buildProductResearchDraftResult(input, result({ identity: evidence({}, 80, ["source_1"]) }));
    expect(composed.research_payload.identity.aliases).toEqual([]);
    expect(composed.research_payload.identity.uncertainties).toEqual([]);
  });

  it("uses canonical section confidence and ignores obsolete payload field_confidence", () => {
    const composed = buildProductResearchDraftResult(input, result({ field_confidence: { identity: 87.5, ingredients: 100.3, claims: -1, texture: 0, usage: 0, product_type: 0, care_role_candidates: 0, capability_candidates: 0, risk_cautions: 0 } }));
    expect(composed.overall_confidence).toBe(88);
    expect(composed.research_payload.field_confidence.ingredients.score).toBe(0);
    expect(composed.research_payload.field_confidence.claims.score).toBe(0);
  });

  it("maps established ingredient statuses and permits unknown empty evidence", () => {
    const composed = buildProductResearchDraftResult(input, result());
    expect(composed.research_payload.ingredients).toMatchObject({ status: "unknown", raw_text: [], items: [] });
  });

  it("maps one raw source declaration and string items without parsing or inventing ingredient facts", () => {
    const composed = buildProductResearchDraftResult(input, result({
      ingredients: evidence({
        status: "found",
        raw_text: "Water, Glycerin (and) Sodium Hyaluronate",
        items: ["Water", "Glycerin"],
        conflicts: [],
      }, 95, ["source_1"]),
    }));

    expect(composed.research_payload.ingredients.raw_text).toEqual([
      "Water, Glycerin (and) Sodium Hyaluronate",
    ]);
    expect(composed.research_payload.ingredients.items).toEqual([
      { raw_name: "Water", normalized_name: null, ingredient_order: null, confidence: null, evidence_refs: ["source_1"] },
      { raw_name: "Glycerin", normalized_name: null, ingredient_order: null, confidence: null, evidence_refs: ["source_1"] },
    ]);
  });

  it("maps named ingredient objects and string public claims with section provenance", () => {
    const composed = buildProductResearchDraftResult(input, result({
      ingredients: evidence({
        status: "found", raw_text: "Water", items: [{ name: "Water" }], conflicts: [],
      }, 95, ["source_1"]),
      claims: evidence(["Helps hydrate skin"], 80, ["source_1"]),
    }));

    expect(composed.research_payload.ingredients.items).toEqual([
      { raw_name: "Water", normalized_name: null, ingredient_order: null, confidence: null, evidence_refs: ["source_1"] },
    ]);
    expect(composed.research_payload.claims).toEqual([
      { raw_text: "Helps hydrate skin", normalized_claim: null, confidence: null, evidence_refs: ["source_1"] },
    ]);
  });

  it("keeps missing usage and product type facts unknown without deriving them", () => {
    const composed = buildProductResearchDraftResult(input, result({
      usage: evidence(null),
      product_type: evidence("not_a_beauty_os_product_type", 90, ["source_1"]),
    }));

    expect(composed.research_payload.usage).toMatchObject({ instructions: [], am_pm: [], frequency: null, confidence: 0 });
    expect(composed.research_payload.product_type).toEqual({ value: null, confidence: 0, basis: "unknown", evidence_refs: [] });
  });

  it("persists texture only when Agent3 supplies product-specific provenance", () => {
    const composed = buildProductResearchDraftResult(input, result({
      texture: evidence("Lightweight gel texture", 80, ["source_1"]),
    }));

    expect(composed.research_payload.texture).toEqual({
      value: "Lightweight gel texture",
      basis: "external_evidence",
      confidence: 80,
      evidence_refs: ["source_1"],
    });
  });

  it("maps string uncertainties into the required neutral persisted structure", () => {
    const composed = buildProductResearchDraftResult(input, result({
      uncertainties: ["The full ingredient declaration could not be confirmed"],
      conflicts: [],
    }));

    expect(composed.research_payload.uncertainties).toEqual([
      { field: "general", description: "The full ingredient declaration could not be confirmed", evidence_refs: [] },
    ]);
    expect(composed.research_payload.conflicts).toEqual([]);
  });

  it("isolates malformed optional evidence as unknown or partial sections", () => {
    expect(buildProductResearchDraftResult(input, result({ ingredients: evidence({ status: "found", raw_text: [], items: [] }) })).research_payload.ingredients.status).toBe("unknown");
    expect(buildProductResearchDraftResult(input, result({ ingredients: evidence({ status: "available", raw_text: [], items: [] }) })).research_payload.ingredients.status).toBe("unknown");
    expect(buildProductResearchDraftResult(input, result({ ingredients: evidence({ status: "found", raw_text: [], items: "Water" }) })).research_payload.ingredients.status).toBe("unknown");
    expect(buildProductResearchDraftResult(input, result({ claims: evidence("not-an-array") })).research_payload.claims).toEqual([]);
    expect(buildProductResearchDraftResult(input, result({ uncertainties: "not-an-array" })).research_payload.uncertainties).toEqual([]);
    expect(buildProductResearchDraftResult(input, result({ conflicts: ["An unsupported conflict string"] })).research_payload.conflicts).toEqual([]);
    expect(buildProductResearchDraftResult(input, result({ uncertainties: [{ field: "general", description: "x", evidence_refs: [], extra: true }] })).research_payload.uncertainties).toEqual([]);
  });

  it("preserves partial ingredient items when raw text is null or empty", () => {
    const rawTextNull = buildProductResearchDraftResult(input, result({
      ingredients: evidence({ status: "partial", raw_text: null, items: ["透明质酸钠"] }, 60, ["source_1"]),
    }));
    const whitespace = buildProductResearchDraftResult(input, result({
      ingredients: evidence({ status: "partial", raw_text: ["", "  "], items: ["甘油"] }, 60, ["source_1"]),
    }));
    expect(rawTextNull.research_payload.ingredients).toMatchObject({ status: "partial", raw_text: [], items: [{ raw_name: "透明质酸钠" }] });
    expect(whitespace.research_payload.ingredients).toMatchObject({ status: "partial", raw_text: [], items: [{ raw_name: "甘油" }] });
  });

  it("normalizes a missing uncertainty field without inventing its content", () => {
    const composed = buildProductResearchDraftResult(input, result({
      uncertainties: [{ description: "The exact product variant could not be confirmed", evidence_refs: [] }],
    }));
    expect(composed.research_payload.uncertainties).toEqual([
      { field: "general", description: "The exact product variant could not be confirmed", evidence_refs: [] },
    ]);
  });

  it("isolates null optional usage fields without discarding other research", () => {
    const composed = buildProductResearchDraftResult(input, result({
      claims: evidence(["Official public claim"], 80, ["source_1"]),
      usage: evidence({ instructions: null, cautions: null, am_pm: null, frequency: " " }, 70, ["source_1"]),
    }));
    expect(composed.research_payload.claims).toHaveLength(1);
    expect(composed.research_payload.usage).toMatchObject({ instructions: [], cautions: [], am_pm: [], frequency: null });
  });

  it("preserves source-backed usage cautions in the existing risk knowledge field", () => {
    const composed = buildProductResearchDraftResult(input, result({
      usage: evidence({
        instructions: ["洁面后使用"], cautions: ["避免接触眼睛"], am_pm: ["pm"],
        frequency: "每日一次", routine_order: "精华后", leave_on: true, rinse_off: false,
      }, 72, ["source_1"]),
    }));

    expect(composed.research_payload.risk_cautions).toEqual([{
      code_or_label: "产品使用注意事项",
      description: "避免接触眼睛",
      confidence: 72,
      basis: "external_evidence",
      evidence_refs: ["source_1"],
    }]);
    expect(composed.research_payload.field_confidence.risk).toMatchObject({
      score: 72,
      evidence_refs: ["source_1"],
    });
  });

  it("writes explicit empty representations for non-researched domains", () => {
    const composed = buildProductResearchDraftResult(input, result());
    expect(composed.research_payload).toMatchObject({ texture: null, care_role_candidates: [], capability_candidates: [], risk_cautions: [] });
  });

  it("retains source-referenced AI role and capability hypotheses without promoting them", () => {
    const composed = buildProductResearchDraftResult(input, result({
      care_role_candidates: evidence([{ code: "hydration", confidence: 76, evidence_refs: ["source_1"] }], 76, ["source_1"]),
      capability_candidates: evidence([{ code: "hydration", confidence: 74, evidence_refs: ["source_1"] }], 74, ["source_1"]),
    }));

    expect(composed.research_payload.care_role_candidates).toEqual([
      { code: "hydration", confidence: 76, basis: "ai_inference", evidence_refs: ["source_1"] },
    ]);
    expect(composed.research_payload.capability_candidates).toEqual([
      { code: "hydration", confidence: 74, basis: "ai_inference", evidence_refs: ["source_1"] },
    ]);
  });

  it("keeps source and semantic validation strict", () => {
    expect(() => buildProductResearchDraftResult(input, { ...result(), sources: [{ ...source, URL: "not-a-url" }] } as never)).toThrow();
    expect(() => buildProductResearchDraftResult(input, result({ claims: evidence([{ raw_text: "unsupported", normalized_claim: null, confidence: 80, evidence_refs: ["missing"] }]) }))).toThrow();
  });

  it("preserves top-level Agent3 provenance in the persisted draft payload", () => {
    const composed = buildProductResearchDraftResult(input, result());
    expect(composed.research_payload.sources).toEqual([{
      source_id: source.source_id,
      url: source.URL,
      title: source.title,
      source_type: source.source_type,
      authority_tier: source.authority_tier,
      retrieved_at: source.retrieved_at,
    }]);
  });

  it("rejects string and non-finite confidence values", () => {
    expect(() => buildProductResearchDraftResult(input, { ...result(), overall_confidence: "88%" } as never)).toThrow();
    expect(() => buildProductResearchDraftResult(input, { ...result(), overall_confidence: Number.NaN } as never)).toThrow();
  });
});
