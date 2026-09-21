import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import type { ProductType } from "@/schemas/product";
import {
  createCatalogIdentityRepository,
  type CatalogIdentityRepository,
  type CatalogIdentityRecallResult,
} from "@/server/repositories/catalog-identity-repository";

export type ConfirmedCatalogCandidate = {
  brand_name: string | null;
  product_name: string;
  variant_name: string | null;
  barcode: string | null;
  confidence: number;
  aliases?: string[];
  product_type?: ProductType | null;
  original_identity?: {
    brand_name: string | null;
    product_name: string | null;
  } | null;
  variant_evidence?: "barcode" | "official_product" | "packaging_observed" | "multi_source" | null;
};

export type ConfirmedCatalogCandidateRepository = {
  findOrCreate(candidate: ConfirmedCatalogCandidate): Promise<string>;
};

export class CatalogVariantConfirmationRequiredError extends Error {
  readonly code = "CATALOG_VARIANT_CONFIRMATION_REQUIRED";
  constructor() {
    super("CATALOG_VARIANT_CONFIRMATION_REQUIRED");
    this.name = "CatalogVariantConfirmationRequiredError";
  }
}

export class CatalogIdentityConfirmationRequiredError extends Error {
  readonly code = "CATALOG_IDENTITY_CONFIRMATION_REQUIRED";
  constructor() {
    super("CATALOG_IDENTITY_CONFIRMATION_REQUIRED");
    this.name = "CatalogIdentityConfirmationRequiredError";
  }
}

/**
 * Candidate rows are intentionally evidence-light: no category/type/source is
 * guessed here, and this repository never updates a row to verified.
 */
export function createConfirmedCatalogCandidateRepository(
  supabase: SupabaseClient<Database>,
  identities: Pick<CatalogIdentityRepository, "findByIdentity"> & Partial<Pick<CatalogIdentityRepository, "recallByIdentity" | "reconcileExternalIdentity">> = createCatalogIdentityRepository(supabase),
): ConfirmedCatalogCandidateRepository {
  return {
    async findOrCreate(candidate) {
      const existing = await findExisting(supabase, identities, candidate);
      if (existing) return existing;

      // The candidate-only columns are nullable by migration. Keep this cast
      // local until generated Supabase types are refreshed after migration.
      const { data, error } = await (supabase.from("catalog_products") as unknown as {
        insert(value: Record<string, unknown>): { select(columns: string): { single(): Promise<{ data: { id: string } | null; error: unknown }> } };
      }).insert({
        brand_name: candidate.brand_name ?? "Unknown brand",
        product_name: candidate.product_name,
        variant_name: durableVariant(candidate),
        barcode: candidate.barcode,
        confidence: candidate.confidence,
        status: "candidate",
      }).select("id").single();
      if (!error && data) return data.id;

      // A concurrent confirmation may have inserted the exact candidate.
      const concurrent = await findExisting(supabase, identities, candidate);
      if (concurrent) return concurrent;
      throw new Error("CONFIRMED_CATALOG_CANDIDATE_WRITE_FAILED", { cause: error });
    },
  };
}

async function findExisting(
  supabase: SupabaseClient<Database>,
  identities: Pick<CatalogIdentityRepository, "findByIdentity"> & Partial<Pick<CatalogIdentityRepository, "recallByIdentity" | "reconcileExternalIdentity">>,
  candidate: ConfirmedCatalogCandidate,
) {
  if (candidate.barcode) {
    const { data, error } = await supabase.from("catalog_products")
      .select("id").eq("barcode", candidate.barcode).limit(1);
    if (error) throw new Error("CONFIRMED_CATALOG_CANDIDATE_READ_FAILED", { cause: error });
    if (data?.[0]) return data[0].id;
  }

  const normalizedBrand = normalizeCanonicalText(candidate.brand_name ?? "Unknown brand");
  const normalizedProduct = normalizeCanonicalText(candidate.product_name);
  const recall: CatalogIdentityRecallResult = identities.recallByIdentity
    ? await identities.recallByIdentity(normalizedBrand, normalizedProduct)
    : { exact: await identities.findByIdentity(normalizedBrand, normalizedProduct), plausible: [], exact_reason: "normalized_name_exact" };
  const matches = recall.exact;
  if (candidate.variant_name && !candidate.variant_evidence && !candidate.barcode) {
    const generic = matches.filter((row) => row.variant_name === null);
    if (generic.length === 1) return generic[0]!.id;
    // A weak external version mention may neither split an existing canonical
    // identity nor select among multiple existing identities.
    if (matches.length > 0) throw new CatalogVariantConfirmationRequiredError();
  }
  const compatible = matches.filter((row) => sameCanonicalVariant(
    row.variant_name,
    durableVariant(candidate),
  ));
  if (compatible.length > 1) throw new CatalogVariantConfirmationRequiredError();
  // Canonical identity is a reuse key only when it identifies exactly one
  // compatible Catalog row. Aliases and approximate text never enter here.
  if (compatible.length === 1) return compatible[0]!.id;
  if (candidate.variant_name === null && matches.length === 1) return matches[0]!.id;
  if (recall.plausible.length > 0) throw new CatalogIdentityConfirmationRequiredError();
  const reconciled = await identities.reconcileExternalIdentity?.({
    original_brand_name: candidate.original_identity?.brand_name ?? candidate.brand_name,
    original_product_name: candidate.original_identity?.product_name ?? candidate.product_name,
    external_brand_name: candidate.brand_name,
    external_product_name: candidate.product_name,
    external_variant_name: candidate.variant_name,
    external_aliases: candidate.aliases ?? [],
    external_product_type: candidate.product_type ?? null,
  }) ?? [];
  if (reconciled.length > 0) throw new CatalogIdentityConfirmationRequiredError();
  return null;
}

function durableVariant(candidate: ConfirmedCatalogCandidate) {
  return candidate.variant_name && (candidate.variant_evidence || candidate.barcode)
    ? candidate.variant_name
    : null;
}

function sameCanonicalVariant(left: string | null, right: string | null) {
  if (left === null || right === null) return left === right;
  return normalizeCanonicalText(left) === normalizeCanonicalText(right);
}

function normalizeCanonicalText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}
