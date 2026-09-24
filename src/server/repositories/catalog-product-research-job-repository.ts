import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/db/database.types";
import type { Json } from "@/db/database.types";
import type { ProductResearchInput } from "@/schemas/product-research";

export type ClaimedProductResearchJob = {
  catalogProductId: string;
  leaseToken: string;
  attempts: number;
  researchInput: Json | null;
};

export function createCatalogProductResearchJobRepository(supabase: SupabaseClient<Database>) {
  return {
    async enqueueIfNeeded(input: ProductResearchInput): Promise<boolean> {
      const { data, error } = await supabase.rpc("enqueue_catalog_product_research_job", {
        p_catalog_product_id: input.catalog_product_id,
        p_research_input: input as unknown as Json,
      });
      if (error) throw new Error("PRODUCT_RESEARCH_JOB_ENQUEUE_FAILED", { cause: error });
      return data === true;
    },
    async backfill(): Promise<number> {
      const { data, error } = await supabase.rpc("backfill_catalog_product_research_jobs");
      if (error) throw new Error("PRODUCT_RESEARCH_JOB_BACKFILL_FAILED", { cause: error });
      return data ?? 0;
    },
    async claim(): Promise<ClaimedProductResearchJob | null> {
      const { data, error } = await supabase.rpc("claim_catalog_product_research_job");
      if (error) throw new Error("PRODUCT_RESEARCH_JOB_CLAIM_FAILED", { cause: error });
      const row = data?.[0];
      return row ? {
        catalogProductId: row.catalog_product_id,
        leaseToken: row.lease_token,
        attempts: row.attempts,
        researchInput: row.research_input,
      } : null;
    },
    async finish(job: ClaimedProductResearchJob, result: "completed" | "retry", errorCode: string | null = null): Promise<boolean> {
      const { data, error } = await supabase.rpc("finish_catalog_product_research_job", {
        p_catalog_product_id: job.catalogProductId,
        p_lease_token: job.leaseToken,
        p_result: result,
        p_error: errorCode,
      });
      if (error) throw new Error("PRODUCT_RESEARCH_JOB_FINISH_FAILED", { cause: error });
      return data === true;
    },
  };
}
