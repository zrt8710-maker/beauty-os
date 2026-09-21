import "server-only";

import type { CatalogProductIdentity } from "@/schemas/product-identity-resolution";
import type { ProductIdentityMatcher } from "@/server/services/product-identity-matching-service";
import type { InternalCatalogIdentityProvider } from "./product-identity-provider";

export function createInternalCatalogIdentityProvider(
  matcher: ProductIdentityMatcher,
): InternalCatalogIdentityProvider {
  return {
    providerCode: "beauty_os_catalog",
    async resolve(identity) {
      if (identity.brand_name === null && identity.product_name !== null) {
        const search = await matcher.searchByText?.(identity.product_name);
        if (search && search.candidates.length === 1 && search.exact) {
          return {
            status: "matched",
            candidate: toCatalogIdentity(search.candidates[0]),
            match_method: "brand_product_exact",
          };
        }
        if (search && search.candidates.length > 0) {
          return {
            status: "catalog_candidates",
            candidates: search.candidates.map(toCatalogIdentity),
          };
        }
      }
      const result = await (matcher.recallForConfirmation ?? matcher.match)({
        brand_name: identity.brand_name,
        product_name: identity.product_name,
        barcode: identity.barcode,
      });
      const candidates = result.candidates.map(toCatalogIdentity);

      if (result.status === "candidate" && candidates.length === 1) {
        return {
          status: "matched",
          candidate: candidates[0],
          match_method: result.match_reason === "barcode_exact"
            ? "barcode_exact"
            : "brand_product_exact",
        };
      }
      if (candidates.length > 0) {
        return { status: "catalog_candidates", candidates };
      }
      return { status: "no_match" };
    },

    async reconcileExternal(original, externalCandidates) {
      if (!matcher.reconcileExternalForConfirmation) return [];
      const candidateGroups = await Promise.all(externalCandidates.map((candidate) =>
        matcher.reconcileExternalForConfirmation!({
          original_brand_name: original.brand_name,
          original_product_name: original.product_name,
          external_brand_name: candidate.brand_name,
          external_product_name: candidate.product_name,
          external_variant_name: candidate.variant_name,
          external_aliases: candidate.discovery_metadata?.aliases ?? [],
          external_product_type: candidate.product_type,
        })
      ));
      return Array.from(new Map(candidateGroups.flat().map((candidate) => [candidate.catalog_product_id, candidate])).values())
        .map(toCatalogIdentity);
    },
  };
}

function toCatalogIdentity(candidate: Awaited<ReturnType<ProductIdentityMatcher["match"]>>["candidates"][number]): CatalogProductIdentity {
  return {
    catalog_product_id: candidate.catalog_product_id,
    brand_name: candidate.brand_name,
    product_name: candidate.product_name,
    variant_name: candidate.variant_name,
    barcode: candidate.barcode,
    category: candidate.category,
    subcategory: candidate.subcategory,
    product_type: candidate.product_type,
    catalog_image_url: (candidate as { catalog_image_url?: string | null }).catalog_image_url ?? null,
  };
}
