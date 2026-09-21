import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Database, Json } from "@/db/database.types";
import type { ProductKnowledgeCurationInput } from "@/schemas/product-knowledge-curation";

const productKnowledgeCurationWriteReceiptSchema = z
  .object({
    catalog_product_id: z.uuid(),
    role_assignment_ids: z.record(z.string(), z.uuid()),
    capability_assignment_ids: z.record(z.string(), z.uuid()),
    evidence_counts: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();

export type ProductKnowledgeCurationWriteReceipt = z.infer<
  typeof productKnowledgeCurationWriteReceiptSchema
>;

export type ProductKnowledgeCurationRepository = {
  applyAtomically(
    input: ProductKnowledgeCurationInput,
  ): Promise<ProductKnowledgeCurationWriteReceipt>;
};

export function createProductKnowledgeCurationRepository(
  supabase: SupabaseClient<Database>,
): ProductKnowledgeCurationRepository {
  return {
    async applyAtomically(input) {
      const { data, error } = await supabase.rpc(
        "apply_product_knowledge_curation_v01",
        { p_input: input as Json },
      );

      if (error) {
        throw new Error("PRODUCT_KNOWLEDGE_CURATION_WRITE_FAILED", {
          cause: error,
        });
      }

      try {
        return productKnowledgeCurationWriteReceiptSchema.parse(data);
      } catch (error) {
        throw new Error("PRODUCT_KNOWLEDGE_CURATION_RECEIPT_INVALID", {
          cause: error,
        });
      }
    },
  };
}
