import { describe, expect, it, vi } from "vitest";

import type { CatalogSeedInput } from "@/schemas/catalog-seed";
import { createCatalogSeedDryRunChecker } from "@/server/catalog-seed/catalog-seed-dry-run";
import type {
  CatalogSeedCatalogProductRow,
  CatalogSeedKnowledgeSourceRow,
  CatalogSeedLookupRepository,
  CatalogSeedLookupResult,
} from "@/server/repositories/catalog-seed-lookup-repository";

const catalogProductId = "10000000-0000-4000-8000-000000000001";
const otherCatalogProductId = "10000000-0000-4000-8000-000000000002";
const sourceId = "20000000-0000-4000-8000-000000000001";
const timestamp = "2026-08-24T00:00:00.000Z";

describe("CatalogSeedDryRunChecker", () => {
  it("returns schema errors without reading catalog data", async () => {
    const inspect = vi.fn();
    const checker = createCatalogSeedDryRunChecker({ inspect });

    const report = await checker.run({
      ...validInput(),
      catalog_product_id: "not-a-uuid",
    });

    expect(report).toMatchObject({
      report_version: "catalog-seed-dry-run/v0.1",
      status: "invalid",
      new_products: [],
      existing_products: [],
      conflicts: [],
      errors: [expect.objectContaining({
        code: "CATALOG_SEED_SCHEMA_INVALID",
        catalog_product_id: null,
        path: ["catalog_product_id"],
      })],
    });
    expect(inspect).not.toHaveBeenCalled();
  });

  it("returns business validation errors without reading catalog data", async () => {
    const inspect = vi.fn();
    const checker = createCatalogSeedDryRunChecker({ inspect });
    const input = validInput();
    input.identity.category = "makeup";

    const report = await checker.run(input);

    expect(report.status).toBe("invalid");
    expect(report.errors).toContainEqual(expect.objectContaining({
      code: "CATALOG_SEED_PRODUCT_TYPE_CATEGORY_MISMATCH",
      catalog_product_id: catalogProductId,
    }));
    expect(inspect).not.toHaveBeenCalled();
  });

  it("reports a new product and preserves non-blocking warnings", async () => {
    const input = validInput();
    input.identity.barcode = null;
    input.source.source_type = "official_retailer";
    input.source.source_url = null;
    const { checker, inspect } = setupChecker(emptyLookup());

    const report = await checker.run(input);

    expect(report).toMatchObject({
      status: "new",
      new_products: [{
        catalog_product_id: catalogProductId,
        brand_name: "Beauty OS",
        product_name: "Catalog Serum",
        barcode: null,
      }],
      existing_products: [],
      conflicts: [],
      errors: [],
    });
    expect(report.warnings.map((warning) => warning.code)).toEqual([
      "CATALOG_SEED_BARCODE_MISSING",
      "CATALOG_SEED_NON_OFFICIAL_BRAND_SOURCE",
      "CATALOG_SEED_SOURCE_URL_MISSING",
    ]);
    expect(inspect).toHaveBeenCalledOnce();
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({
      catalog_product_id: catalogProductId,
    }));
  });

  it("reports an idempotent seed as existing", async () => {
    const input = validInput();
    const source = sourceRow({
      // Same instant as the input, represented in UTC.
      retrieved_at: timestamp,
    });
    const catalog = catalogRow();
    const { checker } = setupChecker(emptyLookup({
      source_by_id: source,
      catalog_by_id: catalog,
      barcode_match: catalog,
      raw_identity_matches: [catalog],
      normalized_verified_matches: [catalog],
    }));

    const report = await checker.run(input);

    expect(report).toMatchObject({
      status: "existing",
      new_products: [],
      existing_products: [{ catalog_product_id: catalogProductId }],
      conflicts: [],
      warnings: [],
      errors: [],
    });
  });

  it("reports stable-id, source-id, barcode, and raw identity conflicts", async () => {
    const input = validInput();
    const sameIdDifferentProduct = catalogRow({ product_name: "Other Serum" });
    const other = catalogRow({ id: otherCatalogProductId });
    const { checker } = setupChecker(emptyLookup({
      source_by_id: sourceRow({ name: "A different source" }),
      catalog_by_id: sameIdDifferentProduct,
      barcode_match: other,
      raw_identity_matches: [other],
      normalized_verified_matches: [other],
    }));

    const report = await checker.run(input);

    expect(report.status).toBe("conflict");
    expect(report.new_products).toEqual([]);
    expect(report.existing_products).toEqual([]);
    expect(report.conflicts.map((conflict) => conflict.code)).toEqual([
      "CATALOG_SEED_BARCODE_CONFLICT",
      "CATALOG_SEED_CATALOG_PRODUCT_ID_CONFLICT",
      "CATALOG_SEED_IDENTITY_CONFLICT",
      "CATALOG_SEED_SOURCE_ID_CONFLICT",
    ]);
    expect(report.conflicts).toContainEqual(expect.objectContaining({
      code: "CATALOG_SEED_IDENTITY_CONFLICT",
      conflicting_catalog_product_id: otherCatalogProductId,
    }));
  });

  it("detects a normalized identity collision not caught by raw equality", async () => {
    const normalizedMatch = catalogRow({
      id: otherCatalogProductId,
      brand_name: "Beauty-OS",
      product_name: "CatalogSerum",
    });
    const { checker } = setupChecker(emptyLookup({
      normalized_verified_matches: [normalizedMatch],
    }));

    const report = await checker.run(validInput());

    expect(report.status).toBe("conflict");
    expect(report.conflicts).toEqual([
      expect.objectContaining({
        code: "CATALOG_SEED_NORMALIZED_IDENTITY_CONFLICT",
        conflicting_catalog_product_id: otherCatalogProductId,
      }),
    ]);
  });

  it("blocks another normalized-name variant because the matcher ignores variant", async () => {
    const otherVariant = catalogRow({
      id: otherCatalogProductId,
      variant_name: "Rich",
    });
    const { checker } = setupChecker(emptyLookup({
      normalized_verified_matches: [otherVariant],
    }));

    const report = await checker.run(validInput());

    expect(report.status).toBe("conflict");
    expect(report.conflicts).toEqual([
      expect.objectContaining({
        code: "CATALOG_SEED_NORMALIZED_IDENTITY_CONFLICT",
        conflicting_catalog_product_id: otherCatalogProductId,
      }),
    ]);
    expect(report.warnings).toEqual([]);
  });

  it("blocks an inconsistent multi-query snapshot instead of reporting new", async () => {
    const concurrentlyVisible = catalogRow();
    const { checker } = setupChecker(emptyLookup({
      catalog_by_id: null,
      normalized_verified_matches: [concurrentlyVisible],
    }));

    const report = await checker.run(validInput());

    expect(report.status).toBe("conflict");
    expect(report.conflicts).toEqual([
      expect.objectContaining({
        code: "CATALOG_SEED_LOOKUP_SNAPSHOT_CONFLICT",
        conflicting_catalog_product_id: catalogProductId,
      }),
    ]);
  });

  it("propagates lookup failures instead of misreporting a product as new", async () => {
    const readError = Object.assign(new Error("catalog read failed"), {
      code: "CATALOG_SEED_LOOKUP_READ_FAILED",
    });
    const inspect = vi.fn().mockRejectedValue(readError);
    const checker = createCatalogSeedDryRunChecker({ inspect });

    await expect(checker.run(validInput())).rejects.toBe(readError);
  });
});

function setupChecker(result: CatalogSeedLookupResult) {
  const inspect = vi.fn().mockResolvedValue(result);
  const lookup: CatalogSeedLookupRepository = { inspect };
  return {
    checker: createCatalogSeedDryRunChecker(lookup),
    inspect,
  };
}

function emptyLookup(
  overrides: Partial<CatalogSeedLookupResult> = {},
): CatalogSeedLookupResult {
  return {
    source_by_id: null,
    catalog_by_id: null,
    barcode_match: null,
    raw_identity_matches: [],
    normalized_verified_matches: [],
    ...overrides,
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
      source_url: "https://example.com/products/catalog-serum",
      license_note: "Official catalog identity",
      retrieved_at: "2026-08-24T08:00:00+08:00",
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

function sourceRow(
  overrides: Partial<CatalogSeedKnowledgeSourceRow> = {},
): CatalogSeedKnowledgeSourceRow {
  return {
    id: sourceId,
    source_type: "official_brand",
    name: "Beauty OS official product page",
    source_url: "https://example.com/products/catalog-serum",
    license_note: "Official catalog identity",
    retrieved_at: timestamp,
    created_at: timestamp,
    ...overrides,
  };
}

function catalogRow(
  overrides: Partial<CatalogSeedCatalogProductRow> = {},
): CatalogSeedCatalogProductRow {
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
    ...overrides,
  };
}
