import type { UserProductLookupResponse } from "@/schemas/user-product-lookup";
import type { ProductType } from "@/schemas/product";
import type { ProductRecognitionResponse } from "@/schemas/product-recognition";
import type { ProductIdentityClue } from "@/schemas/product-identity-clue";
import type {
  CatalogProductIdentity,
  ExternalProductIdentity,
  ProductIdentityResolution,
} from "@/schemas/product-identity-resolution";

export const DEFAULT_INVENTORY_ADD_STATUS = "active" as const;

export const INVENTORY_ADD_FLOW_STAGES = [
  "lookup",
  "candidate_selection",
  "identity_resolving",
  "asset_setup",
  "unknown_confirmation",
] as const;

export type InventoryAddFlowStage =
  (typeof INVENTORY_ADD_FLOW_STAGES)[number];

export type UserProductLookupCandidate =
  UserProductLookupResponse["candidates"][number];

export type InventoryAddIdentityDraft = {
  brand_name: string;
  product_name: string;
  variant_name: string;
  barcode: string;
};

export type InventoryAddIdentityResolution =
  | {
      resolutionKind: "catalog";
      catalogProductId: string;
    }
  | {
      resolutionKind: "external" | "unknown";
      catalogProductId: null;
      confirmationToken?: string | null;
      confirmationId?: string | null;
    };

export type InventoryAddCandidateSelection = {
  identity: InventoryAddIdentityDraft;
  productType: ProductType | null;
  resolution: InventoryAddIdentityResolution;
};

export type IdentityResolutionRequestContext = {
  clue: ProductIdentityClue;
  recognitionReference: string | null;
};

export type IdentityResolutionContinuation =
  | {
      nextAction: "external_discovery";
      originalRequest: IdentityResolutionRequestContext;
      declinedCatalogProductIds: string[];
    }
  | {
      nextAction: "show_resolved_external_candidates";
      externalLookup: UserProductLookupResponse;
    };

export type CatalogCandidatesUiTransition = {
  stage: "candidate_selection";
  lookupResult: UserProductLookupResponse;
  lookupMessage: string;
};

export function productImageSourceCandidates(
  src: string | null,
  catalogProductId: string | null | undefined,
) {
  return [...new Set([
    ...(src && catalogProductId
      ? [`/api/v1/catalog-products/${catalogProductId}/image`]
      : []),
    ...(src ? [src] : []),
  ])];
}

export function nextProductImageSource(
  src: string | null,
  catalogProductId: string | null | undefined,
  failedSources: readonly string[],
) {
  const failed = new Set(failedSources);
  return productImageSourceCandidates(src, catalogProductId)
    .find((candidate) => !failed.has(candidate)) ?? null;
}

export function catalogIdentityToLookupCandidate(
  identity: CatalogProductIdentity,
): UserProductLookupCandidate {
  return {
    brand_name: identity.brand_name,
    product_name: identity.product_name,
    variant_name: identity.variant_name,
    barcode: identity.barcode,
    image_preview_url: identity.catalog_image_url,
    candidate_kind: "catalog",
    candidate_source: "catalog",
    catalog_product_id: identity.catalog_product_id,
    suggested_product_type: identity.product_type,
    requires_confirmation: true,
    confirmation_token: null,
    confirmation_id: null,
  };
}

export function catalogCandidatesUiTransition(
  resolution: Extract<ProductIdentityResolution, { status: "catalog_candidates" }>,
): CatalogCandidatesUiTransition {
  if (resolution.candidates.length === 0) {
    throw new Error("CATALOG_CANDIDATES_UI_INVARIANT_VIOLATION");
  }

  const candidates = resolution.candidates.map(catalogIdentityToLookupCandidate);
  if (candidates.length === 0) {
    throw new Error("CATALOG_CANDIDATES_UI_MAPPING_FAILED");
  }

  return {
    stage: "candidate_selection",
    lookupResult: {
      lookup_status: "multiple_candidates",
      candidates,
    },
    lookupMessage: "找到知识库中可能对应的产品，请确认是否为同一款。",
  };
}

export function externalIdentityToLookupCandidate(
  identity: ExternalProductIdentity,
): UserProductLookupCandidate {
  return {
    brand_name: identity.brand_name,
    product_name: identity.product_name,
    variant_name: identity.variant_name,
    barcode: identity.barcode,
    // External discovery images are not accepted as canonical product images.
    image_preview_url: null,
    candidate_kind: "external",
    candidate_source: "external",
    catalog_product_id: null,
    suggested_product_type: identity.product_type,
    requires_confirmation: true,
    confirmation_token: identity.confirmation_token,
    confirmation_id: identity.confirmation_id,
    source_reference: {
      provider: identity.source_reference.provider,
      display_name: identity.source_reference.display_name,
      url: identity.source_reference.url,
    },
  };
}

export function identityResolutionContinuation(
  resolution: ProductIdentityResolution,
  originalRequest: IdentityResolutionRequestContext,
): IdentityResolutionContinuation | null {
  if (resolution.status === "matched") {
    return {
      nextAction: "external_discovery",
      originalRequest,
      declinedCatalogProductIds: [resolution.catalog_product_id],
    };
  }
  if (resolution.status !== "catalog_candidates") return null;
  if (resolution.fallback_external_candidates.length > 0) {
    const candidates = resolution.fallback_external_candidates.map(
      externalIdentityToLookupCandidate,
    );
    return {
      nextAction: "show_resolved_external_candidates",
      externalLookup: {
        lookup_status: candidates.length === 1
          ? "external_candidate"
          : "multiple_candidates",
        candidates,
      },
    };
  }
  return {
    nextAction: "external_discovery",
    originalRequest,
    declinedCatalogProductIds: resolution.candidates.map(
      (candidate) => candidate.catalog_product_id,
    ),
  };
}

export function pendingAssetFallbackForResolution(
  resolution: ProductIdentityResolution,
): {
  message: string;
  identityPatch: Partial<InventoryAddIdentityDraft>;
} | null {
  if (resolution.status !== "unknown" && resolution.status !== "unavailable") {
    return null;
  }
  return {
    message: resolution.status === "unavailable"
      ? PUBLIC_PRODUCT_INFO_UNAVAILABLE_MESSAGE
      : "暂未找到明确产品信息。可以创建待识别资产。",
    identityPatch: {
      brand_name: resolution.observed_identity.brand_name ?? "",
      product_name: resolution.observed_identity.product_name ?? "",
      barcode: resolution.observed_identity.barcode ?? "",
    },
  };
}

export const PUBLIC_PRODUCT_INFO_UNAVAILABLE_MESSAGE =
  "公开产品信息查询暂时不可用，请确认包装上的产品信息。";

export function candidateToInventoryAddSelection(
  candidate: UserProductLookupCandidate,
): InventoryAddCandidateSelection {
  const resolution = candidateResolution(candidate);

  return {
    identity: {
      brand_name: candidate.brand_name ?? "",
      product_name: candidate.product_name,
      variant_name: candidate.variant_name ?? "",
      barcode: candidate.barcode ?? "",
    },
    productType: candidate.suggested_product_type,
    resolution,
  };
}

export function recognitionToLookupResponse(
  result: ProductRecognitionResponse,
): UserProductLookupResponse {
  const candidates = result.candidates.map((candidate) => ({
    brand_name: candidate.brand_name,
    product_name: candidate.product_name ?? "",
    variant_name: null,
    barcode: null,
    image_preview_url: null,
    candidate_kind: "external" as const,
    candidate_source: "ai" as const,
    catalog_product_id: null,
    suggested_product_type: null,
    confirmation_token: null,
    confirmation_id: null,
    requires_confirmation: true,
  }));

  return {
    lookup_status: candidates.length === 0
      ? "no_match"
      : candidates.length === 1
        ? "external_candidate"
        : "multiple_candidates",
    candidates,
  };
}

export function unknownIdentityResolution(): InventoryAddIdentityResolution {
  return { resolutionKind: "unknown", catalogProductId: null, confirmationToken: null, confirmationId: null };
}

export function canCreateUserAsset(
  stage: InventoryAddFlowStage | null,
  resolution: InventoryAddIdentityResolution | null,
) {
  return stage === "asset_setup" && resolution !== null;
}

/**
 * Keeps a type supplied by product discovery. When discovery cannot provide
 * one, only classify terms whose product form is explicit in the user's
 * natural-language clue. This is deliberately conservative: a missing or
 * ambiguous signal remains `other` instead of becoming a guessed type.
 */
export function resolveInventoryProductType(
  identity: InventoryAddIdentityDraft,
  suggestedProductType: ProductType | null,
): ProductType {
  return suggestedProductType ?? inferProductTypeFromIdentity(identity) ?? "other";
}

export function buildIdentityPersistenceFields(
  identity: InventoryAddIdentityDraft,
  resolution: InventoryAddIdentityResolution,
) {
  return {
    resolution_kind: resolution.resolutionKind,
    brand_name: identity.brand_name.trim() || null,
    product_name: identity.product_name.trim(),
    variant_name: identity.variant_name.trim() || null,
    barcode: identity.barcode.trim() || null,
    catalog_product_id: resolution.catalogProductId,
  };
}

function candidateResolution(
  candidate: UserProductLookupCandidate,
): InventoryAddIdentityResolution {
  if (candidate.candidate_kind === "catalog") {
    if (!candidate.catalog_product_id) {
      throw new Error("CATALOG_CANDIDATE_ID_REQUIRED");
    }
    return {
      resolutionKind: "catalog",
      catalogProductId: candidate.catalog_product_id,
    };
  }

  return {
    resolutionKind: "external",
    catalogProductId: null,
    confirmationToken: candidate.confirmation_token,
    confirmationId: candidate.confirmation_id,
  };
}

function inferProductTypeFromIdentity(
  identity: InventoryAddIdentityDraft,
): ProductType | null {
  const clue = `${identity.product_name} ${identity.variant_name}`.toLowerCase();

  const explicitProductTypes: Array<[ProductType, RegExp]> = [
    ["makeup_remover", /卸妆|makeup\s*remover/],
    ["cleanser", /洁面|洗面奶|洗脸|cleanser/],
    ["toner", /爽肤水|化妆水|柔肤水|toner/],
    ["essence", /精粹水|精华水|essence\s*(water|lotion)/],
    ["serum", /精华(?!水)|serum/],
    ["moisturizer", /面霜|修复霜|保湿霜|乳液|moisturi[sz](er|ing)\s*cream/],
    ["sunscreen", /防晒|sunscreen|sun\s*screen/],
    ["mask", /面膜|mask/],
    ["eye_care", /眼霜|眼部|eye\s*cream/],
    ["lip_care", /润唇|唇膜|lip\s*(balm|mask)/],
    ["foundation", /粉底液|粉底霜|foundation/],
    ["concealer", /遮瑕|concealer/],
    ["powder", /散粉|粉饼|蜜粉|powder/],
    ["blush", /腮红|blush/],
    ["eyeshadow", /眼影|eyeshadow/],
    ["eyeliner", /眼线|eyeliner/],
    ["mascara", /睫毛膏|mascara/],
    ["lip_color", /口红|唇釉|唇彩|lipstick|lip\s*gloss/],
    ["shampoo", /洗发水|洗发露|shampoo/],
    ["conditioner", /护发素|conditioner/],
    ["perfume", /香水|perfume/],
  ];

  return explicitProductTypes.find(([, pattern]) => pattern.test(clue))?.[0] ?? null;
}
