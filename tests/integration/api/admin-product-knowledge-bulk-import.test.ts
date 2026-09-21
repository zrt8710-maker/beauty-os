import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createDependencies: vi.fn(),
  importBulkRecords: vi.fn(),
}));

vi.mock("@/server/auth/require-admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/require-admin")>()),
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/server/admin/product-knowledge-bulk-import-composition", () => ({
  createAdminProductKnowledgeBulkImportDependencies: mocks.createDependencies,
}));
vi.mock("@/server/services/product-knowledge-bulk-importer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/product-knowledge-bulk-importer")>()),
  importBulkRecords: mocks.importBulkRecords,
}));

import { POST as importJsonl } from "@/app/api/v1/admin/knowledge/bulk-import/import/route";
import { POST as validateJsonl } from "@/app/api/v1/admin/knowledge/bulk-import/validate/route";
import { AdminRequiredError } from "@/server/auth/require-admin";
import { productResearchDraftFixture } from "../../support/product-research-draft-fixture";

function record(productName = "Example Serum") {
  const draft = productResearchDraftFixture();
  return {
    catalog_product_id: draft.catalog_product_id,
    overall_confidence: draft.overall_confidence,
    created_by: draft.created_by,
    research_model: draft.research_model,
    research_run_id: draft.research_run_id,
    research_payload: { ...draft.research_payload, identity: { ...draft.research_payload.identity, product_name: productName } },
  };
}

function request(jsonl: string) {
  return new Request("http://localhost/api/v1/admin/knowledge/bulk-import", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonl }),
  });
}

describe("Admin Product Knowledge Bulk Import APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: "admin", appRole: "admin" });
  });

  it("rejects a non-admin before parsing or creating import dependencies", async () => {
    mocks.requireAdmin.mockRejectedValue(new AdminRequiredError());

    const response = await validateJsonl(request(JSON.stringify(record())));

    expect(response.status).toBe(403);
    expect(mocks.createDependencies).not.toHaveBeenCalled();
    expect(mocks.importBulkRecords).not.toHaveBeenCalled();
  });

  it("validates valid JSONL and reports invalid lines with human-readable reasons", async () => {
    const response = await validateJsonl(request(`${JSON.stringify(record())}\n{`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ total: 2, valid: 1, invalid: 1 });
    expect(body.data.results[1]).toMatchObject({ line: 2, status: "invalid", reason: "无效 JSONL 记录。" });
  });

  it("reuses the Bulk Importer and returns a mixed batch report without user-owned-product creation", async () => {
    const first = record("First Serum");
    const second = record("Second Serum");
    const dependencies = { drafts: {}, images: {}, catalog: {} };
    const userOwnedProducts = { create: vi.fn() };
    mocks.createDependencies.mockReturnValue({ ...dependencies, userOwnedProducts });
    mocks.importBulkRecords.mockResolvedValue({
      success_count: 1,
      failed_count: 1,
      results: [
        { line: 1, catalog_product_id: first.catalog_product_id, status: "success", research_version: 3, catalog_product_created: false, image_updated: true },
        { line: 2, catalog_product_id: null, status: "failed", reason: "ambiguous_catalog_identity" },
      ],
    });

    const response = await importJsonl(request(`${JSON.stringify(first)}\n${JSON.stringify(second)}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.importBulkRecords).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining(dependencies));
    expect(body.data).toMatchObject({ success_count: 1, failed_count: 1 });
    expect(body.data.results[0]).toMatchObject({ product_name: "First Serum", research_version: 3, image_updated: true });
    expect(body.data.results[1]).toMatchObject({ product_name: "Second Serum", reason: "catalog identity 存在多个匹配。" });
    expect(userOwnedProducts.create).not.toHaveBeenCalled();
  });
});
