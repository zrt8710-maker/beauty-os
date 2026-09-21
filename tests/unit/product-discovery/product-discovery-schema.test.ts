import { describe, expect, it } from "vitest";

import {
  productDiscoveryCandidateSchema,
  productDiscoveryRequestSchema,
  productDiscoveryResultSchema,
} from "@/schemas/product-discovery";

describe("Product Discovery DTO schemas", () => {
  it("parses strict barcode and name requests with stable defaults", () => {
    expect(productDiscoveryRequestSchema.parse({
      schema_version: "product-discovery/v0.1",
      mode: "barcode",
      barcode: "4006381333931",
    })).toEqual({
      schema_version: "product-discovery/v0.1",
      mode: "barcode",
      barcode: "4006381333931",
      locale: "zh-CN",
      market: "CN",
      limit: 10,
    });

    expect(productDiscoveryRequestSchema.parse({
      schema_version: "product-discovery/v0.1",
      mode: "name",
      product_name: "Daily Serum",
    })).toMatchObject({
      mode: "name",
      brand_name: null,
      product_name: "Daily Serum",
    });
  });

  it("rejects unsupported modes, versions, markets, and unknown keys", () => {
    const request = {
      schema_version: "product-discovery/v0.1",
      mode: "barcode",
      barcode: "4006381333931",
    };

    expect(productDiscoveryRequestSchema.safeParse({
      ...request,
      mode: "image",
    }).success).toBe(false);
    expect(productDiscoveryRequestSchema.safeParse({
      ...request,
      schema_version: "product-discovery/v0.2",
    }).success).toBe(false);
    expect(productDiscoveryRequestSchema.safeParse({
      ...request,
      market: "china",
    }).success).toBe(false);
    expect(productDiscoveryRequestSchema.safeParse({
      ...request,
      unexpected: true,
    }).success).toBe(false);
  });

  it("parses a candidate with field-level provenance", () => {
    expect(productDiscoveryCandidateSchema.parse(candidate())).toEqual(
      candidate(),
    );
  });

  it("enforces result version and strict nested DTOs", () => {
    const result = {
      result_version: "product-discovery-result/v0.1",
      query: {
        schema_version: "product-discovery/v0.1",
        mode: "barcode",
        barcode: "4006381333931",
        locale: "zh-CN",
        market: "CN",
        limit: 10,
      },
      status: "existing_exact",
      candidates: [candidate()],
      provider_results: [{
        provider_code: "internal_catalog",
        status: "ok",
        candidates: [candidate()],
        issues: [],
      }],
      warnings: [],
    };

    expect(productDiscoveryResultSchema.parse(result)).toEqual(result);
    expect(productDiscoveryResultSchema.safeParse({
      ...result,
      result_version: "product-discovery-result/v0.2",
    }).success).toBe(false);
    expect(productDiscoveryResultSchema.safeParse({
      ...result,
      candidates: [{ ...candidate(), unexpected: true }],
    }).success).toBe(false);
  });
});

function candidate() {
  return {
    candidate_id: "internal:10000000-0000-4000-8000-000000000001",
    candidate_kind: "internal_verified",
    brand_name: "Beauty OS",
    product_name: "Daily Serum",
    variant_name: "30 ml",
    barcode: "4006381333931",
    category_suggestion: "skincare",
    subcategory_suggestion: "face_care",
    product_type_suggestion: "serum",
    market: "CN",
    locale: "zh-CN",
    image_preview_url: null,
    existing_catalog_product_id:
      "10000000-0000-4000-8000-000000000001",
    discovery_score: 100,
    match_reason: "barcode_exact",
    verification_eligibility: "eligible",
    completeness: 100,
    warnings: [],
    conflicts: [],
    sources: [{
      provider_code: "internal_catalog",
      source_type: "official_brand",
      source_name: "Beauty OS",
      source_url: "https://example.com/daily-serum",
      retrieved_at: "2026-08-24T00:00:00.000Z",
      license_note: null,
      authority_level: "official",
      fields_supported: [
        "brand_name",
        "product_name",
        "variant_name",
        "barcode",
        "category",
        "subcategory",
        "product_type",
      ],
      raw_record_id: "10000000-0000-4000-8000-000000000001",
      source_quality: 98,
      attribution_required: false,
      image_reuse_note: null,
    }],
  };
}

