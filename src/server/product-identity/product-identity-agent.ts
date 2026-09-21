import "server-only";

import {
  productIdentityResolutionSchema,
  type ObservedProductIdentity,
  type ProductIdentityResolution,
} from "@/schemas/product-identity-resolution";
import {
  productIdentityClueSchema,
  type ProductIdentityClue,
} from "@/schemas/product-identity-clue";
import type {
  ExternalProductDiscoveryProvider,
  InternalCatalogIdentityProvider,
} from "./product-identity-provider";
import type { ProductSearchProvider } from "@/server/product-search/product-search-provider";
import { productIdentityDebug } from "./identity-research-debug";
import type { ProductIdentityTimingReporter } from "./identity-research-debug";
import { ExternalProductDiscoveryUnavailableError } from "./agent-plan-external-discovery-provider";

export type ProductIdentityAgent = {
  resolve(
    input: unknown,
    options?: { declinedCatalogProductIds?: string[]; timingReporter?: ProductIdentityTimingReporter },
  ): Promise<ProductIdentityResolution>;
};

export function createProductIdentityAgent(
  internalCatalog: InternalCatalogIdentityProvider,
  externalDiscovery: ExternalProductDiscoveryProvider,
  searchProvider: ProductSearchProvider | null = null,
): ProductIdentityAgent {
  return {
    async resolve(input, options = {}) {
      const totalStartedAt = Date.now();
      const clue = productIdentityClueSchema.parse(input);
      const observedIdentity = observedIdentityFromClue(clue);
      productIdentityDebug("Identity Clue", {
        source: clue.source,
        brand_name: observedIdentity.brand_name,
        product_name: observedIdentity.product_name,
      });

      if (!hasSufficientIdentityEvidence(clue, observedIdentity)) {
        productIdentityDebug("Identity Validation", {
          candidate_received: false,
          decision: "reject",
          reject_reason: "insufficient_identity_evidence",
        });
        return productIdentityResolutionSchema.parse({
          status: "unknown",
          observed_identity: observedIdentity,
          reason: "insufficient_identity_evidence",
        });
      }

      const catalogStartedAt = Date.now();
      const internal = await internalCatalog.resolve(observedIdentity);
      const declinedCatalogProductIds = new Set(options.declinedCatalogProductIds ?? []);
      productIdentityDebug("Internal Catalog", {
        called: true,
        status: internal.status,
        result_count: internal.status === "matched" ? 1 : internal.status === "catalog_candidates" ? internal.candidates.length : 0,
        elapsed_ms: Date.now() - catalogStartedAt,
      });
      options.timingReporter?.({
        stage: "internal_catalog_total",
        elapsed_ms: Date.now() - catalogStartedAt,
      });
      if (internal.status === "matched" && !declinedCatalogProductIds.has(internal.candidate.catalog_product_id)) {
        return productIdentityResolutionSchema.parse({ status: "matched", source: "beauty_os_catalog", catalog_product_id: internal.candidate.catalog_product_id, product_identity: internal.candidate, match_method: internal.match_method });
      }
      if (internal.status === "catalog_candidates") {
        const candidates = internal.candidates.filter((candidate) =>
          !declinedCatalogProductIds.has(candidate.catalog_product_id)
        );
        if (candidates.length > 0) {
          return productIdentityResolutionSchema.parse({ status: "catalog_candidates", source: "beauty_os_catalog", candidates, fallback_external_candidates: [] });
        }
      }

      const searchResults = await findExternalSearchLeads(searchProvider, observedIdentity, clue);
      const discoveryStartedAt = Date.now();
      let candidates;
      try { candidates = await externalDiscovery.discover({ clue, search_results: searchResults }); } catch (error) {
        if (error instanceof ExternalProductDiscoveryUnavailableError) {
          options.timingReporter?.({
            stage: "agent2_discovery",
            elapsed_ms: Date.now() - discoveryStartedAt,
          });
          productIdentityDebug("External Discovery", { discovery_status: "unavailable", failure_kind: "provider_unavailable", elapsed_ms: Date.now() - discoveryStartedAt });
          return productIdentityResolutionSchema.parse({ status: "unavailable", observed_identity: observedIdentity, failure_kind: "unknown" });
        }
        throw error;
      }
      productIdentityDebug("External Discovery", {
        result_count: candidates.length,
        elapsed_ms: Date.now() - discoveryStartedAt,
        total_elapsed_ms: Date.now() - totalStartedAt,
      });
      options.timingReporter?.({
        stage: "agent2_discovery",
        elapsed_ms: Date.now() - discoveryStartedAt,
      });
      if (candidates.length > 0 && internalCatalog.reconcileExternal) {
        const reconciliationStartedAt = Date.now();
        const existingCandidates = (await internalCatalog.reconcileExternal(observedIdentity, candidates))
          .filter((candidate) => !declinedCatalogProductIds.has(candidate.catalog_product_id));
        productIdentityDebug("Post-Discovery Catalog Reconciliation", {
          called: true,
          result_count: existingCandidates.length,
        });
        options.timingReporter?.({
          stage: "post_discovery_reconciliation",
          elapsed_ms: Date.now() - reconciliationStartedAt,
        });
        if (existingCandidates.length > 0) {
          return productIdentityResolutionSchema.parse({
            status: "catalog_candidates",
            source: "beauty_os_catalog",
            candidates: existingCandidates,
            fallback_external_candidates: candidates,
          });
        }
      }
      return candidates.length > 0
        ? productIdentityResolutionSchema.parse({
            status: "external_candidate",
            source: "external_discovery",
            candidates,
          })
        : productIdentityResolutionSchema.parse({
            status: "unknown",
            observed_identity: observedIdentity,
            reason: "no_product_match",
          });
    },
  };
}

async function findExternalSearchLeads(
  provider: ProductSearchProvider | null,
  identity: ObservedProductIdentity,
  clue: ProductIdentityClue,
) {
  if (!provider || identity.product_name === null) return [];
  try {
    const results = await provider.search({
      brand: identity.brand_name,
      product_name: identity.product_name,
      variant_name: null,
    });
    productIdentityDebug("External Search Leads", {
      provider_code: provider.providerCode,
      source: clue.source,
      result_count: results.length,
    });
    return results;
  } catch (error) {
    productIdentityDebug("External Search Leads", {
      provider_code: provider.providerCode,
      source: clue.source,
      result_count: 0,
      failure_kind: error instanceof Error ? error.message.slice(0, 120) : "unknown",
    });
    // Agent-Plan web_search remains the safe supplemental fallback.
    return [];
  }
}

function observedIdentityFromClue(clue: ProductIdentityClue): ObservedProductIdentity {
  const separated = clue.source === "manual_search" && clue.brand_name === null
    ? splitSeparatedIdentity(clue.raw_query)
    : null;
  return {
    brand_name: separated?.brand_name ?? clue.brand_name,
    product_name: separated?.product_name ?? clue.product_name,
    variant_name: null,
    barcode: observedBarcode(clue),
  };
}

function observedBarcode(clue: ProductIdentityClue) {
  const value = clue.observed_text.find((item) => item.type === "barcode")?.value?.trim() ?? null;
  return value !== null && /^\d{8,32}$/u.test(value) ? value : null;
}

function hasSufficientIdentityEvidence(
  clue: ProductIdentityClue,
  identity: ObservedProductIdentity,
) {
  if (identity.product_name === null) return false;
  return clue.source === "manual_search" || identity.brand_name !== null;
}

function splitSeparatedIdentity(query: string) {
  const match = query.trim().match(/^(.+?)(?:[：:|/])(.+)$/u);
  if (!match) return null;
  const brandName = match[1].trim();
  const productName = match[2].trim();
  return brandName && productName
    ? { brand_name: brandName, product_name: productName }
    : null;
}
