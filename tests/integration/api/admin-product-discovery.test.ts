import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminProductDiscoveryService: vi.fn(),
}));

vi.mock("@/server/auth/require-admin", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/auth/require-admin")
  >();
  return { ...actual, requireAdmin: mocks.requireAdmin };
});

vi.mock("@/server/admin/product-discovery-composition", () => ({
  createAdminProductDiscoveryService:
    mocks.createAdminProductDiscoveryService,
}));

import { POST } from "@/app/api/v1/admin/knowledge/product-discovery/search/route";
import {
  AdminRequiredError,
  UnauthorizedError,
} from "@/server/auth/require-admin";
import { InvalidDiscoveryBarcodeError } from "@/server/domain/product-discovery";

const service = { search: vi.fn() };

describe("Admin Product Discovery Search API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({
      id: "admin-a",
      email: "admin@example.com",
      appRole: "admin",
    });
    mocks.createAdminProductDiscoveryService.mockResolvedValue(service);
  });

  it.each([
    [new UnauthorizedError(), 401, "UNAUTHORIZED"],
    [new AdminRequiredError(), 403, "ADMIN_REQUIRED"],
  ])(
    "rejects unauthorized callers before composing the service",
    async (error, expectedStatus, expectedCode) => {
      mocks.requireAdmin.mockRejectedValue(error);

      const response = await POST(request(validRequest()));

      expect(response.status).toBe(expectedStatus);
      expect((await response.json()).error.code).toBe(expectedCode);
      expect(
        mocks.createAdminProductDiscoveryService,
      ).not.toHaveBeenCalled();
      expect(service.search).not.toHaveBeenCalled();
    },
  );

  it("returns a no-store discovery result for an admin", async () => {
    const result = {
      result_version: "product-discovery-result/v0.1",
      status: "no_match",
      candidates: [],
      provider_results: [],
      warnings: [],
    };
    service.search.mockResolvedValue(result);
    const input = validRequest();

    const response = await POST(request(input));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ data: result });
    expect(service.search).toHaveBeenCalledWith(input);
  });

  it("maps invalid JSON and invalid barcode without leaking internals", async () => {
    const invalidJsonResponse = await POST(new Request(
      "http://localhost/api/v1/admin/knowledge/product-discovery/search",
      { method: "POST", body: "{" },
    ));
    expect(invalidJsonResponse.status).toBe(400);
    expect((await invalidJsonResponse.json()).error.code).toBe(
      "PRODUCT_DISCOVERY_INVALID_JSON",
    );

    service.search.mockRejectedValue(new InvalidDiscoveryBarcodeError());
    const invalidBarcodeResponse = await POST(request(validRequest()));
    expect(invalidBarcodeResponse.status).toBe(400);
    expect((await invalidBarcodeResponse.json()).error.code).toBe(
      "PRODUCT_DISCOVERY_BARCODE_INVALID",
    );
  });

  it("sanitizes unexpected service failures", async () => {
    service.search.mockRejectedValue(new Error("database-secret-sentinel"));

    const response = await POST(request(validRequest()));
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(body).toContain("PRODUCT_DISCOVERY_FAILED");
    expect(body).not.toContain("database-secret-sentinel");
  });
});

function request(input: unknown) {
  return new Request(
    "http://localhost/api/v1/admin/knowledge/product-discovery/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

function validRequest() {
  return {
    schema_version: "product-discovery/v0.1",
    mode: "barcode",
    barcode: "4006381333931",
  };
}

