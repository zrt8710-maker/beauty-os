import "server-only";

import type {
  CatalogIdentityProduct,
  CatalogIdentityRepository,
  ExternalIdentityReconciliationInput,
} from "@/server/repositories/catalog-identity-repository";
import type {
  ProductIdentityCandidate,
  ProductIdentityMatchResult,
} from "@/schemas/product-identity";
import type { ProductIdentityTimingReporter } from "@/server/product-identity/identity-research-debug";

export type ProductIdentityMatchStatus =
  | "no_match"
  | "candidate"
  | "match_conflict";

export type ProductIdentityMatchReason =
  | "barcode_exact"
  | "normalized_name_exact";

export type ProductIdentityMatchInput = {
  brand_name: string | null;
  product_name: string | null;
  barcode?: string | null;
  category?: string | null;
  product_type?: string | null;
};

export type MatchResult = ProductIdentityMatchResult;

export type CatalogRecallMatchResult = MatchResult | {
  status: "catalog_candidates";
  candidates: ProductIdentityCandidate[];
  confidence: null;
  match_reason: "plausible_name_recall";
};

export type ProductIdentityMatcher = {
  match(input: ProductIdentityMatchInput): Promise<MatchResult>;
  recallForConfirmation?(input: ProductIdentityMatchInput): Promise<CatalogRecallMatchResult>;
  reconcileExternalForConfirmation?(
    input: ExternalIdentityReconciliationInput,
  ): Promise<ProductIdentityCandidate[]>;
  searchByText?(query: string): Promise<{
    candidates: ProductIdentityCandidate[];
    exact: boolean;
  }>;
};

function toCandidate(
  row: CatalogIdentityProduct,
): ProductIdentityCandidate {
  return {
    id: row.id,
    catalog_product_id: row.id,
    brand_name: row.brand_name,
    product_name: row.product_name,
    variant_name: row.variant_name,
    barcode: row.barcode,
    category: row.category as ProductIdentityCandidate["category"],
    subcategory: row.subcategory as ProductIdentityCandidate["subcategory"],
    product_type: row.product_type as ProductIdentityCandidate["product_type"],
    catalog_confidence: row.confidence,
    ...(row.catalog_image_url ? { catalog_image_url: row.catalog_image_url } : {}),
  };
}

export function createProductIdentityMatcher(
  identities: CatalogIdentityRepository,
  timingReporter?: ProductIdentityTimingReporter,
): ProductIdentityMatcher {
  return {
    match(input) {
      return resolveIdentity(identities, input, false) as Promise<MatchResult>;
    },

    recallForConfirmation(input) {
      return resolveIdentity(identities, input, true);
    },

    async reconcileExternalForConfirmation(input) {
      const rows = await identities.reconcileExternalIdentity?.(input) ?? [];
      return rows.map(toCandidate);
    },

    async searchByText(query) {
      const normalizedQuery = normalize(query);
      if (!normalizedQuery) return { candidates: [], exact: false };

      const directRows = await identities.listIdentityProducts({
        search: query.trim(),
        limit: 20,
      });
      const rows = [...directRows];

      // Concatenated Chinese brand/product input has no delimiter. Catalog is
      // the authority for a split: only an exact stored brand + product pair
      // is accepted, never a model-generated boundary. The lookups are
      // independent, so issue them together but consume them in source order:
      // that preserves the former first-matching-split semantics.
      const characters = [...query.trim()];
      const splitCandidates: Array<{ brand: string; product: string }> = [];
      for (let index = 2; rows.length === 0 && index < characters.length - 1 && index <= 20; index += 1) {
        const possibleBrand = characters.slice(0, index).join("").trim();
        const possibleProduct = characters.slice(index).join("").trim();
        splitCandidates.push({ brand: possibleBrand, product: possibleProduct });
      }
      if (splitCandidates.length > 0) {
        const startedAt = performance.now();
        const splitResults = await Promise.all(splitCandidates.map(async ({ brand, product }) => {
          const matches = await identities.listIdentityProducts({ search: brand, limit: 20 });
          return matches.filter((row) =>
            normalize(row.brand_name) === normalize(brand)
            && normalize(row.product_name) === normalize(product)
          );
        }));
        timingReporter?.({
          stage: "unbranded_split_recall",
          elapsed_ms: Math.round(performance.now() - startedAt),
          split_candidate_count: splitCandidates.length,
        });
        // Promise.all preserves input order. Retaining only the first
        // non-empty split result is exactly what the former serial loop did.
        const firstMatchingSplit = splitResults.find((matches) => matches.length > 0);
        if (firstMatchingSplit) rows.push(...firstMatchingSplit);
      }

      const uniqueRows = Array.from(new Map(rows.map((row) => [row.id, row])).values());
      return {
        candidates: uniqueRows.map(toCandidate),
        exact: uniqueRows.some((row) => {
          const product = normalize(row.product_name);
          const combined = normalize(`${row.brand_name}${row.product_name}`);
          return product === normalizedQuery || combined === normalizedQuery;
        }),
      };
    },
  };
}

async function resolveIdentity(
  identities: CatalogIdentityRepository,
  input: ProductIdentityMatchInput,
  includePlausible: boolean,
): Promise<CatalogRecallMatchResult> {
      if (input.barcode) {
        const barcodeCandidate = await identities.findByBarcode(
          input.barcode,
        );

        if (barcodeCandidate) {
          return {
            status: "candidate",
            candidates: [toCandidate(barcodeCandidate)],
            confidence: 100,
            match_reason: "barcode_exact",
          };
        }
      }

      if (input.brand_name && input.product_name) {
        const recall = identities.recallByIdentity
          ? await identities.recallByIdentity(input.brand_name, input.product_name)
          : {
              exact: await identities.findByIdentity(input.brand_name, input.product_name),
              plausible: [],
              exact_reason: "normalized_name_exact" as const,
            };
        const rows = recall.exact;
        const candidates = rows.map(toCandidate);

        if (candidates.length === 1) {
          return {
            status: "candidate",
            candidates,
            confidence: 90,
            match_reason: "normalized_name_exact",
          };
        }

        if (candidates.length > 1) {
          return {
            status: "match_conflict",
            candidates,
            confidence: null,
            match_reason: "normalized_name_exact",
          };
        }

        if (includePlausible && recall.plausible.length > 0) {
          return {
            status: "catalog_candidates",
            candidates: recall.plausible.map(toCandidate),
            confidence: null,
            match_reason: "plausible_name_recall",
          };
        }
      }

      return {
        status: "no_match",
        candidates: [],
        confidence: null,
        match_reason: null,
      };
}

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}
