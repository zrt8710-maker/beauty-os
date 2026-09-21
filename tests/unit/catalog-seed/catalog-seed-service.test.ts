import { describe, expect, it, vi } from "vitest";

import type {
  CatalogSeedDryRunIssue,
  CatalogSeedDryRunReport,
  CatalogSeedInput,
  CatalogSeedWriteReceipt,
} from "@/schemas/catalog-seed";
import type { CatalogSeedDryRunChecker } from "@/server/catalog-seed/catalog-seed-dry-run";
import type { CatalogProductWithSourceRow } from "@/server/repositories/knowledge-repository";
import type { CatalogSeedWriteRepository } from "@/server/repositories/catalog-seed-write-repository";
import {
  CatalogSeedReadbackError,
  CatalogSeedServiceConflictError,
  CatalogSeedServiceValidationError,
  createCatalogSeedService,
} from "@/server/services/catalog-seed-service";

const catalogProductId = "10000000-0000-4000-8000-000000000001";
const sourceId = "20000000-0000-4000-8000-000000000001";
const timestamp = "2026-08-24T00:00:00.000Z";

const createdReceipt: CatalogSeedWriteReceipt = {
  outcome: "created",
  catalog_product_id: catalogProductId,
  source_id: sourceId,
  source_created: true,
  catalog_product_created: true,
  status: "verified",
};

describe("CatalogSeedService", () => {
  it("rejects schema-invalid input before dry-run, write, or readback", async () => {
    const setup = serviceSetup("new");

    await expect(setup.service.apply({
      ...validInput(),
      catalog_product_id: "not-a-uuid",
    })).rejects.toBeInstanceOf(CatalogSeedServiceValidationError);

    expect(setup.dryRun.run).not.toHaveBeenCalled();
    expect(setup.writeRepository.applyAtomically).not.toHaveBeenCalled();
    expect(setup.readRepository.findVerifiedProduct).not.toHaveBeenCalled();
  });

  it("rejects Validator errors before any database boundary", async () => {
    const setup = serviceSetup("new");
    const input = validInput();
    input.source.source_type = "ai_candidate";

    await expect(setup.service.apply(input)).rejects.toMatchObject({
      code: "CATALOG_SEED_VALIDATION_FAILED",
      writeCommitted: false,
      errors: [expect.objectContaining({
        code: "CATALOG_SEED_VERIFIED_AI_CANDIDATE_SOURCE_FORBIDDEN",
      })],
    });
    expect(setup.dryRun.run).not.toHaveBeenCalled();
    expect(setup.writeRepository.applyAtomically).not.toHaveBeenCalled();
  });

  it("rejects a dry-run conflict without writing or reading back", async () => {
    const setup = serviceSetup("conflict");

    await expect(setup.service.apply(validInput())).rejects.toBeInstanceOf(
      CatalogSeedServiceConflictError,
    );
    expect(setup.writeRepository.applyAtomically).not.toHaveBeenCalled();
    expect(setup.readRepository.findVerifiedProduct).not.toHaveBeenCalled();
  });

  it("returns an idempotent existing receipt without invoking the write RPC", async () => {
    const setup = serviceSetup("existing");

    const result = await setup.service.apply(validInput());

    expect(result).toEqual({
      receipt: {
        outcome: "existing",
        catalog_product_id: catalogProductId,
        source_id: sourceId,
        source_created: false,
        catalog_product_created: false,
        status: "verified",
      },
      readback: expectedReadback(),
      warnings: [],
    });
    expect(setup.writeRepository.applyAtomically).not.toHaveBeenCalled();
    expect(setup.readRepository.findVerifiedProduct).toHaveBeenCalledWith(
      catalogProductId,
    );
  });

  it("writes only a new seed and returns the verified readback", async () => {
    const setup = serviceSetup("new");

    const result = await setup.service.apply(validInput());

    expect(setup.writeRepository.applyAtomically).toHaveBeenCalledOnce();
    expect(setup.writeRepository.applyAtomically).toHaveBeenCalledWith(
      validInput(),
    );
    expect(setup.readRepository.findVerifiedProduct).toHaveBeenCalledWith(
      catalogProductId,
    );
    expect(result).toEqual({
      receipt: createdReceipt,
      readback: expectedReadback(),
      warnings: [],
    });
  });

  it("accepts an RPC-level existing receipt when a concurrent writer won after dry-run", async () => {
    const setup = serviceSetup("new");
    const existingReceipt: CatalogSeedWriteReceipt = {
      ...createdReceipt,
      outcome: "existing",
      source_created: false,
      catalog_product_created: false,
    };
    vi.mocked(setup.writeRepository.applyAtomically).mockResolvedValue(
      existingReceipt,
    );

    const result = await setup.service.apply(validInput());

    expect(result.receipt).toEqual(existingReceipt);
    expect(result.readback).toEqual(expectedReadback());
  });

  it("preserves dry-run warnings while allowing a new product", async () => {
    const warning: CatalogSeedDryRunIssue = {
      code: "CATALOG_SEED_BARCODE_MISSING",
      message: "缺少 barcode。",
      catalog_product_id: catalogProductId,
      conflicting_catalog_product_id: null,
      path: ["identity", "barcode"],
    };
    const input = validInput();
    input.identity.barcode = null;
    const setup = serviceSetup("new", { warnings: [warning] });
    vi.mocked(setup.readRepository.findVerifiedProduct).mockResolvedValue(
      catalogRow({ barcode: null }),
    );

    const result = await setup.service.apply(input);

    expect(result.warnings).toEqual([warning]);
    expect(setup.writeRepository.applyAtomically).toHaveBeenCalledOnce();
  });

  it("propagates a write failure and skips readback", async () => {
    const setup = serviceSetup("new");
    const failure = new Error("CATALOG_SEED_WRITE_FAILED");
    vi.mocked(setup.writeRepository.applyAtomically).mockRejectedValue(failure);

    await expect(setup.service.apply(validInput())).rejects.toBe(failure);
    expect(setup.readRepository.findVerifiedProduct).not.toHaveBeenCalled();
  });

  it("marks readback failures after a created receipt as committed", async () => {
    const setup = serviceSetup("new");
    const failure = new Error("CATALOG_READ_FAILED");
    vi.mocked(setup.readRepository.findVerifiedProduct).mockRejectedValue(
      failure,
    );

    try {
      await setup.service.apply(validInput());
      throw new Error("Expected readback failure");
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogSeedReadbackError);
      expect(error).toMatchObject({
        code: "CATALOG_SEED_READBACK_FAILED",
        catalogProductId,
        writeCommitted: true,
        cause: failure,
      });
    }
  });

  it("rejects a readback that differs from the seed", async () => {
    const setup = serviceSetup("new");
    vi.mocked(setup.readRepository.findVerifiedProduct).mockResolvedValue(
      catalogRow({ product_name: "Different Product" }),
    );

    await expect(setup.service.apply(validInput())).rejects.toEqual(
      new CatalogSeedReadbackError(
        "CATALOG_SEED_READBACK_MISMATCH",
        catalogProductId,
        true,
      ),
    );
  });
});

function serviceSetup(
  status: "new" | "existing" | "conflict",
  options: { warnings?: CatalogSeedDryRunIssue[] } = {},
) {
  const dryRun: CatalogSeedDryRunChecker = {
    run: vi.fn().mockResolvedValue(dryRunReport(status, options.warnings)),
  };
  const writeRepository: CatalogSeedWriteRepository = {
    applyAtomically: vi.fn().mockResolvedValue(createdReceipt),
  };
  const readRepository = {
    findVerifiedProduct: vi.fn().mockResolvedValue(catalogRow()),
  };

  return {
    dryRun,
    writeRepository,
    readRepository,
    service: createCatalogSeedService(
      dryRun,
      writeRepository,
      readRepository,
    ),
  };
}

function dryRunReport(
  status: "new" | "existing" | "conflict",
  warnings: CatalogSeedDryRunIssue[] = [],
): CatalogSeedDryRunReport {
  const summary = {
    catalog_product_id: catalogProductId,
    brand_name: "Beauty OS",
    product_name: "Catalog Serum",
    variant_name: null,
    barcode: "12345678",
    category: "skincare" as const,
    subcategory: "face_care" as const,
    product_type: "serum" as const,
  };
  const conflict: CatalogSeedDryRunIssue = {
    code: "CATALOG_SEED_NORMALIZED_IDENTITY_CONFLICT",
    message: "Identity conflict.",
    catalog_product_id: catalogProductId,
    conflicting_catalog_product_id:
      "10000000-0000-4000-8000-000000000002",
    path: ["identity"],
  };

  return {
    report_version: "catalog-seed-dry-run/v0.1",
    status,
    new_products: status === "new" ? [summary] : [],
    existing_products: status === "existing" ? [summary] : [],
    conflicts: status === "conflict" ? [conflict] : [],
    warnings,
    errors: [],
  };
}

function validInput(): CatalogSeedInput {
  return {
    schema_version: "catalog-seed/v0.1",
    catalog_product_id: catalogProductId,
    source: {
      source_id: sourceId,
      source_type: "official_brand",
      name: "Beauty OS official product page",
      source_url: "https://example.com/catalog-serum",
      license_note: "Official identity data",
      retrieved_at: timestamp,
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

function catalogRow(
  overrides: Partial<CatalogProductWithSourceRow> = {},
): CatalogProductWithSourceRow {
  return {
    id: catalogProductId,
    brand_name: "Beauty OS",
    product_name: "Catalog Serum",
    variant_name: null,
    barcode: "12345678",
    catalog_image_url: null,
    catalog_image_source_url: null,
    category: "skincare",
    subcategory: "face_care",
    product_type: "serum",
    primary_source_id: sourceId,
    confidence: 98,
    status: "verified",
    created_at: timestamp,
    updated_at: timestamp,
    source: {
      id: sourceId,
      source_type: "official_brand",
      name: "Beauty OS official product page",
      source_url: "https://example.com/catalog-serum",
      license_note: "Official identity data",
      retrieved_at: timestamp,
      created_at: timestamp,
    },
    ...overrides,
  };
}

function expectedReadback() {
  return {
    catalog_product_id: catalogProductId,
    brand_name: "Beauty OS",
    product_name: "Catalog Serum",
    variant_name: null,
    barcode: "12345678",
    category: "skincare",
    subcategory: "face_care",
    product_type: "serum",
    source: {
      source_id: sourceId,
      source_type: "official_brand",
      name: "Beauty OS official product page",
      source_url: "https://example.com/catalog-serum",
      license_note: "Official identity data",
      retrieved_at: timestamp,
    },
    confidence: 98,
    status: "verified",
  };
}
