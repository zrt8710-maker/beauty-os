import { describe, expect, it } from "vitest";

import { deriveRuntimeProductKnowledge } from "@/server/domain/product-knowledge-derivation";

const catalogProductId = "10000000-0000-4000-8000-000000000001";
const reviewedAt = "2026-09-05T00:00:00.000Z";

describe("deriveRuntimeProductKnowledge", () => {
  it("derives cleanser and sunscreen roles from source-backed normalized taxonomy", () => {
    const cleanser = deriveRuntimeProductKnowledge({
      catalogProductId,
      productType: "cleanser",
      research: research("cleanser"),
      reviewedAt,
    });
    const sunscreen = deriveRuntimeProductKnowledge({
      catalogProductId,
      productType: "sunscreen",
      research: research("sunscreen"),
      reviewedAt,
    });

    expect(cleanser.roles).toEqual([expect.objectContaining({ care_role_code: "cleanser", status: "verified" })]);
    expect(cleanser.capabilities).toEqual([]);
    expect(sunscreen.roles).toEqual([expect.objectContaining({ care_role_code: "sunscreen", status: "verified" })]);
    expect(sunscreen.capabilities).toEqual([expect.objectContaining({
      capability_code: "sun_protection",
      status: "verified",
      evidence: [expect.objectContaining({ source_locator: "https://brand.example/product" })],
    })]);
  });

  it("requires taxonomy plus a separate source-backed fact before verifying hydration", () => {
    const proposal = deriveRuntimeProductKnowledge({
      catalogProductId,
      productType: "moisturizer",
      research: research("moisturizer", "Helps moisturize dry skin."),
      reviewedAt,
    });
    expect(proposal.roles).toEqual([expect.objectContaining({ care_role_code: "moisturizer" })]);
    expect(proposal.capabilities).toEqual([expect.objectContaining({
      capability_code: "hydration",
      evidence: expect.arrayContaining([
        expect.objectContaining({ evidence_type: "manual_curation" }),
        expect.objectContaining({ evidence_type: "official_product_description" }),
      ]),
    })]);
  });

  it("does not turn a repair marketing claim into barrier_support or soothing", () => {
    const proposal = deriveRuntimeProductKnowledge({
      catalogProductId,
      productType: "moisturizer",
      research: research("moisturizer", "Helps repair and soothe skin."),
      reviewedAt,
    });
    expect(proposal.capabilities).toEqual([]);
  });

  it("abstains when the normalized type is AI-derived, conflicted, or mismatched", () => {
    const ai = research("moisturizer");
    ai.product_type.basis = "ai_inference";
    const conflicted = research("moisturizer");
    conflicted.field_confidence.product_type.has_conflict = true;
    expect(deriveRuntimeProductKnowledge({ catalogProductId, productType: "moisturizer", research: ai, reviewedAt }).roles).toEqual([]);
    expect(deriveRuntimeProductKnowledge({ catalogProductId, productType: "moisturizer", research: conflicted, reviewedAt }).roles).toEqual([]);
  });
});

function research(productType: "cleanser" | "moisturizer" | "sunscreen", claim?: string) {
  const refs = ["official"];
  return {
    identity: { brand_name: "CeraVe", product_name: "Example", aliases: [], variant_name: null, barcode: null, confidence: 95, evidence_refs: refs, uncertainties: [] },
    ingredients: { status: "unknown" as const, raw_text: [], items: [], conflicts: [], confidence: null },
    claims: claim ? [{ raw_text: claim, normalized_claim: null, confidence: 90, evidence_refs: refs }] : [],
    texture: null,
    usage: { instructions: [], am_pm: [], frequency: null, routine_order: null, leave_on: null, rinse_off: null, cautions: [], confidence: null, evidence_refs: [] },
    product_type: { value: productType, confidence: 95, basis: "external_evidence" as const, evidence_refs: refs },
    care_role_candidates: [], capability_candidates: [], risk_cautions: [],
    field_confidence: Object.fromEntries(["identity", "ingredients", "claims", "texture", "usage", "product_type", "care_role", "capability", "risk"].map((key) => [key, { score: 90, evidence_refs: refs, reasons: [], has_conflict: false, includes_ai_inference: false }])),
    sources: [{ source_id: "official", url: "https://brand.example/product", title: "Official product page", source_type: "official_brand", authority_tier: 1, retrieved_at: reviewedAt }],
    uncertainties: [], conflicts: [],
  } as any;
}
