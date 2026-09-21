import { describe, expect, it } from "vitest";

import type {
  NormalizedProductDiscoveryQuery,
  ProductDiscoveryCandidate,
} from "@/schemas/product-discovery";
import {
  matchProductCandidates,
  normalizeIdentityText,
} from "@/server/domain/product-discovery";

describe("Product Discovery candidate matcher", () => {
  it("matches a normalized barcode exactly", () => {
    const result = matchProductCandidates(barcodeQuery(), [candidate()]);

    expect(result.status).toBe("existing_exact");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      discovery_score: 100,
      match_reason: "barcode_exact",
    });
  });

  it("normalizes punctuation, spaces, width, and case for identity matching", () => {
    expect(normalizeIdentityText(" Ｂｅａｕｔｙ-OS  ")).toBe("beautyos");

    const result = matchProductCandidates(nameQuery(), [candidate()]);
    expect(result.status).toBe("existing_exact");
    expect(result.candidates[0].match_reason).toBe(
      "normalized_identity_exact",
    );
  });

  it("returns variant candidates rather than treating capacities as a conflict", () => {
    const small = candidate({ variant_name: "30 ml" });
    const large = candidate({
      candidate_id: "internal:10000000-0000-4000-8000-000000000002",
      existing_catalog_product_id:
        "10000000-0000-4000-8000-000000000002",
      variant_name: "50 ml",
      barcode: "9506000140445",
    });

    const result = matchProductCandidates(nameQuery(), [large, small]);

    expect(result.status).toBe("existing_variant_candidates");
    expect(result.candidates.map((item) => item.variant_name)).toEqual([
      "30 ml",
      "50 ml",
    ]);
  });

  it("filters unrelated candidates and returns no_match", () => {
    const result = matchProductCandidates(nameQuery(), [candidate({
      brand_name: "Other Brand",
      product_name: "Other Cream",
    })]);

    expect(result).toEqual({
      status: "no_match",
      candidates: [],
      warnings: [],
    });
  });

  it("deduplicates the same internal catalog product", () => {
    const duplicate = candidate({
      sources: [
        ...candidate().sources,
        {
          ...candidate().sources[0],
          provider_code: "second_provider",
          raw_record_id: "second-record",
        },
      ],
    });

    const result = matchProductCandidates(barcodeQuery(), [
      candidate(),
      duplicate,
    ]);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].sources).toHaveLength(2);
  });
});

function barcodeQuery(): NormalizedProductDiscoveryQuery {
  return {
    schema_version: "product-discovery/v0.1",
    mode: "barcode",
    barcode: "4006381333931",
    locale: "zh-CN",
    market: "CN",
    limit: 10,
  };
}

function nameQuery(): NormalizedProductDiscoveryQuery {
  return {
    schema_version: "product-discovery/v0.1",
    mode: "name",
    brand_name: " beauty os ",
    product_name: "Daily-Serum",
    locale: "zh-CN",
    market: "CN",
    limit: 10,
  };
}

function candidate(
  patch: Partial<ProductDiscoveryCandidate> = {},
): ProductDiscoveryCandidate {
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
    discovery_score: 0,
    match_reason: "name_contains",
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
      fields_supported: ["brand_name", "product_name", "barcode"],
      raw_record_id: "10000000-0000-4000-8000-000000000001",
      source_quality: 98,
      attribution_required: false,
      image_reuse_note: null,
    }],
    ...patch,
  };
}

