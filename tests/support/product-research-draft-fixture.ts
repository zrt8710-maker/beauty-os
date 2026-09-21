import {
  productResearchDraftSchema,
  type ProductResearchDraft,
} from "@/schemas/product-research-draft";

const timestamp = "2026-08-28T00:00:00.000Z";

export function productResearchDraftFixture(
  overrides: Partial<ProductResearchDraft> = {},
) {
  return productResearchDraftSchema.parse({
    id: "30000000-0000-4000-8000-000000000001",
    catalog_product_id: "10000000-0000-4000-8000-000000000001",
    research_version: 1,
    status: "draft",
    research_payload: {
      identity: {
        brand_name: "HFP",
        product_name: "果酸毛孔净透精华水",
        aliases: ["HomeFacialPro"],
        variant_name: null,
        barcode: null,
        confidence: 90,
        evidence_refs: ["source_1"],
        uncertainties: [],
      },
      ingredients: {
        status: "unknown",
        raw_text: [],
        items: [],
        conflicts: [],
        confidence: 0,
      },
      claims: [],
      texture: null,
      usage: {
        instructions: [],
        am_pm: [],
        frequency: null,
        routine_order: null,
        leave_on: null,
        rinse_off: null,
        cautions: [],
        confidence: 0,
        evidence_refs: [],
      },
      product_type: {
        value: null,
        confidence: 0,
        basis: "unknown",
        evidence_refs: [],
      },
      care_role_candidates: [],
      capability_candidates: [],
      risk_cautions: [],
      field_confidence: Object.fromEntries([
        "identity", "ingredients", "claims", "texture", "usage",
        "product_type", "care_role", "capability", "risk",
      ].map((field) => [field, {
        score: field === "identity" ? 90 : 0,
        evidence_refs: field === "identity" ? ["source_1"] : [],
        reasons: [field === "identity" ? "Official product identity" : "Not researched"],
        has_conflict: false,
        includes_ai_inference: false,
      }])),
      sources: [{
        source_id: "source_1",
        url: "https://www.homefacialpro.com/",
        title: "HomeFacialPro",
        source_type: "official_brand",
        authority_tier: 1,
        retrieved_at: timestamp,
      }],
      uncertainties: [],
      conflicts: [],
    },
    overall_confidence: 30,
    created_by: "ai",
    research_model: "doubao-seed-2.1-turbo",
    research_run_id: "run_1",
    reviewed_by: null,
    reviewed_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    ...overrides,
  });
}
