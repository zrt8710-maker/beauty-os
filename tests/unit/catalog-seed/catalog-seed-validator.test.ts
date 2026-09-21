import { describe, expect, it } from "vitest";

import { validateCatalogSeed } from "@/server/domain/catalog-seed";

const catalogProductId = "10000000-0000-4000-8000-000000000001";
const sourceId = "20000000-0000-4000-8000-000000000001";

function validSeed() {
  return {
    schema_version: "catalog-seed/v0.1",
    catalog_product_id: catalogProductId,
    source: {
      source_id: sourceId,
      source_type: "official_brand",
      name: "Beauty OS Official",
      source_url: "https://example.com/products/knowledge-serum",
      license_note: "Official catalog data",
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

describe("validateCatalogSeed", () => {
  it("returns the parsed input for a valid official catalog seed", () => {
    const input = validSeed();
    input.identity.brand_name = "  Beauty OS  ";

    const result = validateCatalogSeed(input);

    expect(result).toEqual({
      valid: true,
      input: {
        ...input,
        identity: {
          ...input.identity,
          brand_name: "Beauty OS",
        },
      },
      errors: [],
      warnings: [],
    });
  });

  it("maps schema issues to stable codes and precise paths", () => {
    const input = validSeed();
    const result = validateCatalogSeed({
      ...input,
      catalog_product_id: "not-a-uuid",
      identity: {
        ...input.identity,
        barcode: "ABC",
      },
    });

    expect(result.valid).toBe(false);
    expect(result.input).toBeNull();
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "CATALOG_SEED_SCHEMA_INVALID",
        path: ["catalog_product_id"],
      }),
      expect.objectContaining({
        code: "CATALOG_SEED_SCHEMA_INVALID",
        path: ["identity", "barcode"],
      }),
    ]));
  });

  it("requires category and subcategory to exactly match PRODUCT_TYPE_META", () => {
    const input = validSeed();
    input.identity.category = "makeup";
    input.identity.subcategory = "sun_care";

    const result = validateCatalogSeed(input);

    expect(result.valid).toBe(false);
    expect(result.input).not.toBeNull();
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "CATALOG_SEED_PRODUCT_TYPE_CATEGORY_MISMATCH",
        path: ["identity", "category"],
      }),
      expect.objectContaining({
        code: "CATALOG_SEED_PRODUCT_TYPE_SUBCATEGORY_MISMATCH",
        path: ["identity", "subcategory"],
      }),
    ]);
  });

  it("rejects an ai_candidate source for a verified catalog seed", () => {
    const input = validSeed();
    input.source.source_type = "ai_candidate";

    const result = validateCatalogSeed(input);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "CATALOG_SEED_VERIFIED_AI_CANDIDATE_SOURCE_FORBIDDEN",
        path: ["source", "source_type"],
      }),
    ]);
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: "CATALOG_SEED_NON_OFFICIAL_BRAND_SOURCE",
      path: ["source", "source_type"],
    }));
  });

  it("warns for missing barcode and source URL without blocking the seed", () => {
    const seed = validSeed();
    const input = {
      ...seed,
      source: { ...seed.source, source_url: null },
      identity: { ...seed.identity, barcode: null },
    };

    const result = validateCatalogSeed(input);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "CATALOG_SEED_BARCODE_MISSING",
        path: ["identity", "barcode"],
      }),
      expect.objectContaining({
        code: "CATALOG_SEED_SOURCE_URL_MISSING",
        path: ["source", "source_url"],
      }),
    ]);
  });

  it("warns for a non-official-brand source but keeps it valid", () => {
    const input = validSeed();
    input.source.source_type = "official_retailer";

    const result = validateCatalogSeed(input);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "CATALOG_SEED_NON_OFFICIAL_BRAND_SOURCE",
        path: ["source", "source_type"],
      }),
    ]);
  });

  it("returns only validation concerns and does not infer knowledge fields", () => {
    const result = validateCatalogSeed(validSeed());

    expect(Object.keys(result).sort()).toEqual([
      "errors",
      "input",
      "valid",
      "warnings",
    ]);
    expect(result.input).not.toHaveProperty("roles");
    expect(result.input).not.toHaveProperty("capabilities");
  });
});
