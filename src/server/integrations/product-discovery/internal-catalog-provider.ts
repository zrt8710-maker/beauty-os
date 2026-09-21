import "server-only";

import {
  productDiscoveryProviderResultSchema,
  type NormalizedProductDiscoveryQuery,
  type ProductCandidateSource,
  type ProductDiscoveryCandidate,
} from "@/schemas/product-discovery";
import {
  catalogProductSchema,
  type CatalogProduct,
} from "@/schemas/knowledge";
import type {
  CatalogProductWithSourceRow,
  KnowledgeRepository,
} from "@/server/repositories/knowledge-repository";

import type { ProductDiscoveryProvider } from "./provider";

export const INTERNAL_CATALOG_PROVIDER_CODE = "internal_catalog";

export function createInternalCatalogProvider(
  repository: KnowledgeRepository,
): ProductDiscoveryProvider {
  return {
    providerCode: INTERNAL_CATALOG_PROVIDER_CODE,
    critical: true,
    supportedModes: ["barcode", "name"],
    async search(query) {
      const rows = query.mode === "barcode"
        ? compact([await repository.findVerifiedByBarcode(query.barcode)])
        : await repository.listVerifiedProducts({
          search: query.product_name,
          limit: Math.min(50, Math.max(query.limit * 3, query.limit)),
        });
      const candidates = rows.map((row) => toCandidate(row, query));

      return productDiscoveryProviderResultSchema.parse({
        provider_code: INTERNAL_CATALOG_PROVIDER_CODE,
        status: candidates.length > 0 ? "ok" : "not_found",
        candidates,
        issues: [],
      });
    },
  };
}

function toCandidate(
  row: CatalogProductWithSourceRow,
  query: NormalizedProductDiscoveryQuery,
): ProductDiscoveryCandidate {
  const product = catalogProductSchema.parse({
    ...row,
    status: "verified",
    source: row.source,
  });

  return {
    candidate_id: `internal:${row.id}`,
    candidate_kind: "internal_verified",
    brand_name: product.brand_name,
    product_name: product.product_name,
    variant_name: product.variant_name,
    barcode: product.barcode,
    category_suggestion: product.category,
    subcategory_suggestion: product.subcategory,
    product_type_suggestion: product.product_type,
    market: query.market,
    locale: query.locale,
    image_preview_url: null,
    existing_catalog_product_id: row.id,
    discovery_score: 0,
    match_reason: query.mode === "barcode"
      ? "barcode_exact"
      : "name_contains",
    verification_eligibility: "eligible",
    completeness: catalogCompleteness(row),
    warnings: [],
    conflicts: [],
    sources: [toSource(product)],
  };
}

function toSource(product: CatalogProduct): ProductCandidateSource {
  const fields: ProductCandidateSource["fields_supported"] = [
    "brand_name",
    "product_name",
    "category",
    "subcategory",
    "product_type",
  ];
  if (product.variant_name) fields.push("variant_name");
  if (product.barcode) fields.push("barcode");

  return {
    provider_code: INTERNAL_CATALOG_PROVIDER_CODE,
    source_type: product.source.source_type,
    source_name: product.source.name,
    source_url: product.source.source_url,
    retrieved_at: product.source.retrieved_at,
    license_note: product.source.license_note,
    authority_level: authorityLevel(product.source.source_type),
    fields_supported: fields,
    raw_record_id: product.id,
    source_quality: product.confidence,
    attribution_required: product.source.source_type === "open_dataset",
    image_reuse_note: null,
  };
}

function authorityLevel(sourceType: CatalogProduct["source"]["source_type"]) {
  if (sourceType === "official_brand") return "official" as const;
  if (sourceType === "official_retailer") return "official_retailer" as const;
  if (sourceType === "open_dataset") return "open_dataset" as const;
  if (sourceType === "ai_candidate") return "ai" as const;
  return "user" as const;
}

function catalogCompleteness(row: CatalogProductWithSourceRow) {
  const fields = [
    row.brand_name,
    row.product_name,
    row.variant_name,
    row.barcode,
    row.category,
    row.subcategory,
    row.product_type,
    row.source.source_url,
  ];
  return Math.round(
    fields.filter((value) => value !== null && value !== "").length
      / fields.length
      * 100,
  );
}

function compact<T>(values: Array<T | null>): T[] {
  return values.filter((value): value is T => value !== null);
}
