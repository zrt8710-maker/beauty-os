import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminCatalogSeedDryRunChecker: vi.fn(),
  createAdminCatalogSeedService: vi.fn(),
}));

vi.mock("@/server/auth/require-admin", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/auth/require-admin")
  >();
  return { ...actual, requireAdmin: mocks.requireAdmin };
});

vi.mock("@/server/admin/catalog-seed-composition", () => ({
  createAdminCatalogSeedDryRunChecker:
    mocks.createAdminCatalogSeedDryRunChecker,
  createAdminCatalogSeedService: mocks.createAdminCatalogSeedService,
}));

import { POST as applyCatalogSeed } from "@/app/api/v1/admin/knowledge/catalog-seed/apply/route";
import { POST as dryRunCatalogSeed } from "@/app/api/v1/admin/knowledge/catalog-seed/dry-run/route";
import {
  AdminRequiredError,
  UnauthorizedError,
} from "@/server/auth/require-admin";
import { SupabaseAdminConfigurationError } from "@/server/config/supabase-admin-env";
import {
  CatalogSeedServiceConflictError,
  CatalogSeedServiceValidationError,
  createCatalogSeedService,
} from "@/server/services/catalog-seed-service";

const dryRun = { run: vi.fn() };
const service = { apply: vi.fn() };

describe("Knowledge Admin Catalog Seed APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({
      id: "admin-a",
      email: "admin@example.com",
      appRole: "admin",
    });
    mocks.createAdminCatalogSeedDryRunChecker.mockReturnValue(dryRun);
    mocks.createAdminCatalogSeedService.mockReturnValue(service);
  });

  describe("dry-run", () => {
    it("returns 401 and creates no privileged dependency when unauthenticated", async () => {
      mocks.requireAdmin.mockRejectedValue(new UnauthorizedError());

      const response = await dryRunCatalogSeed(request(validInput()));

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: { code: "UNAUTHORIZED", message: "请先登录。" },
      });
      expect(
        mocks.createAdminCatalogSeedDryRunChecker,
      ).not.toHaveBeenCalled();
      expect(dryRun.run).not.toHaveBeenCalled();
    });

    it("returns 403 and creates no privileged dependency for a normal user", async () => {
      mocks.requireAdmin.mockRejectedValue(new AdminRequiredError());

      const response = await dryRunCatalogSeed(request(validInput()));

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: { code: "ADMIN_REQUIRED", message: "需要管理员权限。" },
      });
      expect(
        mocks.createAdminCatalogSeedDryRunChecker,
      ).not.toHaveBeenCalled();
      expect(dryRun.run).not.toHaveBeenCalled();
    });

    it("returns the preview for an admin without constructing apply service", async () => {
      const preview = {
        report_version: "catalog-seed-dry-run/v0.1",
        status: "new",
        new_products: [{ catalog_product_id: catalogProductId }],
        existing_products: [],
        conflicts: [],
        warnings: [],
        errors: [],
      };
      dryRun.run.mockResolvedValue(preview);
      const input = validInput();

      const response = await dryRunCatalogSeed(request(input));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ data: preview });
      expect(mocks.requireAdmin).toHaveBeenCalledOnce();
      expect(dryRun.run).toHaveBeenCalledWith(input);
      expect(mocks.createAdminCatalogSeedService).not.toHaveBeenCalled();
      expect(service.apply).not.toHaveBeenCalled();
    });

    it("returns invalid preview as data so the admin can review it", async () => {
      const preview = {
        report_version: "catalog-seed-dry-run/v0.1",
        status: "invalid",
        new_products: [],
        existing_products: [],
        conflicts: [],
        warnings: [],
        errors: [{ code: "CATALOG_SEED_SCHEMA_INVALID" }],
      };
      dryRun.run.mockResolvedValue(preview);

      const response = await dryRunCatalogSeed(request({ invalid: true }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ data: preview });
    });
  });

  describe("apply", () => {
    it.each([
      [new UnauthorizedError(), 401, "UNAUTHORIZED"],
      [new AdminRequiredError(), 403, "ADMIN_REQUIRED"],
    ])(
      "rejects unauthorized callers before creating service",
      async (error, expectedStatus, expectedCode) => {
        mocks.requireAdmin.mockRejectedValue(error);

        const response = await applyCatalogSeed(request(validInput()));

        expect(response.status).toBe(expectedStatus);
        expect((await response.json()).error.code).toBe(expectedCode);
        expect(mocks.createAdminCatalogSeedService).not.toHaveBeenCalled();
        expect(service.apply).not.toHaveBeenCalled();
      },
    );

    it("calls CatalogSeedService for an admin and returns receipt/readback", async () => {
      const result = serviceResult("created");
      service.apply.mockResolvedValue(result);
      const input = validInput();

      const response = await applyCatalogSeed(request(input));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        data: {
          receipt: result.receipt,
          product: result.readback,
          warnings: result.warnings,
        },
      });
      expect(mocks.createAdminCatalogSeedService).toHaveBeenCalledOnce();
      expect(service.apply).toHaveBeenCalledOnce();
      expect(service.apply).toHaveBeenCalledWith(input);
    });

    it("returns an idempotent existing result", async () => {
      const result = serviceResult("existing");
      service.apply.mockResolvedValue(result);

      const response = await applyCatalogSeed(request(validInput()));

      expect(response.status).toBe(200);
      expect((await response.json()).data.receipt).toMatchObject({
        outcome: "existing",
        source_created: false,
        catalog_product_created: false,
      });
    });

    it("revalidates and preflights a new product before one atomic write", async () => {
      const boundary = actualServiceBoundary("new");
      mocks.createAdminCatalogSeedService.mockReturnValue(boundary.service);
      const input = validInput();

      const response = await applyCatalogSeed(request(input));

      expect(response.status).toBe(200);
      expect(boundary.dryRun).toHaveBeenCalledOnce();
      expect(boundary.dryRun).toHaveBeenCalledWith(input);
      expect(boundary.write).toHaveBeenCalledOnce();
      expect(boundary.write).toHaveBeenCalledWith(input);
      expect(boundary.readback).toHaveBeenCalledOnce();
    });

    it("does not write when the server-side preflight finds a conflict", async () => {
      const boundary = actualServiceBoundary("conflict");
      mocks.createAdminCatalogSeedService.mockReturnValue(boundary.service);

      const response = await applyCatalogSeed(request(validInput()));

      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe(
        "CATALOG_SEED_CONFLICT",
      );
      expect(boundary.dryRun).toHaveBeenCalledOnce();
      expect(boundary.write).not.toHaveBeenCalled();
      expect(boundary.readback).not.toHaveBeenCalled();
    });

    it("does not preflight or write schema-invalid apply input", async () => {
      const boundary = actualServiceBoundary("new");
      mocks.createAdminCatalogSeedService.mockReturnValue(boundary.service);

      const response = await applyCatalogSeed(request({
        ...validInput(),
        catalog_product_id: "not-a-uuid",
      }));

      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe(
        "CATALOG_SEED_INVALID",
      );
      expect(boundary.dryRun).not.toHaveBeenCalled();
      expect(boundary.write).not.toHaveBeenCalled();
      expect(boundary.readback).not.toHaveBeenCalled();
    });

    it("returns existing idempotently after a fresh preflight without writing", async () => {
      const boundary = actualServiceBoundary("existing");
      mocks.createAdminCatalogSeedService.mockReturnValue(boundary.service);

      const response = await applyCatalogSeed(request(validInput()));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.receipt.outcome).toBe("existing");
      expect(boundary.dryRun).toHaveBeenCalledOnce();
      expect(boundary.write).not.toHaveBeenCalled();
      expect(boundary.readback).toHaveBeenCalledOnce();
    });

    it("maps invalid JSON and validation failures to CATALOG_SEED_INVALID", async () => {
      const invalidJsonResponse = await applyCatalogSeed(new Request(
        "http://localhost/api/v1/admin/knowledge/catalog-seed/apply",
        { method: "POST", body: "{" },
      ));

      expect(invalidJsonResponse.status).toBe(400);
      expect((await invalidJsonResponse.json()).error.code).toBe(
        "CATALOG_SEED_INVALID",
      );
      expect(mocks.createAdminCatalogSeedService).toHaveBeenCalledOnce();
      expect(service.apply).not.toHaveBeenCalled();

      service.apply.mockRejectedValue(
        new CatalogSeedServiceValidationError([], []),
      );
      const validationResponse = await applyCatalogSeed(request(validInput()));

      expect(validationResponse.status).toBe(400);
      expect((await validationResponse.json()).error.code).toBe(
        "CATALOG_SEED_INVALID",
      );
    });

    it("maps preflight conflict without exposing internal errors", async () => {
      service.apply.mockRejectedValue(
        new CatalogSeedServiceConflictError([], []),
      );

      const response = await applyCatalogSeed(request(validInput()));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: "CATALOG_SEED_CONFLICT",
          details: { conflicts: [], warnings: [] },
        },
      });
    });

    it("returns a safe configuration error without leaking key names or values", async () => {
      mocks.createAdminCatalogSeedService.mockImplementation(() => {
        throw new SupabaseAdminConfigurationError([
          "SUPABASE_SERVICE_ROLE_KEY",
        ]);
      });

      const response = await applyCatalogSeed(request(validInput()));
      const body = JSON.stringify(await response.json());

      expect(response.status).toBe(500);
      expect(body).toContain("SUPABASE_ADMIN_CONFIGURATION_ERROR");
      expect(body).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(body).not.toContain("service-role-sentinel");
    });

    it("sanitizes a PostgreSQL write failure", async () => {
      service.apply.mockRejectedValue(new Error(
        "CATALOG_SEED_WRITE_FAILED",
        {
          cause: {
            message: "postgres-internal-sentinel",
            serviceRole: "service-role-sentinel",
          },
        },
      ));

      const response = await applyCatalogSeed(request(validInput()));
      const body = JSON.stringify(await response.json());

      expect(response.status).toBe(500);
      expect(body).toContain("CATALOG_SEED_WRITE_FAILED");
      expect(body).not.toContain("postgres-internal-sentinel");
      expect(body).not.toContain("service-role-sentinel");
    });
  });
});

const catalogProductId = "10000000-0000-4000-8000-000000000001";
const sourceId = "20000000-0000-4000-8000-000000000001";

function request(input: unknown) {
  return new Request(
    "http://localhost/api/v1/admin/knowledge/catalog-seed",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

function validInput() {
  return {
    schema_version: "catalog-seed/v0.1",
    catalog_product_id: catalogProductId,
    source: {
      source_id: sourceId,
      source_type: "official_brand",
      name: "Beauty OS Official",
      source_url: "https://example.com/catalog-serum",
      license_note: null,
      retrieved_at: "2026-08-24T00:00:00.000Z",
    },
    identity: {
      brand_name: "Beauty OS",
      product_name: "Catalog Serum",
      variant_name: null,
      barcode: "12345678",
      category: "skincare",
      subcategory: "face_care",
      product_type: "serum",
      confidence: 98,
      status: "verified",
    },
  };
}

function serviceResult(outcome: "created" | "existing") {
  const input = validInput();
  return {
    receipt: {
      outcome,
      catalog_product_id: catalogProductId,
      source_id: sourceId,
      source_created: outcome === "created",
      catalog_product_created: outcome === "created",
      status: "verified",
    },
    readback: {
      catalog_product_id: catalogProductId,
      brand_name: input.identity.brand_name,
      product_name: input.identity.product_name,
      variant_name: null,
      barcode: input.identity.barcode,
      category: input.identity.category,
      subcategory: input.identity.subcategory,
      product_type: input.identity.product_type,
      source: input.source,
      confidence: input.identity.confidence,
      status: "verified",
    },
    warnings: [],
  };
}

function actualServiceBoundary(
  status: "new" | "existing" | "conflict",
) {
  const input = validInput();
  const conflict = {
    code: "CATALOG_SEED_IDENTITY_CONFLICT",
    message: "Catalog identity conflict.",
    catalog_product_id: catalogProductId,
    conflicting_catalog_product_id:
      "10000000-0000-4000-8000-000000000002",
    path: ["identity"],
  };
  const dryRun = vi.fn().mockResolvedValue({
    report_version: "catalog-seed-dry-run/v0.1",
    status,
    new_products: status === "new" ? [{}] : [],
    existing_products: status === "existing" ? [{}] : [],
    conflicts: status === "conflict" ? [conflict] : [],
    warnings: [],
    errors: [],
  });
  const write = vi.fn().mockResolvedValue(serviceResult("created").receipt);
  const readback = vi.fn().mockResolvedValue({
    id: catalogProductId,
    brand_name: input.identity.brand_name,
    product_name: input.identity.product_name,
    variant_name: input.identity.variant_name,
    barcode: input.identity.barcode,
    category: input.identity.category,
    subcategory: input.identity.subcategory,
    product_type: input.identity.product_type,
    primary_source_id: sourceId,
    confidence: input.identity.confidence,
    status: "verified",
    created_at: "2026-08-24T00:00:00.000Z",
    updated_at: "2026-08-24T00:00:00.000Z",
    source: {
      id: sourceId,
      source_type: input.source.source_type,
      name: input.source.name,
      source_url: input.source.source_url,
      license_note: input.source.license_note,
      retrieved_at: input.source.retrieved_at,
      created_at: "2026-08-24T00:00:00.000Z",
    },
  });

  return {
    dryRun,
    write,
    readback,
    service: createCatalogSeedService(
      { run: dryRun },
      { applyAtomically: write },
      { findVerifiedProduct: readback },
    ),
  };
}
