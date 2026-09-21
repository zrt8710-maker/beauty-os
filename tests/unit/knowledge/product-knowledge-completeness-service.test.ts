import { describe, expect, it } from "vitest";

import type { CatalogIdentityProduct } from "@/server/repositories/catalog-identity-repository";
import { createProductKnowledgeCompletenessService } from "@/server/services/product-knowledge-completeness-service";
import { productResearchDraftFixture } from "../../support/product-research-draft-fixture";

const product: CatalogIdentityProduct = {
  id: "10000000-0000-4000-8000-000000000001",
  brand_name: "颐莲",
  product_name: "玻尿酸保湿喷雾",
  variant_name: null,
  barcode: null,
  category: "skincare",
  subcategory: "face_care",
  product_type: "toner",
  confidence: 90,
  status: "candidate",
  created_at: "2026-08-28T00:00:00+00:00",
  updated_at: "2026-08-28T00:00:00+00:00",
};

describe("ProductKnowledgeCompletenessService", () => {
  it("treats a user-confirmed candidate as identity-complete without runtime verification", () => {
    const result = assess({ latest_snapshot: null });

    expect(result.fields.identity).toBe("complete");
    expect(result.fields.ingredients).toBe("missing");
    expect(result.suggested_actions).toContain("rerun_research");
  });

  it("treats an absent Catalog variant as no variant applicable unless evidence says otherwise", () => {
    const result = assess({ latest_snapshot: null });

    expect(result.fields.variant).toBe("complete");
  });

  it("uses source-backed structured ingredients rather than raw INCI presence for completeness", () => {
    const withoutRawInci = assess({ latest_snapshot: productResearchDraftFixture({
      research_payload: {
        ...productResearchDraftFixture().research_payload,
        ingredients: {
          ...productResearchDraftFixture().research_payload.ingredients,
          status: "partial",
          raw_text: [],
          items: [{ raw_name: "Aqua", normalized_name: "AQUA", ingredient_order: 1, confidence: 90, evidence_refs: ["source_1"] }],
        },
      },
    }) });
    const withRawInciButNoFacts = assess({ latest_snapshot: productResearchDraftFixture({
      research_payload: {
        ...productResearchDraftFixture().research_payload,
        ingredients: {
          ...productResearchDraftFixture().research_payload.ingredients,
          status: "partial",
          raw_text: ["Aqua, Glycerin"],
          items: [],
        },
      },
    }) });

    expect(withoutRawInci.fields.ingredients).toBe("complete");
    expect(withRawInciButNoFacts.fields.ingredients).toBe("missing");
  });

  it("keeps a hard ingredient conflict uncertain", () => {
    const base = productResearchDraftFixture().research_payload;
    const snapshot = productResearchDraftFixture({ research_payload: {
      ...base,
      ingredients: {
        ...base.ingredients,
        status: "conflicted",
        items: [{ raw_name: "Aqua", normalized_name: "AQUA", ingredient_order: 1, confidence: 90, evidence_refs: ["source_1"] }],
      },
    } });

    expect(assess({ latest_snapshot: snapshot }).fields.ingredients).toBe("uncertain");
  });

  it("marks the 24-item Lancome-shaped structured ingredient fixture complete", () => {
    const base = productResearchDraftFixture().research_payload;
    const snapshot = productResearchDraftFixture({ research_payload: {
      ...base,
      ingredients: {
        ...base.ingredients,
        status: "partial",
        raw_text: ["AQUA / WATER / EAU, ..."],
        items: Array.from({ length: 24 }, (_, index) => ({
          raw_name: `Ingredient ${index + 1}`,
          normalized_name: `INGREDIENT ${index + 1}`,
          ingredient_order: index + 1,
          confidence: 85,
          evidence_refs: ["source_1"],
        })),
        conflicts: [],
      },
    } });

    expect(assess({ latest_snapshot: snapshot }).fields.ingredients).toBe("complete");
  });

  it("marks unresolved variant evidence uncertain and asks for confirmation", () => {
    const snapshot = productResearchDraftFixture({
      research_payload: {
        ...productResearchDraftFixture().research_payload,
        identity: {
          ...productResearchDraftFixture().research_payload.identity,
          uncertainties: [{ field: "variant", description: "II 与进阶型是否同一版本尚未确认", evidence_refs: ["source_1"] }],
        },
      },
    });
    const result = assess({ latest_snapshot: snapshot });

    expect(result.fields.variant).toBe("uncertain");
    expect(result.fields.uncertainties_conflicts).toBe("uncertain");
    expect(result.overall).toBe("needs_attention");
    expect(result.suggested_actions).toContain("confirm_variant");
  });

  it("uses only evidence-referenced sources for source quality", () => {
    const base = productResearchDraftFixture().research_payload;
    const snapshot = productResearchDraftFixture({
      research_payload: {
        ...base,
        claims: [{ raw_text: "补水", normalized_claim: null, confidence: 70, evidence_refs: ["source_1"] }],
        sources: [{ ...base.sources[0], source_type: "official_product_page" }],
      },
    });

    expect(assess({ latest_snapshot: snapshot }).source_quality).toBe("strong");
  });

  it("does not make absent claims, texture, usage, or cautions fail an otherwise sourced V1 record", () => {
    const base = productResearchDraftFixture().research_payload;
    const snapshot = productResearchDraftFixture({
      research_payload: {
        ...base,
        ingredients: { ...base.ingredients, status: "unknown", raw_text: [], items: [] },
        claims: [],
        texture: null,
        usage: { ...base.usage, instructions: [], am_pm: [], frequency: null, routine_order: null, leave_on: null, rinse_off: null, cautions: [] },
        sources: [{ ...base.sources[0], source_type: "official_product_page" }],
      },
    });

    const result = assess({ latest_snapshot: snapshot });

    expect(result.fields.cautions).toBe("missing");
    expect(result.overall).toBe("usable");
  });
});

function assess(input: { latest_snapshot: ReturnType<typeof productResearchDraftFixture> | null }) {
  return createProductKnowledgeCompletenessService().assess({ product, ...input });
}
