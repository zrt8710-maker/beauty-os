import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/db/database.types";
import {
  catalogSeedWriteReceiptSchema,
  type CatalogSeedInput,
  type CatalogSeedWriteReceipt,
} from "@/schemas/catalog-seed";

export type CatalogSeedWriteRepository = {
  applyAtomically(input: CatalogSeedInput): Promise<CatalogSeedWriteReceipt>;
};

export function createCatalogSeedWriteRepository(
  supabase: SupabaseClient<Database>,
): CatalogSeedWriteRepository {
  return {
    async applyAtomically(input) {
      const { data, error } = await supabase.rpc(
        "apply_catalog_seed_v01",
        { p_input: input as Json },
      );

      if (error) {
        throw new Error("CATALOG_SEED_WRITE_FAILED", { cause: error });
      }

      try {
        return catalogSeedWriteReceiptSchema.parse(data);
      } catch (cause) {
        throw new Error("CATALOG_SEED_WRITE_RECEIPT_INVALID", { cause });
      }
    },
  };
}
