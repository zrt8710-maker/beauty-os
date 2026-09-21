import { describe, expect, it, vi } from "vitest";

import type { KnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { createInternalCatalogProvider } from "@/server/integrations/product-discovery/internal-catalog-provider";

describe("InternalCatalogProvider", () => {
  it("uses exact verified barcode lookup", async () => {
    const repository = repositoryStub();
    vi.mocked(repository.findVerifiedByBarcode).mockResolvedValue(catalog());
    const provider = createInternalCatalogProvider(repository);

    const result = await provider.search({
      schema_version: "product-discovery/v0.1",
      mode: "barcode",
      barcode: "4006381333931",
      locale: "zh-CN",
      market: "CN",
      limit: 10,
    });

    expect(result.status).toBe("ok");
    expect(result.candidates[0]).toMatchObject({
      candidate_kind: "internal_verified",
      existing_catalog_product_id: catalog().id,
      barcode: "4006381333931",
    });
    expect(repository.findVerifiedByBarcode).toHaveBeenCalledWith(
      "4006381333931",
    );
    expect(repository.listVerifiedProducts).not.toHaveBeenCalled();
  });

  it("searches verified products by product name with bounded over-fetch", async () => {
    const repository = repositoryStub();
    vi.mocked(repository.listVerifiedProducts).mockResolvedValue([catalog()]);
    const provider = createInternalCatalogProvider(repository);

    const result = await provider.search({
      schema_version: "product-discovery/v0.1",
      mode: "name",
      brand_name: "Beauty OS",
      product_name: "Daily Serum",
      locale: "zh-CN",
      market: "CN",
      limit: 10,
    });

    expect(result.status).toBe("ok");
    expect(repository.listVerifiedProducts).toHaveBeenCalledWith({
      search: "Daily Serum",
      limit: 30,
    });
  });

  it("returns not_found without manufacturing candidates", async () => {
    const repository = repositoryStub();
    vi.mocked(repository.findVerifiedByBarcode).mockResolvedValue(null);

    const result = await createInternalCatalogProvider(repository).search({
      schema_version: "product-discovery/v0.1",
      mode: "barcode",
      barcode: "4006381333931",
      locale: "zh-CN",
      market: "CN",
      limit: 10,
    });

    expect(result).toMatchObject({
      provider_code: "internal_catalog",
      status: "not_found",
      candidates: [],
    });
  });
});

function repositoryStub(): KnowledgeRepository {
  return {
    listVerifiedProducts: vi.fn(),
    findVerifiedProduct: vi.fn(),
    listVerifiedProductIngredients: vi.fn(),
    findVerifiedByBarcode: vi.fn(),
    findVerifiedByIdentity: vi.fn(),
  };
}

function catalog() {
  const createdAt = "2026-08-24T00:00:00.000Z";
  const source = {
    id: "20000000-0000-4000-8000-000000000001",
    source_type: "official_brand",
    name: "Beauty OS",
    source_url: "https://example.com/daily-serum",
    license_note: null,
    retrieved_at: createdAt,
    created_at: createdAt,
  } as const;
  return {
    id: "10000000-0000-4000-8000-000000000001",
    brand_name: "Beauty OS",
    product_name: "Daily Serum",
    variant_name: "30 ml",
    barcode: "4006381333931",
    catalog_image_url: null,
    catalog_image_source_url: null,
    category: "skincare",
    subcategory: "face_care",
    product_type: "serum",
    primary_source_id: source.id,
    confidence: 98,
    status: "verified",
    created_at: createdAt,
    updated_at: createdAt,
    source,
  };
}
