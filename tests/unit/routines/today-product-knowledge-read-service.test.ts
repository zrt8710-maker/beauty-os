import { describe, expect, it, vi } from "vitest";

import { projectPlannerProductEvidenceFromLoaded } from "@/server/services/planner-product-evidence-service";
import {
  runtimeAvailableProductKnowledgeFromLoaded,
  trustedDraftIngredientsFromLoaded,
} from "@/server/services/product-knowledge-runtime-availability-service";
import { createTodayProductKnowledgeReadService } from "@/server/services/today-product-knowledge-read-service";

const verifiedId = "10000000-0000-4000-8000-000000000001";
const candidateId = "10000000-0000-4000-8000-000000000002";
const missingId = "10000000-0000-4000-8000-000000000003";

function researchDraft(catalogProductId: string, options: { partial?: boolean } = {}) {
  return {
    catalog_product_id: catalogProductId,
    updated_at: "2026-09-16T00:00:00.000Z",
    research_payload: {
      field_confidence: {
        claims: { score: 90, has_conflict: false, evidence_refs: ["official"] },
        usage: { score: 90, has_conflict: false, evidence_refs: ["official"] },
        texture: { score: 0, has_conflict: false, evidence_refs: [] },
        product_type: { score: 90, has_conflict: false, evidence_refs: ["official"] },
      },
      sources: [{ source_id: "official", source_type: "official_brand", title: "Official" }],
      claims: [{ raw_text: "补水", normalized_claim: null, evidence_refs: ["official"] }],
      usage: { instructions: [], cautions: [], evidence_refs: ["official"] },
      texture: null,
      ingredients: {
        status: options.partial ? "partial" : "found",
        conflicts: [],
        items: [{ raw_name: "Fragrance", normalized_name: "Fragrance", confidence: 90, evidence_refs: ["official"] }],
      },
      product_type: { value: "toner", basis: "external_evidence", confidence: 90, evidence_refs: ["official"] },
    },
  } as any;
}

const formal = {
  identity: { product_type: "toner", category: "skincare" },
  care_roles: [{ care_role_code: "hydration", assignment_kind: "primary", status: "verified", confidence: 95 }],
  capabilities: [{ capability_code: "hydration", status: "verified", confidence: 95 }],
} as any;

const verifiedIngredientRow = {
  catalog_product_id: verifiedId,
  ingredient: { inci_name: "Fragrance", display_name: "香精", aliases: ["Parfum"] },
} as any;

function createService(overrides: {
  formal?: ReturnType<typeof vi.fn>;
  drafts?: ReturnType<typeof vi.fn>;
  ingredients?: ReturnType<typeof vi.fn>;
} = {}) {
  const findByCatalogProductIds = overrides.formal ?? vi.fn().mockResolvedValue(new Map([[verifiedId, formal]]));
  const getLatestUsableDrafts = overrides.drafts ?? vi.fn().mockResolvedValue(new Map([
    [candidateId, researchDraft(candidateId, { partial: true })],
  ]));
  const listVerifiedProductIngredientsByProductIds = overrides.ingredients ?? vi.fn().mockResolvedValue(new Map([
    [verifiedId, [verifiedIngredientRow]],
  ]));
  return {
    service: createTodayProductKnowledgeReadService({
      formal: { findByCatalogProductIds: findByCatalogProductIds as any },
      drafts: { getLatestUsableDrafts: getLatestUsableDrafts as any },
      ingredients: { listVerifiedProductIngredientsByProductIds: listVerifiedProductIngredientsByProductIds as any },
    }),
    findByCatalogProductIds,
    getLatestUsableDrafts,
    listVerifiedProductIngredientsByProductIds,
  };
}

describe("Today request-scoped Product Knowledge batch reads", () => {
  it("reuses selected-product knowledge and only queries new ids during regeneration", async () => {
    const fixture = createService();
    const selected = await fixture.service.load([verifiedId], { requestId: "request:reuse" });
    const expanded = await fixture.service.load([verifiedId, candidateId], { requestId: "request" });
    expect(fixture.findByCatalogProductIds).toHaveBeenCalledTimes(2);
    expect(fixture.findByCatalogProductIds).toHaveBeenLastCalledWith([candidateId], expect.any(Object));
    expect(fixture.getLatestUsableDrafts).toHaveBeenLastCalledWith([candidateId], expect.any(Object));
    expect(fixture.listVerifiedProductIngredientsByProductIds).toHaveBeenLastCalledWith([candidateId], expect.any(Object));
    expect(expanded.plannerEvidenceByCatalogId.get(verifiedId)).toEqual(selected.plannerEvidenceByCatalogId.get(verifiedId));
    expect(expanded.safetyIngredientsByCatalogId.get(verifiedId)).toEqual(selected.safetyIngredientsByCatalogId.get(verifiedId));
    const fresh = await createService().service.load([verifiedId, candidateId], { requestId: "fresh" });
    expect(expanded).toEqual(fresh);
    const subset = await fixture.service.load([verifiedId], { requestId: "request" });
    expect(subset).toEqual(selected);
    expect(fixture.findByCatalogProductIds).toHaveBeenCalledTimes(2);
  });

  it("retries every source after a failed batch instead of caching incomplete safety data", async () => {
    const ingredients = vi.fn().mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue(new Map([[verifiedId, [verifiedIngredientRow]]]));
    const fixture = createService({ ingredients });
    await expect(fixture.service.load([verifiedId], { requestId: "request:reuse" })).rejects.toThrow("temporary failure");
    const result = await fixture.service.load([verifiedId], { requestId: "request" });
    expect(fixture.findByCatalogProductIds).toHaveBeenCalledTimes(2);
    expect(fixture.getLatestUsableDrafts).toHaveBeenCalledTimes(2);
    expect(ingredients).toHaveBeenCalledTimes(2);
    expect(result.safetyIngredientsByCatalogId.get(verifiedId)?.reliable).toBe(true);
  });

  it("does not share reads between request service instances", async () => {
    const first = createService();
    const second = createService();
    await first.service.load([verifiedId], { requestId: "first" });
    await second.service.load([verifiedId], { requestId: "second" });
    expect(first.findByCatalogProductIds).toHaveBeenCalledTimes(1);
    expect(second.findByCatalogProductIds).toHaveBeenCalledTimes(1);
  });

  it("preserves unknown knowledge without manufacturing reliable safety ingredients", async () => {
    const fixture = createService();
    const first = await fixture.service.load([missingId], { requestId: "request:reuse" });
    const second = await fixture.service.load([missingId], { requestId: "request" });
    expect(second).toEqual(first);
    expect(second.safetyIngredientsByCatalogId.has(missingId)).toBe(false);
    expect(second.runtimeKnowledgeByCatalogId.get(missingId)?.provenance).toBe("unknown");
    expect(fixture.findByCatalogProductIds).toHaveBeenCalledTimes(1);
  });

  it("deduplicates Catalog ids and preserves existing per-product projections", async () => {
    const fixture = createService();
    const bundle = await fixture.service.load(
      [verifiedId, candidateId, verifiedId, missingId],
      { requestId: "request-1" },
    );

    const ids = [verifiedId, candidateId, missingId];
    expect(fixture.findByCatalogProductIds).toHaveBeenCalledWith(ids, expect.any(Object));
    expect(fixture.getLatestUsableDrafts).toHaveBeenCalledWith(ids, { requestId: "request-1" });
    expect(fixture.listVerifiedProductIngredientsByProductIds).toHaveBeenCalledWith(ids, expect.any(Object));

    await expect(projectPlannerProductEvidenceFromLoaded(null, formal)).resolves.toEqual(
      bundle.plannerEvidenceByCatalogId.get(verifiedId),
    );
    await expect(projectPlannerProductEvidenceFromLoaded(researchDraft(candidateId, { partial: true }), null)).resolves.toEqual(
      bundle.plannerEvidenceByCatalogId.get(candidateId),
    );
    expect(bundle.runtimeKnowledgeByCatalogId.get(candidateId)).toEqual(
      runtimeAvailableProductKnowledgeFromLoaded(null, researchDraft(candidateId, { partial: true }), candidateId),
    );
    expect(bundle.runtimeKnowledgeByCatalogId.get(missingId)).toMatchObject({ provenance: "unknown", care_roles: [], capabilities: [] });
  });

  it("keeps verified and trusted-draft ingredient safety semantics", async () => {
    const bundle = await createService().service.load([verifiedId, candidateId], { requestId: "request-2" });

    expect(bundle.safetyIngredientsByCatalogId.get(verifiedId)).toEqual({
      reliable: true,
      ingredients: [{ inciName: "Fragrance", displayName: "香精", aliases: ["Parfum"] }],
    });
    expect(bundle.safetyIngredientsByCatalogId.get(candidateId)?.ingredients).toEqual(
      trustedDraftIngredientsFromLoaded(researchDraft(candidateId, { partial: true }), candidateId),
    );
  });

  it("fails closed when any batch query fails", async () => {
    const service = createService({
      ingredients: vi.fn().mockRejectedValue(new Error("KNOWLEDGE_INGREDIENT_READ_FAILED")),
    }).service;

    await expect(service.load([verifiedId, candidateId], { requestId: "request-3" }))
      .rejects.toThrow("KNOWLEDGE_INGREDIENT_READ_FAILED");
  });
});
