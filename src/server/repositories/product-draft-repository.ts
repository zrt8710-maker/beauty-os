import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables } from "@/db/database.types";
import type {
  ProductDraftListQuery,
  ProductDraftUpdateInput,
} from "@/schemas/product-draft";

export type ProductDraftRow = Tables<"product_drafts">;

export type ProductDraftTransactionResult = {
  created_product_id: string;
  created_owned_product_id: string;
};

export type ProductDraftRepository = {
  listByUserId(
    userId: string,
    query: ProductDraftListQuery,
  ): Promise<ProductDraftRow[]>;
  findById(userId: string, draftId: string): Promise<ProductDraftRow | null>;
  create(userId: string, uploadAssetId: string): Promise<ProductDraftRow>;
  update(
    userId: string,
    draftId: string,
    input: ProductDraftUpdateInput & { updated_at: string },
  ): Promise<ProductDraftRow | null>;
  reject(
    userId: string,
    draftId: string,
    updatedAt: string,
  ): Promise<ProductDraftRow | null>;
  saveCandidate(
    draftId: string,
    candidateCatalogProductId: string | null,
    matchSource: "barcode_exact" | "normalized_name_exact" | null,
  ): Promise<ProductDraftRow | null>;
  confirmTransaction(draftId: string, catalogProductId: string | null): Promise<ProductDraftTransactionResult>;
};

export function createProductDraftRepository(
  supabase: SupabaseClient<Database>,
): ProductDraftRepository {
  return {
    async listByUserId(userId, query) {
      let request = supabase
        .from("product_drafts")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

      if (query.status) {
        request = request.eq("status", query.status);
      }

      const { data, error } = await request;

      if (error) {
        throw new Error("PRODUCT_DRAFT_READ_FAILED", { cause: error });
      }

      return data;
    },

    async findById(userId, draftId) {
      const { data, error } = await supabase
        .from("product_drafts")
        .select("*")
        .eq("id", draftId)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        throw new Error("PRODUCT_DRAFT_READ_FAILED", { cause: error });
      }

      return data;
    },

    async create(userId, uploadAssetId) {
      const { data, error } = await supabase
        .from("product_drafts")
        .insert({
          user_id: userId,
          upload_asset_id: uploadAssetId,
          source: "manual",
          status: "pending",
        })
        .select("*")
        .single();

      if (error || !data) {
        throw new Error("PRODUCT_DRAFT_CREATE_FAILED", { cause: error });
      }

      return data;
    },

    async update(userId, draftId, input) {
      const { data, error } = await supabase
        .from("product_drafts")
        .update(input)
        .eq("id", draftId)
        .eq("user_id", userId)
        .eq("status", "pending")
        .select("*")
        .maybeSingle();

      if (error) {
        throw new Error("PRODUCT_DRAFT_UPDATE_FAILED", { cause: error });
      }

      return data;
    },

    async reject(userId, draftId, updatedAt) {
      const { data, error } = await supabase
        .from("product_drafts")
        .update({ status: "rejected", updated_at: updatedAt })
        .eq("id", draftId)
        .eq("user_id", userId)
        .eq("status", "pending")
        .select("*")
        .maybeSingle();

      if (error) {
        throw new Error("PRODUCT_DRAFT_REJECT_FAILED", { cause: error });
      }

      return data;
    },
    async saveCandidate(draftId, candidateCatalogProductId, matchSource) {
      const { data, error } = await supabase
        .rpc("save_product_draft_match", {
          p_draft_id: draftId,
          // Supabase's generator cannot infer nullable PostgreSQL function
          // arguments. The SQL function intentionally accepts null to clear a
          // candidate after no-match or match-conflict.
          p_candidate_catalog_product_id: candidateCatalogProductId as never,
          p_match_source: matchSource as never,
        })
        .maybeSingle();
      if (error) throw new Error("PRODUCT_DRAFT_MATCH_FAILED", { cause: error });
      return data;
    },

    async confirmTransaction(draftId, catalogProductId) {
      const { data, error } = await supabase
        .rpc("confirm_product_draft", {
          p_draft_id: draftId,
          ...(catalogProductId ? { p_catalog_product_id: catalogProductId } : {}),
        })
        .single();

      if (error || !data) {
        throw new Error("PRODUCT_DRAFT_CONFIRM_FAILED", { cause: error });
      }

      return data;
    },
  };
}
