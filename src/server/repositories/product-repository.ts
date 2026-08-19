import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables } from "@/db/database.types";
import type { ProductListQuery } from "@/schemas/product";

export type ProductRow = Tables<"products">;

export type ProductRepository = {
  listByUserId(userId: string, query: ProductListQuery): Promise<ProductRow[]>;
  findById(userId: string, productId: string): Promise<ProductRow | null>;
  create(
    userId: string,
    input: {
      brand_name: string | null;
      product_name: string;
      category: string;
      subcategory: string;
      product_type: string;
      updated_at: string;
    },
  ): Promise<ProductRow>;
};

export function createProductRepository(
  supabase: SupabaseClient<Database>,
): ProductRepository {
  return {
    async listByUserId(userId, query) {
      let request = supabase
        .from("products")
        .select("*")
        .eq("created_by_user_id", userId)
        .order("updated_at", { ascending: false });

      if (query.category) {
        request = request.eq("category", query.category);
      }

      if (query.search) {
        request = request.or(
          `brand_name.ilike.%${query.search}%,product_name.ilike.%${query.search}%`,
        );
      }

      const { data, error } = await request;

      if (error) {
        throw new Error("PRODUCT_READ_FAILED", { cause: error });
      }

      return data;
    },

    async findById(userId, productId) {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("id", productId)
        .eq("created_by_user_id", userId)
        .maybeSingle();

      if (error) {
        throw new Error("PRODUCT_READ_FAILED", { cause: error });
      }

      return data;
    },

    async create(userId, input) {
      const { data, error } = await supabase
        .from("products")
        .insert({
          ...input,
          created_by_user_id: userId,
        })
        .select("*")
        .single();

      if (error || !data) {
        throw new Error("PRODUCT_CREATE_FAILED", { cause: error });
      }

      return data;
    },
  };
}
