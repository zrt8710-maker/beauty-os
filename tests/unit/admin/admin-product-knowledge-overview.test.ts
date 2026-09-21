import { describe, expect, it, vi } from "vitest";

import type { CatalogIdentityProduct, CatalogIdentityRepository } from "@/server/repositories/catalog-identity-repository";
import type { ProductResearchDraftRepository } from "@/server/repositories/product-research-draft-repository";
import type { KnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { createAdminProductKnowledgeOverviewService, selectLatestUsableSnapshots } from "@/server/services/admin-product-knowledge-overview-service";
import { productResearchDraftFixture } from "../../support/product-research-draft-fixture";

const product: CatalogIdentityProduct = {
  id: "10000000-0000-4000-8000-000000000001",
  brand_name: "HFP",
  product_name: "果酸毛孔净透精华水",
  variant_name: null,
  barcode: null,
  category: null,
  subcategory: null,
  product_type: null,
  confidence: 92,
  status: "candidate",
  created_at: "2026-08-28T00:00:00.000Z",
  updated_at: "2026-08-28T00:00:00.000Z",
};

describe("AdminProductKnowledgeOverviewService", () => {
  it("shows a confirmed candidate before Agent3 creates a snapshot", async () => {
    const service = setup([]);
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({ identity_status: "confirmed", knowledge_status: "not_researched", overall_confidence: null, latest_snapshot: null }),
    ]);
  });

  it.each(["draft", "review_pending", "approved"] as const)("exposes available sections from a partial %s snapshot without calling it complete", async (status) => {
    const snapshot = productResearchDraftFixture({ status, overall_confidence: 30 });
    const service = setup([snapshot]);
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({ knowledge_status: "research_partial", overall_confidence: 30, latest_snapshot: snapshot }),
    ]);
  });

  it.each(["rejected", "superseded"] as const)("falls back past a newer %s snapshot", (status) => {
    const older = productResearchDraftFixture({ research_version: 1, status: "approved", overall_confidence: 30 });
    const newer = productResearchDraftFixture({ id: "30000000-0000-4000-8000-000000000002", research_version: 2, status });
    expect(selectLatestUsableSnapshots([newer, older]).get(product.id)).toEqual(older);
  });

  it("keeps the overview and draft when one formal ingredient read fails", async () => {
    const snapshot = productResearchDraftFixture({ status: "approved" });
    const error = new Error("KNOWLEDGE_INGREDIENT_READ_FAILED", {
      cause: { code: "PGRST200", message: "relation unavailable", details: "schema cache", hint: "reload schema" },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const service = setup([snapshot], async () => { throw error; });

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({
        latest_snapshot: snapshot,
        formalIngredientReadError: {
          code: "PGRST200",
          message: "relation unavailable",
          details: "schema cache",
          hint: "reload schema",
        },
      }),
    ]);
    expect(consoleError).toHaveBeenCalledWith("ADMIN_FORMAL_INGREDIENT_READ_FAILED", {
      catalog_product_id: product.id,
      code: "PGRST200",
      message: "relation unavailable",
      details: "schema cache",
      hint: "reload schema",
    });
    consoleError.mockRestore();
  });
});

function setup(
  snapshots: ReturnType<typeof productResearchDraftFixture>[],
  ingredientRead: () => ReturnType<KnowledgeRepository["listVerifiedProductIngredients"]> = async () => [],
) {
  const identities: CatalogIdentityRepository = {
    findById: vi.fn(async () => product),
    findByBarcode: vi.fn(),
    findByIdentity: vi.fn(),
    listIdentityProducts: vi.fn(async () => [product]),
  };
  const drafts: ProductResearchDraftRepository = {
    createDraft: vi.fn(), getDraft: vi.fn(), getLatestDraft: vi.fn(), listDrafts: vi.fn(), listRecentDrafts: vi.fn(), updatePayload: vi.fn(), updateReviewStatus: vi.fn(),
    getLatestUsableDraft: vi.fn(async () => snapshots.find((item) => ["draft", "review_pending", "approved"].includes(item.status)) ?? null),
    listUsableDrafts: vi.fn(async () => snapshots.filter((item) => ["draft", "review_pending", "approved"].includes(item.status))),
  };
  const ingredients: Pick<KnowledgeRepository, "listVerifiedProductIngredients"> = {
    listVerifiedProductIngredients: vi.fn(ingredientRead),
  };
  return createAdminProductKnowledgeOverviewService({ identities, drafts, ingredients });
}
