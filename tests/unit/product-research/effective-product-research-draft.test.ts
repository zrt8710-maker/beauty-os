import { describe, expect, it } from "vitest";
import type { ProductResearchDraft } from "@/schemas/product-research-draft";

import {
  effectiveProductResearchDraft,
  hasCompleteEnoughProductResearch,
  missingProductResearchSections,
  productResearchDelta,
} from "@/server/services/effective-product-research-draft";

const catalogProductId = "10000000-0000-4000-8000-000000000001";

function snapshot(version: number, overrides: Record<string, unknown> = {}) {
  const sourceId = "source_1";
  const refs = [sourceId];
  const confidence = { score: 90, evidence_refs: refs, reasons: [], has_conflict: false, includes_ai_inference: false };
  return {
    id: `30000000-0000-4000-8000-00000000000${version}`,
    catalog_product_id: catalogProductId,
    research_version: version,
    status: "draft",
    reviewed_by: null,
    reviewed_at: null,
    created_at: `2026-09-0${version}T00:00:00.000Z`,
    updated_at: `2026-09-0${version}T00:00:00.000Z`,
    overall_confidence: 90,
    created_by: "ai",
    research_model: null,
    research_run_id: null,
    research_payload: {
      identity: { brand_name: "Brand", product_name: "Product", variant_name: null, barcode: null, aliases: [], confidence: 90, evidence_refs: refs, uncertainties: [] },
      ingredients: { status: "found", raw_text: ["Water"], items: [{ raw_name: "Water", normalized_name: "Water", ingredient_order: null, confidence: 90, evidence_refs: refs }], conflicts: [], confidence: 90 },
      claims: [{ raw_text: "Hydrates", normalized_claim: "Hydrates", confidence: 90, evidence_refs: refs }],
      texture: { value: "light gel", basis: "external_evidence", confidence: 90, evidence_refs: refs },
      usage: { instructions: ["Apply after cleansing"], am_pm: [], frequency: null, routine_order: null, leave_on: true, rinse_off: false, cautions: ["Avoid eyes"], confidence: 90, evidence_refs: refs },
      product_type: { value: "moisturizer", confidence: 90, basis: "external_evidence", evidence_refs: refs },
      care_role_candidates: [], capability_candidates: [], risk_cautions: [],
      field_confidence: { identity: confidence, ingredients: confidence, claims: confidence, texture: confidence, usage: confidence, product_type: confidence, care_role: confidence, capability: confidence, risk: confidence },
      sources: [{ source_id: sourceId, url: `https://example.test/v${version}`, title: `Source ${version}`, source_type: "official_brand", authority_tier: 1, retrieved_at: `2026-09-0${version}T00:00:00.000Z` }],
      uncertainties: [], conflicts: [],
      ...overrides,
    },
  } as unknown as ProductResearchDraft;
}

describe("effective Product Research draft", () => {
  it("inherits a prior reliable section when the newest enrichment omits it", () => {
    const earlier = snapshot(1);
    const newer = snapshot(2, {
      texture: null,
      field_confidence: { ...snapshot(2).research_payload.field_confidence, texture: { score: 0, evidence_refs: [], reasons: [], has_conflict: false, includes_ai_inference: false } },
    });

    const effective = effectiveProductResearchDraft([newer, earlier]);

    expect(effective?.research_version).toBe(2);
    expect(effective?.research_payload.texture?.value).toBe("light gel");
    expect(effective?.research_payload.texture?.evidence_refs[0]).toMatch(/^v20260901_source_1$/);
    expect(missingProductResearchSections(effective)).toEqual([]);
  });

  it("does not replace a newly conflicted ingredient section with an older apparent answer", () => {
    const earlier = snapshot(1);
    const newer = snapshot(2, {
      ingredients: { status: "conflicted", raw_text: [], items: [], conflicts: [{ field: "ingredients", values: ["A", "B"], severity: "review_required", evidence_refs: ["source_1", "source_1"] }], confidence: 90 },
    });

    const effective = effectiveProductResearchDraft([newer, earlier]);

    expect(effective?.research_payload.ingredients.status).toBe("conflicted");
    expect(missingProductResearchSections(effective)).toContain("ingredients");
  });

  it("keeps partial ingredient evidence usable while continuing to request full ingredients", () => {
    const draft = snapshot(1, {
      ingredients: {
        ...snapshot(1).research_payload.ingredients,
        status: "partial",
      },
    });

    expect(draft.research_payload.ingredients.items).toHaveLength(1);
    expect(missingProductResearchSections(draft)).toContain("ingredients");
    expect(hasCompleteEnoughProductResearch(draft)).toBe(false);
  });

  it("treats complete source-backed research as complete when auditable metadata has no public URL", () => {
    const draft = snapshot(1, {
      sources: [{
        ...snapshot(1).research_payload.sources[0],
        url: null,
        title: "Brand official product material",
        source_type: "official_brand",
        authority_tier: 1,
      }],
    });

    expect(missingProductResearchSections(draft)).toEqual([]);
    expect(hasCompleteEnoughProductResearch(draft)).toBe(true);
  });

  it("does not treat an unclassified source without provenance as complete", () => {
    const draft = snapshot(1, {
      sources: [{
        ...snapshot(1).research_payload.sources[0],
        url: null,
        title: "Unclassified source",
        source_type: "unclassified_provider",
        authority_tier: null,
      }],
    });

    expect(missingProductResearchSections(draft)).toContain("reliable_sources");
    expect(hasCompleteEnoughProductResearch(draft)).toBe(false);
  });

  it("preserves all non-conflicting Marubi facts when a later enrichment response is narrower", () => {
    const claims = Array.from({ length: 9 }, (_, index) => ({
      raw_text: `Claim ${index + 1}`,
      normalized_claim: null,
      confidence: 80,
      evidence_refs: ["source_1"],
    }));
    const earlier = snapshot(1, {
      ingredients: {
        ...snapshot(1).research_payload.ingredients,
        items: [
          { raw_name: "Ingredient A", normalized_name: null, ingredient_order: null, confidence: 80, evidence_refs: ["source_1"] },
          { raw_name: "Ingredient B", normalized_name: null, ingredient_order: null, confidence: 80, evidence_refs: ["source_1"] },
        ],
      },
      claims,
    });
    const newer = snapshot(2, {
      ingredients: {
        ...snapshot(2).research_payload.ingredients,
        items: [{ raw_name: "Ingredient A", normalized_name: null, ingredient_order: null, confidence: 85, evidence_refs: ["source_1"] }],
      },
      claims: claims.slice(0, 7),
    });

    const effective = effectiveProductResearchDraft([newer, earlier]);

    expect(effective?.research_payload.ingredients.items).toHaveLength(2);
    expect(effective?.research_payload.claims).toHaveLength(9);
    expect(effective?.research_payload.ingredients.items[0]?.evidence_refs).toHaveLength(2);
  });

  it("unions usage instructions and cautions while preserving singleton usage fields", () => {
    const earlier = snapshot(1);
    const newer = snapshot(2, {
      usage: {
        ...snapshot(2).research_payload.usage,
        instructions: ["Use one pump"],
        cautions: ["Stop if irritation occurs"],
        frequency: "daily",
      },
    });

    const effective = effectiveProductResearchDraft([newer, earlier]);

    expect(effective?.research_payload.usage.instructions).toEqual(["Use one pump", "Apply after cleansing"]);
    expect(effective?.research_payload.usage.cautions).toEqual(["Stop if irritation occurs", "Avoid eyes"]);
    expect(effective?.research_payload.usage.frequency).toBe("daily");
  });

  it("allows an explicit supported conflict to prevent inheritance of prior claims", () => {
    const earlier = snapshot(1);
    const newerBase = snapshot(2);
    const newer = snapshot(2, {
      claims: [{ raw_text: "Corrected claim", normalized_claim: null, confidence: 90, evidence_refs: ["source_1"] }],
      field_confidence: {
        ...newerBase.research_payload.field_confidence,
        claims: { ...newerBase.research_payload.field_confidence.claims, has_conflict: true },
      },
    });

    const effective = effectiveProductResearchDraft([newer, earlier]);

    expect(effective?.research_payload.claims.map((claim) => claim.raw_text)).toEqual(["Corrected claim"]);
    expect(productResearchDelta(earlier, effective).invalidated_fact_count).toBeGreaterThan(0);
  });

  it("keeps empty cautions missing instead of treating them as confirmed absent", () => {
    const draft = snapshot(1, { usage: { ...snapshot(1).research_payload.usage, cautions: [] } });
    expect(missingProductResearchSections(draft)).toContain("cautions");
  });
});
