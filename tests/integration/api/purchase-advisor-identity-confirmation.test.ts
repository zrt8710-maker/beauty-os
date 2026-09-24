import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createAdminClient: vi.fn(),
  verifyRecognitionConfirmationToken: vi.fn(),
  findOrCreate: vi.fn(),
  findVerifiedProduct: vi.fn(),
}));

vi.mock("@/server/auth/get-current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/server/product-recognition/recognition-confirmation-token", () => ({
  InvalidRecognitionConfirmationTokenError: class InvalidRecognitionConfirmationTokenError extends Error {},
  verifyRecognitionConfirmationToken: mocks.verifyRecognitionConfirmationToken,
}));
vi.mock("@/server/repositories/confirmed-catalog-candidate-repository", () => ({
  CatalogIdentityConfirmationRequiredError: class CatalogIdentityConfirmationRequiredError extends Error { readonly code = "CATALOG_IDENTITY_CONFIRMATION_REQUIRED"; },
  CatalogVariantConfirmationRequiredError: class CatalogVariantConfirmationRequiredError extends Error { readonly code = "CATALOG_VARIANT_CONFIRMATION_REQUIRED"; },
  createConfirmedCatalogCandidateRepository: () => ({ findOrCreate: mocks.findOrCreate }),
}));
vi.mock("@/server/repositories/knowledge-repository", () => ({
  createKnowledgeRepository: () => ({ findVerifiedProduct: mocks.findVerifiedProduct }),
}));
vi.mock("@/server/services/create-owned-product-with-identity-service", () => ({
  durableExternalVariantEvidence: () => null,
}));

import { POST } from "@/app/api/v1/product-identity/confirm/route";

const catalogProductId = "20000000-0000-4000-8000-000000000001";
const confirmationId = "40000000-0000-4000-8000-000000000001";
const body = {
  brand_name: "圣罗兰",
  product_name: "黑皮气垫",
  variant_name: null,
  barcode: null,
  product_type: "foundation",
  confirmation_token: "x".repeat(32),
  confirmation_id: confirmationId,
};

describe("Purchase Advisor external identity confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "user-a" });
    mocks.createAdminClient.mockReturnValue({});
    mocks.verifyRecognitionConfirmationToken.mockReturnValue({
      discovery_metadata: { confidence: 82, aliases: ["黑皮气垫"], sources: [], uncertainties: [] },
      reconciliation_context: { original_brand_name: "圣罗兰", original_product_name: "黑皮气垫" },
    });
    mocks.findOrCreate.mockResolvedValue({ catalogProductId, created: true });
    mocks.findVerifiedProduct.mockResolvedValue({ id: catalogProductId });
  });

  it("confirms and reconciles an external candidate without creating an owned asset", async () => {
    const response = await POST(jsonRequest(body));
    expect(response.status).toBe(200);
    expect(mocks.verifyRecognitionConfirmationToken).toHaveBeenCalledWith(body.confirmation_token, "user-a", expect.objectContaining({ product_name: "黑皮气垫" }), confirmationId);
    expect(mocks.findOrCreate).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({ data: { catalog_product_id: catalogProductId, analysis_ready: true } });
  });

  it("keeps a newly confirmed candidate honest when verified knowledge is unavailable", async () => {
    mocks.findVerifiedProduct.mockResolvedValue(null);
    const response = await POST(jsonRequest(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { catalog_product_id: catalogProductId, analysis_ready: false } });
  });

  it("requires authentication", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const response = await POST(jsonRequest(body));
    expect(response.status).toBe(401);
    expect(mocks.findOrCreate).not.toHaveBeenCalled();
  });
});

function jsonRequest(value: unknown) {
  return new Request("http://localhost/api/v1/product-identity/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}
