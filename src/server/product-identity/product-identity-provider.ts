import type {
  CatalogProductIdentity,
  ExternalProductIdentity,
  ObservedProductIdentity,
} from "@/schemas/product-identity-resolution";
import type { ProductIdentityClue } from "@/schemas/product-identity-clue";
import type { ProductSearchResult } from "@/schemas/product-search";

export type InternalCatalogIdentityProviderResult =
  | { status: "matched"; candidate: CatalogProductIdentity; match_method: "barcode_exact" | "brand_product_exact" }
  | { status: "catalog_candidates"; candidates: CatalogProductIdentity[] }
  | { status: "no_match" };

export type InternalCatalogIdentityProvider = {
  providerCode: string;
  resolve(identity: ObservedProductIdentity): Promise<InternalCatalogIdentityProviderResult>;
  reconcileExternal?(
    original: ObservedProductIdentity,
    externalCandidates: ExternalProductIdentity[],
  ): Promise<CatalogProductIdentity[]>;
};

export type ExternalProductDiscoveryProvider = {
  providerCode: string;
  /** Retains source-specific evidence for external identity discovery. */
  discover(input: ExternalProductDiscoveryInput): Promise<ExternalProductIdentity[]>;
};

export type ExternalProductDiscoveryInput = {
  clue: ProductIdentityClue;
  search_results: ProductSearchResult[];
};
