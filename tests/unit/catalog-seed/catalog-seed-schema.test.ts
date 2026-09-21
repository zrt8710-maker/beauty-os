import { describe, expect, it } from "vitest";

import {
  CATALOG_SEED_DRY_RUN_STATUSES,
  CATALOG_SEED_SOURCE_TYPES,
  catalogSeedDryRunReportSchema,
  catalogSeedInputSchema,
  catalogSeedReadbackSchema,
  catalogSeedWriteReceiptSchema,
} from "@/schemas/catalog-seed";

const catalogProductId = "10000000-0000-4000-8000-000000000001";
const sourceId = "20000000-0000-4000-8000-000000000001";

function validSeed() {
  return {
    schema_version: "catalog-seed/v0.1",
    catalog_product_id: catalogProductId,
    source: {
      source_id: sourceId,
      source_type: "official_brand",
      name: "Beauty OS Source",
      source_url: "https://example.com/products/serum",
      license_note: "Official product data",
      retrieved_at: "2026-08-24T08:00:00+08:00",
    },
    identity: {
      brand_name: "Beauty OS",
      product_name: "Knowledge Serum",
      variant_name: "30 ml",
      barcode: "12345678",
      category: "skincare",
      subcategory: "face_care",
      product_type: "serum",
      confidence: 95,
      status: "verified",
    },
  };
}

function productSummary() {
  const seed = validSeed();
  return {
    catalog_product_id: seed.catalog_product_id,
    brand_name: seed.identity.brand_name,
    product_name: seed.identity.product_name,
    variant_name: seed.identity.variant_name,
    barcode: seed.identity.barcode,
    category: seed.identity.category,
    subcategory: seed.identity.subcategory,
    product_type: seed.identity.product_type,
  };
}

function issue() {
  return {
    code: "CATALOG_IDENTITY_CONFLICT",
    message: "Catalog identity is already assigned to another product.",
    catalog_product_id: catalogProductId,
    conflicting_catalog_product_id:
      "10000000-0000-4000-8000-000000000002",
    path: ["identity", "product_name"],
  };
}

describe("Catalog Seed schema", () => {
  it("parses a strict verified catalog seed", () => {
    expect(catalogSeedInputSchema.parse(validSeed())).toEqual(validSeed());
  });

  it("trims text and normalizes omitted nullable values to null", () => {
    const input = validSeed();
    const parsed = catalogSeedInputSchema.parse({
      ...input,
      source: {
        source_id: input.source.source_id,
        source_type: input.source.source_type,
        name: "  Beauty OS Source  ",
        retrieved_at: input.source.retrieved_at,
      },
      identity: {
        ...input.identity,
        brand_name: "  Beauty OS  ",
        product_name: "  Knowledge Serum  ",
        variant_name: undefined,
        barcode: undefined,
      },
    });

    expect(parsed).toMatchObject({
      source: {
        name: "Beauty OS Source",
        source_url: null,
        license_note: null,
      },
      identity: {
        brand_name: "Beauty OS",
        product_name: "Knowledge Serum",
        variant_name: null,
        barcode: null,
      },
    });
  });

  it("accepts every existing knowledge source type", () => {
    for (const sourceType of CATALOG_SEED_SOURCE_TYPES) {
      const input = validSeed();
      input.source.source_type = sourceType;
      expect(catalogSeedInputSchema.safeParse(input).success).toBe(true);
    }
  });

  it("rejects unsupported versions, source values, and non-verified status", () => {
    const input = validSeed();

    expect(catalogSeedInputSchema.safeParse({
      ...input,
      schema_version: "catalog-seed/v0.2",
    }).success).toBe(false);
    expect(catalogSeedInputSchema.safeParse({
      ...input,
      source: { ...input.source, source_type: "unknown_source" },
    }).success).toBe(false);
    expect(catalogSeedInputSchema.safeParse({
      ...input,
      identity: { ...input.identity, status: "candidate" },
    }).success).toBe(false);
  });

  it("validates UUID, URL, offset timestamp, barcode, and confidence shapes", () => {
    const input = validSeed();
    const invalidInputs = [
      { ...input, catalog_product_id: "not-a-uuid" },
      {
        ...input,
        source: { ...input.source, source_url: "not-a-url" },
      },
      {
        ...input,
        source: {
          ...input.source,
          source_url: `https://example.com/${"a".repeat(2000)}`,
        },
      },
      {
        ...input,
        source: {
          ...input.source,
          retrieved_at: "2026-08-24T08:00:00",
        },
      },
      {
        ...input,
        identity: { ...input.identity, barcode: "1234567" },
      },
      {
        ...input,
        identity: { ...input.identity, barcode: "x".repeat(33) },
      },
      {
        ...input,
        identity: { ...input.identity, confidence: 90.5 },
      },
      {
        ...input,
        identity: { ...input.identity, confidence: 101 },
      },
    ];

    for (const invalidInput of invalidInputs) {
      expect(catalogSeedInputSchema.safeParse(invalidInput).success).toBe(false);
    }
  });

  it("accepts the existing catalog contract's alphanumeric barcode format", () => {
    const input = validSeed();
    input.identity.barcode = "  ABC12345  ";

    expect(catalogSeedInputSchema.parse(input).identity.barcode).toBe(
      "ABC12345",
    );
  });

  it("does not perform product type metadata cross-field validation", () => {
    const input = validSeed();
    const result = catalogSeedInputSchema.safeParse({
      ...input,
      identity: {
        ...input.identity,
        category: "makeup",
        subcategory: "hair_care",
        product_type: "serum",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects unknown keys at every catalog seed level", () => {
    const input = validSeed();

    expect(catalogSeedInputSchema.safeParse({
      ...input,
      unexpected: true,
    }).success).toBe(false);
    expect(catalogSeedInputSchema.safeParse({
      ...input,
      source: { ...input.source, unexpected: true },
    }).success).toBe(false);
    expect(catalogSeedInputSchema.safeParse({
      ...input,
      identity: { ...input.identity, unexpected: true },
    }).success).toBe(false);
  });
});

describe("Catalog Seed dry-run report schema", () => {
  it("accepts every report status with stable product and issue DTOs", () => {
    for (const status of CATALOG_SEED_DRY_RUN_STATUSES) {
      const report = {
        report_version: "catalog-seed-dry-run/v0.1",
        status,
        new_products: status === "new" ? [productSummary()] : [],
        existing_products: status === "existing" ? [productSummary()] : [],
        conflicts: status === "conflict" ? [issue()] : [],
        warnings: [],
        errors: status === "invalid" ? [issue()] : [],
      };

      expect(catalogSeedDryRunReportSchema.parse(report)).toEqual(report);
    }
  });

  it("rejects unsupported versions, statuses, and unknown nested keys", () => {
    const report = {
      report_version: "catalog-seed-dry-run/v0.1",
      status: "new",
      new_products: [productSummary()],
      existing_products: [],
      conflicts: [],
      warnings: [],
      errors: [],
    };

    expect(catalogSeedDryRunReportSchema.safeParse({
      ...report,
      report_version: "catalog-seed-dry-run/v0.2",
    }).success).toBe(false);
    expect(catalogSeedDryRunReportSchema.safeParse({
      ...report,
      status: "updated",
    }).success).toBe(false);
    expect(catalogSeedDryRunReportSchema.safeParse({
      ...report,
      new_products: [{ ...productSummary(), unexpected: true }],
    }).success).toBe(false);
    expect(catalogSeedDryRunReportSchema.safeParse({
      ...report,
      warnings: [{ ...issue(), unexpected: true }],
    }).success).toBe(false);
  });

  it("rejects reports whose status contradicts their result arrays", () => {
    const report = {
      report_version: "catalog-seed-dry-run/v0.1",
      status: "new",
      new_products: [productSummary()],
      existing_products: [],
      conflicts: [],
      warnings: [],
      errors: [],
    };

    expect(catalogSeedDryRunReportSchema.safeParse({
      ...report,
      new_products: [],
    }).success).toBe(false);
    expect(catalogSeedDryRunReportSchema.safeParse({
      ...report,
      conflicts: [issue()],
    }).success).toBe(false);
    expect(catalogSeedDryRunReportSchema.safeParse({
      ...report,
      status: "invalid",
      new_products: [],
      errors: [],
    }).success).toBe(false);
  });
});

describe("Catalog Seed write DTOs", () => {
  it("parses strict created/existing receipts and enforces outcome invariants", () => {
    const created = {
      outcome: "created",
      catalog_product_id: catalogProductId,
      source_id: sourceId,
      source_created: true,
      catalog_product_created: true,
      status: "verified",
    };
    const existing = {
      ...created,
      outcome: "existing",
      source_created: false,
      catalog_product_created: false,
    };

    expect(catalogSeedWriteReceiptSchema.parse(created)).toEqual(created);
    expect(catalogSeedWriteReceiptSchema.parse(existing)).toEqual(existing);
    expect(catalogSeedWriteReceiptSchema.safeParse({
      ...created,
      catalog_product_created: false,
    }).success).toBe(false);
    expect(catalogSeedWriteReceiptSchema.safeParse({
      ...existing,
      source_created: true,
    }).success).toBe(false);
    expect(catalogSeedWriteReceiptSchema.safeParse({
      ...created,
      unexpected: true,
    }).success).toBe(false);
  });

  it("parses the complete verified catalog readback", () => {
    const input = validSeed();
    const readback = {
      catalog_product_id: input.catalog_product_id,
      brand_name: input.identity.brand_name,
      product_name: input.identity.product_name,
      variant_name: input.identity.variant_name,
      barcode: input.identity.barcode,
      category: input.identity.category,
      subcategory: input.identity.subcategory,
      product_type: input.identity.product_type,
      source: input.source,
      confidence: input.identity.confidence,
      status: input.identity.status,
    };

    expect(catalogSeedReadbackSchema.parse(readback)).toEqual(readback);
    expect(catalogSeedReadbackSchema.safeParse({
      ...readback,
      status: "candidate",
    }).success).toBe(false);
  });
});
