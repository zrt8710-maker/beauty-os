import { describe, expect, it, vi } from "vitest";

import { productResearchDraftSchema, type ProductResearchDraft } from "@/schemas/product-research-draft";
import {
  importBulkRecords,
  validateBulkImportRecord,
} from "@/server/services/product-knowledge-bulk-importer";
import { productResearchDraftFixture } from "../../support/product-research-draft-fixture";

function record() {
  const draft = productResearchDraftFixture();
  return {
    catalog_product_id: draft.catalog_product_id,
    research_payload: draft.research_payload,
    overall_confidence: draft.overall_confidence,
    created_by: draft.created_by,
    research_model: draft.research_model,
    research_run_id: draft.research_run_id,
    catalog_image: {
      catalog_image_url: "https://example.com/product.jpg",
      catalog_image_source_url: "https://example.com/product",
    },
  };
}

function bootstrapRecord() {
  const value = record();
  return {
    ...value,
    catalog_product_id: null,
    catalog_identity: {
      brand_name: value.research_payload.identity.brand_name,
      product_name: value.research_payload.identity.product_name,
      variant_name: value.research_payload.identity.variant_name,
    },
    research_payload: {
      ...value.research_payload,
      product_type: {
        ...value.research_payload.product_type,
        value: "serum" as const,
        confidence: 90,
        basis: "external_evidence" as const,
        evidence_refs: ["source_1"],
      },
    },
  };
}

function catalogGateway(matches: Array<{ id: string }> = []) {
  return { findExact: vi.fn().mockResolvedValue(matches), createBootstrap: vi.fn().mockResolvedValue({ id: "40000000-0000-4000-8000-000000000001" }) };
}

describe("Product Knowledge bulk importer", () => {
  it("uses the next version, reads it back, supersedes only the previous usable draft, and updates catalog image separately", async () => {
    const previous = productResearchDraftFixture({ id: "30000000-0000-4000-8000-000000000010", research_version: 2, status: "approved" });
    let created: ProductResearchDraft | null = null;
    const drafts = {
      getLatestUsableDraft: vi.fn().mockResolvedValue(previous),
      listDrafts: vi.fn().mockResolvedValue([previous, productResearchDraftFixture({ research_version: 1, status: "superseded" })]),
      createDraft: vi.fn(async (input) => {
        created = productResearchDraftSchema.parse({ ...input as object, id: "30000000-0000-4000-8000-000000000011", status: "draft", reviewed_by: null, reviewed_at: null, created_at: "2026-09-08T00:00:00.000Z", updated_at: "2026-09-08T00:00:00.000Z" });
        return created;
      }),
      getDraft: vi.fn(async (id: string) => id === previous.id ? { ...previous, status: "superseded" as const } : created),
      updateReviewStatus: vi.fn(async () => ({ ...previous, status: "superseded" as const })),
    };
    const images = { update: vi.fn().mockResolvedValue(undefined) };
    const catalog = catalogGateway();

    const report = await importBulkRecords([{ line: 1, value: record() }], { drafts, images, catalog });

    expect(report.success_count).toBe(1);
    expect(drafts.createDraft).toHaveBeenCalledWith(expect.objectContaining({ research_version: 3 }));
    expect(drafts.updateReviewStatus).toHaveBeenCalledWith(previous.id, { status: "superseded", reviewed_by: null, reviewed_at: null });
    expect(images.update).toHaveBeenCalledWith(previous.catalog_product_id, record().catalog_image);
  });

  it("isolates invalid records without calling database gateways", async () => {
    const drafts = { createDraft: vi.fn(), getDraft: vi.fn(), getLatestUsableDraft: vi.fn(), listDrafts: vi.fn(), updateReviewStatus: vi.fn() };
    const images = { update: vi.fn() };
    const catalog = catalogGateway();
    const report = await importBulkRecords([{ line: 1, value: { catalog_product_id: "not-a-uuid" } }], { drafts, images, catalog });

    expect(report).toMatchObject({ success_count: 0, failed_count: 1 });
    expect(drafts.createDraft).not.toHaveBeenCalled();
  });

  it("requires evidence refs to point to sources and accepts the importer record envelope", () => {
    expect(validateBulkImportRecord(record()).success).toBe(true);
    const invalid = record();
    invalid.research_payload.identity.evidence_refs = ["missing_source"];
    expect(validateBulkImportRecord(invalid).success).toBe(false);
  });

  it("imports a record whose referenced package-label source has no URL", async () => {
    const value = record();
    value.research_payload.sources[0].url = null;
    const created = productResearchDraftFixture({ id: "30000000-0000-4000-8000-000000000015", research_version: 1 });
    const drafts = {
      getLatestUsableDraft: vi.fn().mockResolvedValue(null), listDrafts: vi.fn().mockResolvedValue([]),
      createDraft: vi.fn().mockResolvedValue(created), getDraft: vi.fn().mockResolvedValue(created), updateReviewStatus: vi.fn(),
    };
    const report = await importBulkRecords([{ line: 1, value }], { drafts, images: { update: vi.fn() }, catalog: catalogGateway() });

    expect(report).toMatchObject({ success_count: 1, failed_count: 0 });
    expect(drafts.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      research_payload: expect.objectContaining({ sources: [expect.objectContaining({ url: null })] }),
    }));
  });

  it("reuses one exact catalog identity match", async () => {
    const value = bootstrapRecord();
    const created = productResearchDraftFixture({ id: "30000000-0000-4000-8000-000000000012", catalog_product_id: "40000000-0000-4000-8000-000000000002", research_version: 1 });
    const drafts = {
      getLatestUsableDraft: vi.fn().mockResolvedValue(null), listDrafts: vi.fn().mockResolvedValue([]),
      createDraft: vi.fn().mockResolvedValue(created), getDraft: vi.fn().mockResolvedValue(created), updateReviewStatus: vi.fn(),
    };
    const catalog = catalogGateway([{ id: created.catalog_product_id }]);
    const report = await importBulkRecords([{ line: 1, value }], { drafts, images: { update: vi.fn() }, catalog });

    expect(report.results[0]).toMatchObject({ status: "success", catalog_product_id: created.catalog_product_id, catalog_product_created: false });
    expect(catalog.createBootstrap).not.toHaveBeenCalled();
    expect(drafts.createDraft).toHaveBeenCalledWith(expect.objectContaining({ catalog_product_id: created.catalog_product_id }));
  });

  it("creates a candidate catalog product before creating the draft when no exact match exists", async () => {
    const value = bootstrapRecord();
    const newCatalogId = "40000000-0000-4000-8000-000000000001";
    const created = productResearchDraftFixture({ id: "30000000-0000-4000-8000-000000000013", catalog_product_id: newCatalogId, research_version: 1 });
    const drafts = {
      getLatestUsableDraft: vi.fn().mockResolvedValue(null), listDrafts: vi.fn().mockResolvedValue([]),
      createDraft: vi.fn().mockResolvedValue(created), getDraft: vi.fn().mockResolvedValue(created), updateReviewStatus: vi.fn(),
    };
    const catalog = catalogGateway();
    const report = await importBulkRecords([{ line: 1, value }], { drafts, images: { update: vi.fn() }, catalog });

    expect(catalog.createBootstrap).toHaveBeenCalledWith(expect.objectContaining({ identity: value.catalog_identity, product_type: value.research_payload.product_type.value }));
    expect(report.results[0]).toMatchObject({ status: "success", catalog_product_id: newCatalogId, catalog_product_created: true });
  });

  it("fails only ambiguous bootstrap rows and never creates user-owned products", async () => {
    const valid = record();
    const ambiguous = bootstrapRecord();
    const created = productResearchDraftFixture({ id: "30000000-0000-4000-8000-000000000014", research_version: 1 });
    const drafts = {
      getLatestUsableDraft: vi.fn().mockResolvedValue(null), listDrafts: vi.fn().mockResolvedValue([]),
      createDraft: vi.fn().mockResolvedValue(created), getDraft: vi.fn().mockResolvedValue(created), updateReviewStatus: vi.fn(),
    };
    const catalog = { findExact: vi.fn().mockResolvedValueOnce([{ id: "a" }, { id: "b" }]).mockResolvedValueOnce([]), createBootstrap: vi.fn().mockResolvedValue({ id: valid.catalog_product_id }) };
    const userOwnedProducts = { create: vi.fn() };
    const dependencies = { drafts, images: { update: vi.fn() }, catalog, userOwnedProducts };
    const report = await importBulkRecords([{ line: 1, value: ambiguous }, { line: 2, value: valid }], dependencies);

    expect(report).toMatchObject({ success_count: 1, failed_count: 1 });
    expect(report.results[0]).toMatchObject({ reason: "ambiguous_catalog_identity" });
    expect(drafts.createDraft).toHaveBeenCalledTimes(1);
    expect(userOwnedProducts.create).not.toHaveBeenCalled();
  });
});
