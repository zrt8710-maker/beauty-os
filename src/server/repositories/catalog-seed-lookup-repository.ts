import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import type { CatalogSeedInput } from "@/schemas/catalog-seed";

export type CatalogSeedKnowledgeSourceRow =
  Database["public"]["Tables"]["knowledge_sources"]["Row"];
export type CatalogSeedCatalogProductRow =
  Database["public"]["Tables"]["catalog_products"]["Row"];

export type CatalogSeedLookupResult = {
  source_by_id: CatalogSeedKnowledgeSourceRow | null;
  catalog_by_id: CatalogSeedCatalogProductRow | null;
  barcode_match: CatalogSeedCatalogProductRow | null;
  raw_identity_matches: CatalogSeedCatalogProductRow[];
  normalized_verified_matches: CatalogSeedCatalogProductRow[];
};

export type CatalogSeedLookupReadStage =
  | "source_by_id"
  | "catalog_by_id"
  | "barcode_match"
  | "raw_identity_matches"
  | "normalized_verified_matches";

export class CatalogSeedLookupReadError extends Error {
  readonly code = "CATALOG_SEED_LOOKUP_READ_FAILED";

  constructor(
    public readonly stage: CatalogSeedLookupReadStage,
    cause: unknown,
  ) {
    super("CATALOG_SEED_LOOKUP_READ_FAILED", { cause });
    this.name = "CatalogSeedLookupReadError";
  }
}

export type CatalogSeedLookupRepository = {
  inspect(input: CatalogSeedInput): Promise<CatalogSeedLookupResult>;
};

export type CatalogSeedTrustedReadConfirmation = {
  rls_access: "service_role";
  purpose: "catalog_seed_dry_run";
};

/**
 * Read-only preflight access for internal catalog seed tooling.
 * The caller must provide a trusted server client so RLS cannot hide an
 * existing candidate/deprecated row and turn a collision into a false "new".
 * The explicit confirmation keeps an ordinary authenticated client from being
 * wired accidentally; credential creation remains outside this v0.1 boundary.
 */
export function createCatalogSeedLookupRepository(
  supabase: SupabaseClient<Database>,
  confirmation: CatalogSeedTrustedReadConfirmation,
): CatalogSeedLookupRepository {
  if (
    confirmation?.rls_access !== "service_role"
    || confirmation.purpose !== "catalog_seed_dry_run"
  ) {
    throw new Error("CATALOG_SEED_TRUSTED_READ_REQUIRED");
  }

  return {
    async inspect(input) {
      const sourceById = await readStage("source_by_id", async () => {
        const { data, error } = await supabase
          .from("knowledge_sources")
          .select("*")
          .eq("id", input.source.source_id)
          .maybeSingle();

        if (error) throw error;
        return data as CatalogSeedKnowledgeSourceRow | null;
      });

      const catalogById = await readStage("catalog_by_id", async () => {
        const { data, error } = await supabase
          .from("catalog_products")
          .select("*")
          .eq("id", input.catalog_product_id)
          .maybeSingle();

        if (error) throw error;
        return data as CatalogSeedCatalogProductRow | null;
      });

      const barcode = input.identity.barcode;
      const barcodeMatch = barcode === null
        ? null
        : await readStage("barcode_match", async () => {
          const { data, error } = await supabase
            .from("catalog_products")
            .select("*")
            .eq("barcode", barcode)
            .maybeSingle();

          if (error) throw error;
          return data as CatalogSeedCatalogProductRow | null;
        });

      const rawIdentityMatches = await readStage(
        "raw_identity_matches",
        async () => {
          let request = supabase
            .from("catalog_products")
            .select("*")
            .eq("brand_name", input.identity.brand_name)
            .eq("product_name", input.identity.product_name);

          request = input.identity.variant_name === null
            ? request.is("variant_name", null)
            : request.eq("variant_name", input.identity.variant_name);

          const { data, error } = await request;
          if (error) throw error;
          return sortCatalogRows(
            (data ?? []) as CatalogSeedCatalogProductRow[],
          );
        },
      );

      const normalizedVerifiedMatches = await readStage(
        "normalized_verified_matches",
        async () => {
          const { data, error } = await supabase.rpc(
            "find_verified_catalog_products_by_identity",
            {
              p_brand_name: input.identity.brand_name,
              p_product_name: input.identity.product_name,
            },
          );

          if (error) throw error;
          return sortCatalogRows(
            (data ?? []) as CatalogSeedCatalogProductRow[],
          );
        },
      );

      return {
        source_by_id: sourceById,
        catalog_by_id: catalogById,
        barcode_match: barcodeMatch,
        raw_identity_matches: rawIdentityMatches,
        normalized_verified_matches: normalizedVerifiedMatches,
      };
    },
  };
}

async function readStage<T>(
  stage: CatalogSeedLookupReadStage,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (cause) {
    if (cause instanceof CatalogSeedLookupReadError) throw cause;
    throw new CatalogSeedLookupReadError(stage, cause);
  }
}

function sortCatalogRows(
  rows: CatalogSeedCatalogProductRow[],
): CatalogSeedCatalogProductRow[] {
  return rows.slice().sort((left, right) => left.id.localeCompare(right.id));
}
