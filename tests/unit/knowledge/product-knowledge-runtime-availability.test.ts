import { describe, expect, it, vi } from "vitest";
import { createProductKnowledgeRuntimeAvailabilityService } from "@/server/services/product-knowledge-runtime-availability-service";

const id = "10000000-0000-4000-8000-000000000001";
function service(draft = trustedType("cleanser"), formal: any = null) {
  return createProductKnowledgeRuntimeAvailabilityService({
    formal: { findByCatalogProductId: vi.fn().mockResolvedValue(formal) },
    drafts: { getLatestUsableDraft: vi.fn().mockResolvedValue(draft) },
  });
}
function trustedType(type: "cleanser" | "toner" | "serum" | "sunscreen", sourceType = "official_brand") {
  return { catalog_product_id: id, updated_at: "2026-09-05T00:00:00.000Z", research_payload: { product_type: { value: type, basis: "external_evidence", confidence: 90, evidence_refs: ["source-1"] }, field_confidence: { product_type: { has_conflict: false } }, sources: [{ source_id: "source-1", source_type: sourceType, url: "https://example.com" }], claims: [], usage: { confidence: null, instructions: [], evidence_refs: [] } } } as any;
}

describe("Product Knowledge Runtime Availability", () => {
  it("derives only source-backed candidate baseline roles", async () => {
    await expect(service(trustedType("cleanser")).findByCatalogProductId(id)).resolves.toMatchObject({ provenance: "draft_derived", care_roles: [{ care_role_code: "cleanser", status: "verified" }], capabilities: [] });
    await expect(service(trustedType("toner", "品牌官网产品中心")).findByCatalogProductId(id)).resolves.toMatchObject({ care_roles: [{ care_role_code: "hydration" }], capabilities: [] });
    await expect(service(trustedType("serum")).findByCatalogProductId(id)).resolves.toMatchObject({ provenance: "draft_derived", care_roles: [], capabilities: [] });
  });

  it("derives sunscreen protection but rejects conflicts and low confidence", async () => {
    await expect(service(trustedType("sunscreen")).findByCatalogProductId(id)).resolves.toMatchObject({ capabilities: [{ capability_code: "sun_protection", status: "verified" }] });
    const conflicted = trustedType("cleanser");
    conflicted.research_payload.field_confidence.product_type.has_conflict = true;
    await expect(service(conflicted).findByCatalogProductId(id)).resolves.toMatchObject({ provenance: "draft_derived", care_roles: [] });
    const low = trustedType("cleanser");
    low.research_payload.product_type.confidence = 70;
    await expect(service(low).findByCatalogProductId(id)).resolves.toMatchObject({ care_roles: [] });
  });

  it("keeps formal fields and only fills missing fields from a draft", async () => {
    const formal = { care_roles: [{ care_role_code: "moisturizer", assignment_kind: "primary", status: "verified", confidence: 99 }], capabilities: [] };
    await expect(service(trustedType("sunscreen"), formal).findByCatalogProductId(id)).resolves.toMatchObject({ provenance: "formal_verified", care_roles: [{ care_role_code: "moisturizer" }, { care_role_code: "sunscreen" }], capabilities: [{ capability_code: "sun_protection" }] });
  });

  it("does not let completeness provenance relax the trusted-ingredient safety gate", async () => {
    const untrusted = trustedType("cleanser", "unclassified_provider");
    untrusted.research_payload.sources[0].url = null;
    untrusted.research_payload.ingredients = {
      status: "found",
      conflicts: [],
      items: [{ raw_name: "Fragrance", normalized_name: "Fragrance", confidence: 90, evidence_refs: ["source-1"] }],
    };

    await expect(service(untrusted).findTrustedDraftIngredients(id)).resolves.toEqual([]);
  });
});
