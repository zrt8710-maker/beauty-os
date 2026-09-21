import { describe, expect, it } from "vitest";

import type { ProductDiscoveryCandidate } from "@/schemas/product-discovery";
import { createProductDiscoveryService } from "@/server/services/product-discovery-service";

import { createFakeExternalProvider } from "../../support/product-discovery/fake-external-provider";

describe("Product Discovery multi-provider architecture", () => {
  it("merges the same product from internal and external providers", async () => {
    const internal = createFakeExternalProvider({
      providerCode: "internal_catalog",
      candidates: [internalCandidate()],
    });
    const external = createFakeExternalProvider({
      candidates: [externalCandidate()],
    });

    const result = await createProductDiscoveryService([
      internal,
      external,
    ]).search(barcodeRequest());

    expect(result.status).toBe("existing_exact");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      candidate_id: internalCandidate().candidate_id,
      candidate_kind: "internal_verified",
      existing_catalog_product_id:
        internalCandidate().existing_catalog_product_id,
      image_preview_url: "https://example.com/external-product.jpg",
      discovery_score: 100,
    });
    expect(result.candidates[0].sources.map((source) =>
      source.provider_code)).toEqual([
      "internal_catalog",
      "fake_external",
    ]);
    expect(result.provider_results).toHaveLength(2);
  });

  it("preserves field-level provenance from every merged provider", async () => {
    const internal = createFakeExternalProvider({
      providerCode: "internal_catalog",
      candidates: [internalCandidate()],
    });
    const external = createFakeExternalProvider({
      candidates: [externalCandidate()],
    });

    const result = await createProductDiscoveryService([
      internal,
      external,
    ]).search(barcodeRequest());
    const sources = result.candidates[0].sources;

    expect(sources).toHaveLength(2);
    expect(sources.find((source) =>
      source.provider_code === "internal_catalog")?.fields_supported).toEqual([
      "brand_name",
      "product_name",
      "variant_name",
      "barcode",
      "category",
      "subcategory",
      "product_type",
    ]);
    expect(sources.find((source) =>
      source.provider_code === "fake_external")?.fields_supported).toEqual([
      "brand_name",
      "product_name",
      "variant_name",
      "barcode",
      "image_preview_url",
    ]);
  });

  it("treats a missing external brand as unknown rather than a conflict", async () => {
    const internal = createFakeExternalProvider({
      providerCode: "internal_catalog",
      candidates: [internalCandidate()],
    });
    const external = createFakeExternalProvider({
      candidates: [externalCandidate({ brand_name: null })],
    });

    const result = await createProductDiscoveryService([
      internal,
      external,
    ]).search(barcodeRequest());

    expect(result.status).toBe("existing_exact");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].brand_name).toBe("Beauty OS");
    expect(result.candidates[0].conflicts).toEqual([]);
  });

  it("unions supported fields when the same provider record is repeated", async () => {
    const first = externalCandidate({
      sources: [externalSource(["brand_name", "product_name", "barcode"])],
    });
    const second = externalCandidate({
      sources: [externalSource(["variant_name", "image_preview_url"])],
    });
    const external = createFakeExternalProvider({
      candidates: [first, second],
    });

    const result = await createProductDiscoveryService([external]).search(
      barcodeRequest(),
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].sources).toHaveLength(1);
    expect(result.candidates[0].sources[0].fields_supported).toEqual([
      "brand_name",
      "product_name",
      "barcode",
      "variant_name",
      "image_preview_url",
    ]);
  });

  it("does not merge candidates when the same barcode has conflicting variants", async () => {
    const internal = createFakeExternalProvider({
      providerCode: "internal_catalog",
      candidates: [internalCandidate({ variant_name: "30 ml" })],
    });
    const external = createFakeExternalProvider({
      candidates: [externalCandidate({ variant_name: "50 ml" })],
    });

    const result = await createProductDiscoveryService([
      internal,
      external,
    ]).search(barcodeRequest());

    expect(result.status).toBe("conflict");
    expect(result.candidates).toHaveLength(2);
    for (const candidate of result.candidates) {
      expect(candidate.verification_eligibility).toBe("ineligible");
      expect(candidate.conflicts).toContainEqual({
        code: "PRODUCT_DISCOVERY_VARIANT_CONFLICT",
        message: "相同 barcode 的候选产品具有不同 variant。",
        fields: ["barcode", "variant_name"],
      });
    }
  });

  it("keeps successful candidates when a non-critical provider fails", async () => {
    const internal = createFakeExternalProvider({
      providerCode: "internal_catalog",
      candidates: [internalCandidate()],
    });
    const external = createFakeExternalProvider({
      error: new Error("external-secret-sentinel"),
    });

    const result = await createProductDiscoveryService([
      internal,
      external,
    ]).search(barcodeRequest());

    expect(result.status).toBe("existing_exact");
    expect(result.candidates).toHaveLength(1);
    expect(result.provider_results).toContainEqual({
      provider_code: "fake_external",
      status: "failed",
      candidates: [],
      issues: [{
        code: "PRODUCT_DISCOVERY_PROVIDER_UNAVAILABLE",
        message: "fake_external 暂时不可用。",
        fields: [],
      }],
    });
    expect(JSON.stringify(result)).not.toContain("external-secret-sentinel");
  });
});

function barcodeRequest() {
  return {
    schema_version: "product-discovery/v0.1",
    mode: "barcode",
    barcode: "4006381333931",
  } as const;
}

function internalCandidate(
  patch: Partial<ProductDiscoveryCandidate> = {},
): ProductDiscoveryCandidate {
  return baseCandidate({
    candidate_id: "internal:10000000-0000-4000-8000-000000000001",
    candidate_kind: "internal_verified",
    existing_catalog_product_id:
      "10000000-0000-4000-8000-000000000001",
    verification_eligibility: "eligible",
    completeness: 100,
    image_preview_url: null,
    sources: [{
      provider_code: "internal_catalog",
      source_type: "official_brand",
      source_name: "Beauty OS Official",
      source_url: "https://example.com/official-daily-serum",
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
    ...patch,
  });
}

function externalCandidate(
  patch: Partial<ProductDiscoveryCandidate> = {},
): ProductDiscoveryCandidate {
  return baseCandidate({
    candidate_id: "fake_external:4006381333931",
    candidate_kind: "external",
    existing_catalog_product_id: null,
    verification_eligibility: "needs_review",
    completeness: 85,
    image_preview_url: "https://example.com/external-product.jpg",
    sources: [externalSource([
      "brand_name",
      "product_name",
      "variant_name",
      "barcode",
      "image_preview_url",
    ])],
    ...patch,
  });
}

function baseCandidate(
  patch: Partial<ProductDiscoveryCandidate>,
): ProductDiscoveryCandidate {
  return {
    candidate_id: "candidate:4006381333931",
    candidate_kind: "external",
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
    existing_catalog_product_id: null,
    discovery_score: 0,
    match_reason: "barcode_exact",
    verification_eligibility: "needs_review",
    completeness: 80,
    warnings: [],
    conflicts: [],
    sources: [externalSource(["brand_name", "product_name", "barcode"])],
    ...patch,
  };
}

function externalSource(
  fieldsSupported: ProductDiscoveryCandidate["sources"][number]["fields_supported"],
) {
  return {
    provider_code: "fake_external",
    source_type: "open_dataset" as const,
    source_name: "Fake External Dataset",
    source_url: "https://example.com/external/4006381333931",
    retrieved_at: "2026-08-24T01:00:00.000Z",
    license_note: "Test data only",
    authority_level: "open_dataset" as const,
    fields_supported: fieldsSupported,
    raw_record_id: "4006381333931",
    source_quality: 80,
    attribution_required: true,
    image_reuse_note: "Test image only",
  };
}
