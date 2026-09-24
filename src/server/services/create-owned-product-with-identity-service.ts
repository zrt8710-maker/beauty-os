import "server-only";

import {
  createOwnedProductWithIdentitySchema,
  type CreateOwnedProductWithIdentityInput,
} from "@/schemas/product-identity";
import {
  PRODUCT_TYPE_META,
  productCreateSchema,
  type OwnedProduct,
} from "@/schemas/product";
import type { OwnedProductIdentityRepository } from "@/server/repositories/owned-product-identity-repository";
import { toOwnedProduct } from "@/server/services/inventory-service";
import { resolveOwnedProductImage } from "@/server/services/upload-service";
import type { ProductIdentityMatcher } from "@/server/services/product-identity-matching-service";
import { verifyRecognitionConfirmationToken } from "@/server/product-recognition/recognition-confirmation-token";
import type { IdentityReconciliationContext } from "@/server/product-recognition/recognition-confirmation-token";
import { ownedProductCreateDebug } from "@/server/owned-products/owned-product-create-debug";
import type { OwnedProductCreateTimingReporter } from "@/server/owned-products/owned-product-create-debug";
import type { ConfirmedCatalogCandidateRepository } from "@/server/repositories/confirmed-catalog-candidate-repository";
import type { ProductResearchInput } from "@/schemas/product-research";

export class CatalogIdentityMismatchError extends Error {
  readonly code = "CATALOG_IDENTITY_MISMATCH";

  constructor() {
    super("CATALOG_IDENTITY_MISMATCH");
    this.name = "CatalogIdentityMismatchError";
  }
}

export type CreateOwnedProductWithIdentityService = {
  create(userId: string, input: unknown): Promise<OwnedProduct>;
};

export function createOwnedProductWithIdentityService(
  matcher: ProductIdentityMatcher,
  repository: OwnedProductIdentityRepository,
  confirmedCatalogCandidates?: ConfirmedCatalogCandidateRepository,
  onExternalCandidateBound?: (input: ProductResearchInput, created: boolean) => Promise<void>,
  timingReporter?: OwnedProductCreateTimingReporter,
): CreateOwnedProductWithIdentityService {
  return {
    async create(userId, input) {
      const validated = createOwnedProductWithIdentitySchema.parse(input);

      let discoveryMetadata: {
          aliases: string[];
          confidence: number;
          sources: Array<{ url: string; title: string | null; source_type: string | null }>;
          uncertainties: string[];
        } | undefined;
      let reconciliationContext: IdentityReconciliationContext | null = null;
      if (validated.resolution_kind === "external") {
        try {
          const confirmedIdentity = verifyRecognitionConfirmationToken(
            validated.confirmation_token!,
            userId,
            validated,
            validated.idempotency_key,
          );
          discoveryMetadata = confirmedIdentity.discovery_metadata;
          reconciliationContext = confirmedIdentity.reconciliation_context;
        } catch (error) {
          ownedProductCreateDebug({
            create_stage: "confirmation_token_invalid",
            resolution_kind: validated.resolution_kind,
            token_validation_status: "invalid",
            idempotency_key_present: Boolean(validated.idempotency_key),
          });
          throw error;
        }
      }

      if (validated.resolution_kind === "catalog") {
        const backstopStartedAt = performance.now();
        try {
          await assertCatalogCandidate(matcher, validated);
        } finally {
          timingReporter?.({ stage: "catalog_backstop", elapsed_ms: Math.round(performance.now() - backstopStartedAt) });
        }
      } else {
        productCreateSchema.parse({
          brand_name: validated.brand_name,
          product_name: validated.product_name,
          category: validated.category,
          product_type: validated.product_type,
        });
      }

      // This runs only after the signed confirmation has been validated. It is
      // deliberately separate from the owned-product write and never marks a
      // discovered identity verified.
      let catalogProductId = validated.catalog_product_id;
      let externalCandidateCreated = false;
      const variantEvidence = validated.resolution_kind === "external"
        ? durableExternalVariantEvidence(
            validated.variant_name,
            validated.barcode,
            discoveryMetadata,
          )
        : null;
      const durableVariantName = validated.resolution_kind === "external"
        && validated.variant_name
        && !variantEvidence
          ? null
          : validated.variant_name;
      if (validated.resolution_kind === "external" && confirmedCatalogCandidates) {
        const bindingStartedAt = performance.now();
        try {
          const resolved = await confirmedCatalogCandidates.findOrCreate({
            brand_name: validated.brand_name,
            product_name: validated.product_name,
            variant_name: validated.variant_name,
            barcode: validated.barcode,
            confidence: discoveryMetadata?.confidence ?? 0,
            variant_evidence: variantEvidence,
            aliases: discoveryMetadata?.aliases ?? [],
            product_type: validated.product_type,
            original_identity: reconciliationContext
              ? {
                  brand_name: reconciliationContext.original_brand_name,
                  product_name: reconciliationContext.original_product_name,
                }
              : null,
          });
          catalogProductId = resolved.catalogProductId;
          externalCandidateCreated = resolved.created;
        } finally {
          timingReporter?.({ stage: "external_catalog_binding", elapsed_ms: Math.round(performance.now() - bindingStartedAt) });
        }
      }

      const row = await repository.create(userId, {
        ...validated,
        // External discovery wording is not durable identity evidence. Keep a
        // version only when deterministic evidence survived confirmation.
        variant_name: durableVariantName,
        // A confirmed external identity remains external, but its private
        // product is anchored to the candidate Catalog row created above.
        catalog_product_id: catalogProductId,
        subcategory: PRODUCT_TYPE_META[validated.product_type].subcategory,
      });
      if (catalogProductId && validated.resolution_kind === "external" && onExternalCandidateBound) {
        // This only registers durable Catalog-scoped work. The user never waits
        // for Agent3, and Internal Catalog matches never reach this branch.
        try {
          await onExternalCandidateBound({
            catalog_product_id: catalogProductId,
            brand_name: validated.brand_name ?? "Unknown brand",
            product_name: validated.product_name,
            variant_name: durableVariantName,
            barcode: validated.barcode,
            aliases: discoveryMetadata?.aliases ?? [],
            identity_sources: discoveryMetadata?.sources ?? [],
            search_results: [],
          }, externalCandidateCreated);
        } catch (error) {
          // A periodic backfill repairs a missed enqueue after the asset save.
          console.error("PRODUCT_RESEARCH_JOB_ENQUEUE_FAILED", {
            created: externalCandidateCreated,
            error: error instanceof Error ? error.message : "unknown",
          });
        }
      }
      return resolveOwnedProductImage(toOwnedProduct(row), []);
    },
  };
}

export function durableExternalVariantEvidence(
  variantName: string | null,
  barcode: string | null,
  metadata: {
    sources: Array<{ url: string; title: string | null; source_type: string | null }>;
    uncertainties: string[];
  } | undefined,
): "barcode" | "official_product" | "packaging_observed" | "multi_source" | null {
  if (!variantName) return null;
  if (barcode) return "barcode";
  if (!metadata || metadata.uncertainties.some((item) =>
    /variant|version|generation|sku|版本|版型|代际|第[一二三四五六七八九十\d]+代|\d+\.\d+/iu.test(item)
  )) return null;

  const variant = normalizeIdentityEvidenceText(variantName);
  const supporting = metadata.sources.filter((source) =>
    source.title && normalizeIdentityEvidenceText(source.title).includes(variant)
  );
  if (supporting.some((source) => /package|packaging|包装|实物标签|瓶身/iu.test(source.source_type ?? ""))) {
    return "packaging_observed";
  }
  if (supporting.some((source) => /official|brand_owner|official_product|官网|品牌方|品牌官方/iu.test(source.source_type ?? ""))) {
    return "official_product";
  }
  const independentlyAuthoritative = new Set(supporting
    .filter((source) => /regulatory|备案|package|packaging|包装|official|官网|品牌方/iu.test(source.source_type ?? ""))
    .map((source) => source.url.toLocaleLowerCase("en-US")));
  return independentlyAuthoritative.size >= 2 ? "multi_source" : null;
}

function normalizeIdentityEvidenceText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\p{P}\p{S}\s]+/gu, "");
}

async function assertCatalogCandidate(
  matcher: ProductIdentityMatcher,
  input: CreateOwnedProductWithIdentityInput,
) {
  const match = await matcher.match({
    brand_name: input.brand_name,
    product_name: input.product_name,
    barcode: input.barcode,
    category: input.category,
    product_type: input.product_type,
  });

  if (
    !match.candidates.some(
      (candidate) =>
        candidate.catalog_product_id === input.catalog_product_id,
    )
  ) {
    throw new CatalogIdentityMismatchError();
  }
}
