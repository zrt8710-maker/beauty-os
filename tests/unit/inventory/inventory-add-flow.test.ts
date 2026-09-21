import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  canCreateUserAsset,
  buildIdentityPersistenceFields,
  catalogCandidatesUiTransition,
  catalogIdentityToLookupCandidate,
  candidateToInventoryAddSelection,
  DEFAULT_INVENTORY_ADD_STATUS,
  identityResolutionContinuation,
  INVENTORY_ADD_FLOW_STAGES,
  pendingAssetFallbackForResolution,
  PUBLIC_PRODUCT_INFO_UNAVAILABLE_MESSAGE,
  recognitionToLookupResponse,
  resolveInventoryProductType,
  unknownIdentityResolution,
  type UserProductLookupCandidate,
} from "@/features/inventory/inventory-add-flow";
import { productIdentityResolutionSchema } from "@/schemas/product-identity-resolution";

describe("inventory add flow", () => {
  it("defaults a newly added asset to active", () => {
    expect(DEFAULT_INVENTORY_ADD_STATUS).toBe("active");
  });

  it("does not expose opening state in the Inventory UI", async () => {
    const source = await readFile(
      path.join(process.cwd(), "src/features/inventory/inventory-manager.tsx"),
      "utf8",
    );
    expect(source).not.toContain("未开封");
  });

  it("maps a catalog candidate to a catalog-linked confirmation draft", () => {
    expect(candidateToInventoryAddSelection(candidate({
      candidate_kind: "catalog",
      catalog_product_id: "10000000-0000-4000-8000-000000000001",
      suggested_product_type: "serum",
    }))).toEqual({
      identity: {
        brand_name: "Beauty OS",
        product_name: "Daily Serum",
        variant_name: "30 ml",
        barcode: "4006381333931",
      },
      productType: "serum",
      resolution: {
        resolutionKind: "catalog",
        catalogProductId: "10000000-0000-4000-8000-000000000001",
      },
    });
  });

  it("projects an existing Catalog image into the confirmation candidate and preserves the no-image placeholder state", () => {
    const identity = {
      catalog_product_id: "a9aa26bb-1320-424e-a0a2-9ca0684acb99",
      brand_name: "珀莱雅",
      product_name: "珀莱雅双抗精华2.0",
      variant_name: "2.0",
      barcode: null,
      category: "skincare" as const,
      subcategory: "face_care" as const,
      product_type: "serum" as const,
      catalog_image_url: "https://images.example/proya.jpg",
    };

    expect(catalogIdentityToLookupCandidate(identity).image_preview_url).toBe("https://images.example/proya.jpg");
    expect(catalogIdentityToLookupCandidate({ ...identity, catalog_image_url: null }).image_preview_url).toBeNull();
  });

  it("never links an external candidate to catalog", () => {
    expect(candidateToInventoryAddSelection(candidate({
      candidate_kind: "external",
      catalog_product_id: null,
      suggested_product_type: null,
    }))).toMatchObject({
      productType: null,
      resolution: {
        resolutionKind: "external",
        catalogProductId: null,
      },
    });
  });

  it("reveals the signed external candidate only after existing Catalog candidates are declined", () => {
    const externalCandidate = {
        brand_name: "城野医生（Dr.Ci:Labo）",
        product_name: "Labo Labo毛孔细致焕活精华水",
        variant_name: "100ml",
        barcode: null,
        product_type: null,
        image_url: "https://images.example/external.jpg",
        image_source_url: "https://example.com/product",
        source_reference: {
          provider: "agent2",
          display_name: "公开产品来源",
          source_name: "公开产品来源",
          url: "https://example.com/product",
        },
        confirmation_token: "t".repeat(32),
        confirmation_id: "10000000-0000-4000-8000-000000000001",
      } as const;
    const continuation = identityResolutionContinuation({
      status: "catalog_candidates",
      source: "beauty_os_catalog",
      candidates: [catalogIdentity()],
      fallback_external_candidates: [externalCandidate],
    }, identityRequest());

    expect(continuation).toMatchObject({
      nextAction: "show_resolved_external_candidates",
      externalLookup: {
        lookup_status: "external_candidate",
        candidates: [{
          candidate_kind: "external",
          product_name: "Labo Labo毛孔细致焕活精华水",
          confirmation_token: "t".repeat(32),
          image_preview_url: null,
        }],
      },
    });
  });

  it("gives pre-discovery Catalog candidates one explicit external-discovery continuation", () => {
    expect(identityResolutionContinuation({
      status: "catalog_candidates",
      source: "beauty_os_catalog",
      candidates: [catalogIdentity()],
      fallback_external_candidates: [],
    }, identityRequest())).toEqual({
      nextAction: "external_discovery",
      originalRequest: identityRequest(),
      declinedCatalogProductIds: ["1c101680-836a-4fa7-aff2-f0873ac20d10"],
    });
  });

  it("only offers pending-asset fallback for unknown or unavailable resolution outcomes", () => {
    const observed_identity = {
      brand_name: "薇诺娜",
      product_name: "不存在的新品",
      variant_name: null,
      barcode: null,
    };

    expect(pendingAssetFallbackForResolution({
      status: "unavailable",
      observed_identity,
      failure_kind: "http_error",
    })).toMatchObject({ message: PUBLIC_PRODUCT_INFO_UNAVAILABLE_MESSAGE });
    expect(pendingAssetFallbackForResolution({
      status: "catalog_candidates",
      source: "beauty_os_catalog",
      candidates: [{
        catalog_product_id: "1c101680-836a-4fa7-aff2-f0873ac20d10",
        brand_name: "薇诺娜",
        product_name: "清痘修复精华液",
        variant_name: null,
        barcode: null,
        category: "skincare",
        subcategory: "face_care",
        product_type: "treatment",
        catalog_image_url: "https://cdn.example/winona.webp",
      }],
      fallback_external_candidates: [],
    })).toBeNull();
  });

  it("routes an HTTP 200 Winona Catalog candidate response to the existing-product card state", async () => {
    const response = new Response(JSON.stringify({
      data: {
        status: "catalog_candidates",
        source: "beauty_os_catalog",
        candidates: [catalogIdentity()],
        fallback_external_candidates: [],
      },
    }), { status: 200 });

    expect(response.ok).toBe(true);
    const envelope = await response.json() as { data: unknown };
    const resolution = productIdentityResolutionSchema.parse(envelope.data);
    expect(resolution.status).toBe("catalog_candidates");
    if (resolution.status !== "catalog_candidates") throw new Error("unexpected fixture");

    const transition = catalogCandidatesUiTransition(resolution);

    expect(transition).toMatchObject({
      stage: "candidate_selection",
      lookupMessage: "找到知识库中可能对应的产品，请确认是否为同一款。",
      lookupResult: {
        lookup_status: "multiple_candidates",
        candidates: [{
          candidate_kind: "catalog",
          brand_name: "薇诺娜",
          product_name: "清痘修复精华液",
          catalog_product_id: "1c101680-836a-4fa7-aff2-f0873ac20d10",
          image_preview_url: "https://cdn.example/winona.webp",
        }],
      },
    });
    expect(pendingAssetFallbackForResolution(resolution)).toBeNull();
    expect(JSON.stringify(transition)).not.toContain(PUBLIC_PRODUCT_INFO_UNAVAILABLE_MESSAGE);
  });

  it("keeps an externally supplied type without a catalog link", () => {
    const selection = candidateToInventoryAddSelection(candidate({
      candidate_kind: "external",
      catalog_product_id: null,
      suggested_product_type: "serum",
    }));

    expect(resolveInventoryProductType(selection.identity, selection.productType)).toBe("serum");
    expect(selection.resolution).toMatchObject({
      resolutionKind: "external",
      catalogProductId: null,
    });
  });

  it("only derives a type from explicit natural-language product clues", () => {
    expect(resolveInventoryProductType({
      brand_name: "兰蔻",
      product_name: "小黑瓶肌底精华",
      variant_name: "",
      barcode: "",
    }, null)).toBe("serum");
    expect(resolveInventoryProductType({
      brand_name: "理肤泉",
      product_name: "B5 修复霜",
      variant_name: "",
      barcode: "",
    }, null)).toBe("moisturizer");
    expect(resolveInventoryProductType({
      brand_name: "未知品牌",
      product_name: "旅行装",
      variant_name: "",
      barcode: "",
    }, null)).toBe("other");
  });

  it("adapts recognition candidates for the existing identity confirmation flow", () => {
    expect(recognitionToLookupResponse({
      status: "candidates",
      candidates: [{
        brand_name: "兰蔻",
        product_name: "小黑瓶肌底精华",
        recognition_reference: null,
        confidence: 80,
        observed_text: [{ value: "小黑瓶肌底精华", type: "product_name" }],
      }],
    })).toMatchObject({
      lookup_status: "external_candidate",
      candidates: [{
        candidate_kind: "external",
        catalog_product_id: null,
        image_preview_url: null,
        suggested_product_type: null,
        requires_confirmation: true,
      }],
    });
  });

  it("models every identity-first stage explicitly", () => {
    expect(INVENTORY_ADD_FLOW_STAGES).toEqual([
      "lookup",
      "candidate_selection",
      "identity_resolving",
      "asset_setup",
      "unknown_confirmation",
    ]);
  });

  it("cannot produce a matched resolution from the unknown path", () => {
    expect(unknownIdentityResolution()).toMatchObject({
      resolutionKind: "unknown",
      catalogProductId: null,
    });
  });

  it.each([
    [{ resolutionKind: "catalog", catalogProductId: "10000000-0000-4000-8000-000000000001" }],
    [{ resolutionKind: "external", catalogProductId: null }],
    [{ resolutionKind: "unknown", catalogProductId: null }],
  ] as const)("builds the $resolutionKind persistence contract without identity_status", (
    resolution,
  ) => {
    const fields = buildIdentityPersistenceFields({
      brand_name: " Beauty OS ",
      product_name: " Daily Serum ",
      variant_name: " 30 ml ",
      barcode: " 4006381333931 ",
    }, resolution);

    expect(fields).toEqual({
      resolution_kind: resolution.resolutionKind,
      brand_name: "Beauty OS",
      product_name: "Daily Serum",
      variant_name: "30 ml",
      barcode: "4006381333931",
      catalog_product_id: resolution.catalogProductId,
    });
    expect(fields).not.toHaveProperty("identity_status");
  });

  it("only enables asset creation after an explicit transition to personal setup", () => {
    const external = { resolutionKind: "external", catalogProductId: null } as const;
    const unknown = unknownIdentityResolution();

    expect(canCreateUserAsset("candidate_selection", external)).toBe(false);
    expect(canCreateUserAsset("unknown_confirmation", unknown)).toBe(false);
    expect(canCreateUserAsset("asset_setup", external)).toBe(true);
    expect(canCreateUserAsset("asset_setup", unknown)).toBe(true);
  });
});

function catalogIdentity() {
  return {
    catalog_product_id: "1c101680-836a-4fa7-aff2-f0873ac20d10",
    brand_name: "薇诺娜",
    product_name: "清痘修复精华液",
    variant_name: null,
    barcode: null,
    category: "skincare" as const,
    subcategory: "face_care" as const,
    product_type: "treatment" as const,
    catalog_image_url: "https://cdn.example/winona.webp",
  };
}

function identityRequest() {
  return {
    clue: {
      source: "manual_search" as const,
      raw_query: "清痘精华液",
      brand_name: "薇诺娜",
      product_name: "清痘精华液",
      recognition_confidence: null,
      observed_text: [],
    },
    recognitionReference: null,
  };
}

function candidate(
  patch: Partial<UserProductLookupCandidate> = {},
): UserProductLookupCandidate {
  return {
    brand_name: "Beauty OS",
    product_name: "Daily Serum",
    variant_name: "30 ml",
    barcode: "4006381333931",
    image_preview_url: null,
    candidate_kind: "external",
    candidate_source: "external",
    catalog_product_id: null,
    suggested_product_type: null,
    requires_confirmation: true,
    confirmation_token: null,
    confirmation_id: null,
    ...patch,
  };
}
