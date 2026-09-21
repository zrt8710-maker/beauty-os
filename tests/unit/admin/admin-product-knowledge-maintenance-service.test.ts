import { describe, expect, it } from "vitest";

import { productResearchDraftFixture } from "@/../tests/support/product-research-draft-fixture";
import type { ProductResearchDraft, ProductResearchDraftCreate } from "@/schemas/product-research-draft";
import type { ProductResearchDraftRepository } from "@/server/repositories/product-research-draft-repository";
import { createAdminProductKnowledgeMaintenanceService } from "@/server/services/admin-product-knowledge-maintenance-service";

const catalogProductId = "10000000-0000-4000-8000-000000000001";

describe("Admin Product Knowledge maintenance", () => {
  it("creates a new admin snapshot while preserving the Agent3 snapshot", async () => {
    const aiDraft = productResearchDraftFixture();
    const records: ProductResearchDraft[] = [aiDraft];
    const service = createAdminProductKnowledgeMaintenanceService(repository(records));

    const saved = await service.save(catalogProductId, edit({
      ingredients: { status: "partial", raw_text: ["Water, Glycerin"], item_names: ["Water", "Glycerin"] },
      claims: ["Helps hydrate"], product_type: "serum", texture: "lightweight gel",
      usage: { instructions: ["Apply after cleansing"], am_pm: ["pm"], frequency: "daily", routine_order: "after toner", leave_on: true, rinse_off: false, cautions: ["Avoid eye area"] },
    }));

    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(aiDraft);
    expect(saved).toMatchObject({ research_version: 2, created_by: "admin", research_model: null, research_run_id: null, status: "draft", overall_confidence: 72 });
    expect(saved.research_payload.ingredients.items).toEqual([
      expect.objectContaining({ raw_name: "Water", normalized_name: null, ingredient_order: null }),
      expect.objectContaining({ raw_name: "Glycerin", normalized_name: null, ingredient_order: null }),
    ]);
    expect(saved.research_payload.claims).toEqual([expect.objectContaining({ raw_text: "Helps hydrate", normalized_claim: null })]);
    expect(saved.research_payload.product_type.value).toBe("serum");
    expect(saved.research_payload.texture?.value).toBe("lightweight gel");
    expect(saved.research_payload.usage.cautions).toEqual(["Avoid eye area"]);
  });

  it("rejects invalid taxonomy and out-of-range overall confidence", async () => {
    const service = createAdminProductKnowledgeMaintenanceService(repository([productResearchDraftFixture()]));
    await expect(service.save(catalogProductId, edit({ product_type: "made_up_type" }))).rejects.toThrow();
    await expect(service.save(catalogProductId, edit({ overall_confidence: 101 }))).rejects.toThrow();
  });
});

function edit(overrides: Record<string, unknown> = {}) {
  return {
    overall_confidence: 72,
    ingredients: { status: "unknown", raw_text: [], item_names: [] },
    claims: [], product_type: null, texture: null,
    usage: { instructions: [], am_pm: [], frequency: null, routine_order: null, leave_on: null, rinse_off: null, cautions: [] },
    ...overrides,
  };
}

function repository(records: ProductResearchDraft[]): ProductResearchDraftRepository {
  return {
    async createDraft(input: ProductResearchDraftCreate) {
      const created = productResearchDraftFixture({ ...input, id: "30000000-0000-4000-8000-000000000002", status: "draft", reviewed_by: null, reviewed_at: null, created_at: "2026-08-28T00:00:01.000Z", updated_at: "2026-08-28T00:00:01.000Z" });
      records.push(created); return created;
    },
    async getLatestUsableDraft(id) { return records.filter((item) => item.catalog_product_id === id).sort((a, b) => b.research_version - a.research_version)[0] ?? null; },
    async getDraft() { return null; }, async getLatestDraft() { return null; }, async listDrafts() { return []; }, async listUsableDrafts() { return []; }, async listRecentDrafts() { return []; }, async updatePayload() { return null; }, async updateReviewStatus() { return null; },
  };
}
