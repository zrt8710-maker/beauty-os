import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  getCurrentUser: vi.fn(),
  createKnowledgeRepository: vi.fn(),
  createOwnedProductIdentityRepository: vi.fn(),
  createProductIdentityMatcher: vi.fn(),
  createOwnedProductWithIdentityService: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/server/auth/get-current-user", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/server/repositories/knowledge-repository", () => ({
  createKnowledgeRepository: mocks.createKnowledgeRepository,
}));
vi.mock("@/server/repositories/owned-product-identity-repository", () => ({
  createOwnedProductIdentityRepository:
    mocks.createOwnedProductIdentityRepository,
}));
vi.mock("@/server/services/product-identity-matching-service", () => ({
  createProductIdentityMatcher: mocks.createProductIdentityMatcher,
}));
vi.mock("@/server/services/create-owned-product-with-identity-service", () => ({
  CatalogIdentityMismatchError: class CatalogIdentityMismatchError extends Error {
    readonly code = "CATALOG_IDENTITY_MISMATCH";
  },
  createOwnedProductWithIdentityService:
    mocks.createOwnedProductWithIdentityService,
}));

import { POST as createOwnedProduct } from "@/app/api/v1/owned-products/with-identity/route";
import { CatalogIdentityMismatchError } from "@/server/services/create-owned-product-with-identity-service";
import { InvalidRecognitionConfirmationTokenError } from "@/server/product-recognition/recognition-confirmation-token";
import { OwnedProductIdentityRepositoryError } from "@/server/owned-products/owned-product-create-debug";

const catalogId = "20000000-0000-4000-8000-000000000001";
const ownedProduct = {
  id: "30000000-0000-4000-8000-000000000001",
  product_id: "10000000-0000-4000-8000-000000000001",
};

describe("product identity APIs", () => {
  const matcher = { match: vi.fn() };
  const creationService = { create: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "user-a" });
    mocks.createAdminClient.mockReturnValue({});
    mocks.createClient.mockResolvedValue({});
    mocks.createKnowledgeRepository.mockReturnValue({});
    mocks.createOwnedProductIdentityRepository.mockReturnValue({});
    mocks.createProductIdentityMatcher.mockReturnValue(matcher);
    mocks.createOwnedProductWithIdentityService.mockReturnValue(creationService);
    creationService.create.mockResolvedValue(ownedProduct);
  });

  it("uses the atomic creation service for catalog-linked manual addition", async () => {
    const body = {
      resolution_kind: "catalog",
      brand_name: "CeraVe",
      product_name: "Daily SPF",
      variant_name: null,
      barcode: "12345678",
      category: "skincare",
      product_type: "serum",
      catalog_product_id: catalogId,
      status: "unopened",
      purchase_date: null,
      opened_at: null,
      expires_on: null,
      quantity_remaining_percent: 100,
      notes: null,
      idempotency_key: "40000000-0000-4000-8000-000000000001",
    };
    const response = await createOwnedProduct(
      jsonRequest("http://localhost/api/v1/owned-products/with-identity", body),
    );

    expect(response.status).toBe(201);
    expect(creationService.create).toHaveBeenCalledWith("user-a", {
      ...body,
      asset_category: "other",
      confirmation_token: null,
    });
    expect(await response.json()).toEqual({ data: ownedProduct });
  });

  it("allows creation of an explicitly unknown identity asset", async () => {
    const response = await createOwnedProduct(
      jsonRequest("http://localhost/api/v1/owned-products/with-identity", {
        resolution_kind: "unknown",
        brand_name: "Manual Brand",
        product_name: "Manual Serum",
        variant_name: null,
        barcode: null,
        category: "skincare",
        product_type: "serum",
        catalog_product_id: null,
        status: "unopened",
        purchase_date: null,
        opened_at: null,
        expires_on: null,
        quantity_remaining_percent: 100,
        notes: null,
        idempotency_key: "40000000-0000-4000-8000-000000000002",
      }),
    );

    expect(response.status).toBe(201);
    expect(creationService.create).toHaveBeenCalledWith(
      "user-a",
      expect.objectContaining({ resolution_kind: "unknown", catalog_product_id: null }),
    );
  });

  it("accepts a confirmed external asset when opened_at is omitted and normalizes it to null", async () => {
    const body = {
      resolution_kind: "external",
      brand_name: "圣罗兰",
      product_name: "黑皮气垫",
      variant_name: null,
      barcode: null,
      category: "makeup",
      product_type: "foundation",
      catalog_product_id: null,
      asset_category: "makeup",
      confirmation_token: "x".repeat(32),
      idempotency_key: "40000000-0000-4000-8000-000000000007",
      status: "unopened",
      purchase_date: null,
      manufacture_date: null,
      expires_on: null,
      quantity_remaining_percent: 100,
      notes: null,
      package_size: null,
    };

    const response = await createOwnedProduct(
      jsonRequest("http://localhost/api/v1/owned-products/with-identity", body),
    );

    expect(response.status).toBe(201);
    expect(creationService.create).toHaveBeenCalledWith("user-a", {
      ...body,
      opened_at: null,
    });
    expect(await response.json()).toEqual({ data: ownedProduct });
  });

  it("accepts a Catalog asset with omitted opened_at and an explicit expiry date", async () => {
    const body = {
      resolution_kind: "catalog",
      brand_name: "CeraVe",
      product_name: "Daily SPF",
      variant_name: null,
      barcode: null,
      category: "skincare",
      product_type: "sunscreen",
      catalog_product_id: catalogId,
      asset_category: "skincare",
      confirmation_token: null,
      idempotency_key: "40000000-0000-4000-8000-000000000008",
      status: "unopened",
      purchase_date: null,
      manufacture_date: null,
      expires_on: "2027-12-31",
      quantity_remaining_percent: 100,
      notes: null,
      package_size: null,
    };

    const response = await createOwnedProduct(
      jsonRequest("http://localhost/api/v1/owned-products/with-identity", body),
    );

    expect(response.status).toBe(201);
    expect(creationService.create).toHaveBeenCalledWith("user-a", {
      ...body,
      opened_at: null,
    });
  });

  it("returns conflict when the selected catalog identity fails revalidation", async () => {
    creationService.create.mockRejectedValueOnce(
      new CatalogIdentityMismatchError(),
    );

    const response = await createOwnedProduct(
      jsonRequest("http://localhost/api/v1/owned-products/with-identity", {
        resolution_kind: "catalog",
        brand_name: "CeraVe",
        product_name: "Daily SPF",
        variant_name: null,
        barcode: "12345678",
        category: "skincare",
        product_type: "sunscreen",
        catalog_product_id: catalogId,
        status: "unopened",
        purchase_date: null,
        opened_at: null,
        expires_on: null,
        quantity_remaining_percent: 100,
        notes: null,
        idempotency_key: "40000000-0000-4000-8000-000000000003",
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "CATALOG_IDENTITY_MISMATCH",
        message: "所选目录产品已失效或与输入不匹配。",
      },
    });
  });

  it("reports an invalid external confirmation as a recoverable conflict", async () => {
    creationService.create.mockRejectedValueOnce(new InvalidRecognitionConfirmationTokenError());

    const response = await createOwnedProduct(jsonRequest(
      "http://localhost/api/v1/owned-products/with-identity",
      {
        resolution_kind: "external",
        brand_name: "Example",
        product_name: "Serum",
        variant_name: null,
        barcode: null,
        category: "skincare",
        product_type: "serum",
        catalog_product_id: null,
        confirmation_token: "x".repeat(32),
        idempotency_key: "40000000-0000-4000-8000-000000000009",
        status: "active",
        purchase_date: null,
        expires_on: null,
        quantity_remaining_percent: 100,
        notes: null,
      },
    ));

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("IDENTITY_CONFIRMATION_INVALID");
  });

  it("exposes only a safe SQLSTATE when the asset RPC fails", async () => {
    creationService.create.mockRejectedValueOnce(new OwnedProductIdentityRepositoryError({
      code: "23514",
      message: "private database detail",
      details: "private row detail",
      hint: null,
    }));

    const response = await createOwnedProduct(jsonRequest(
      "http://localhost/api/v1/owned-products/with-identity",
      {
        resolution_kind: "unknown",
        brand_name: "Example",
        product_name: "Serum",
        variant_name: null,
        barcode: null,
        category: "skincare",
        product_type: "serum",
        catalog_product_id: null,
        idempotency_key: "40000000-0000-4000-8000-000000000010",
        status: "active",
        purchase_date: null,
        expires_on: null,
        quantity_remaining_percent: 100,
        notes: null,
      },
    ));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: "OWNED_PRODUCT_RPC_23514",
        message: "资产保存失败，请刷新页面确认后重试。",
      },
    });
  });

  it("rejects a client-supplied identity_status before creation", async () => {
    const response = await createOwnedProduct(
      jsonRequest("http://localhost/api/v1/owned-products/with-identity", {
        resolution_kind: "external",
        brand_name: "CeraVe",
        product_name: "Daily SPF",
        variant_name: null,
        barcode: "12345678",
        category: "skincare",
        product_type: "sunscreen",
        catalog_product_id: null,
        identity_status: "matched",
        status: "unopened",
        purchase_date: null,
        opened_at: null,
        expires_on: null,
        quantity_remaining_percent: 100,
        notes: null,
      }),
    );

    expect(response.status).toBe(400);
    expect(creationService.create).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated asset creation", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const createResponse = await createOwnedProduct(
      jsonRequest("http://localhost/api/v1/owned-products/with-identity", {}),
    );
    expect(createResponse.status).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
