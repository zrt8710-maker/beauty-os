import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import type { CatalogProductListQuery } from "@/schemas/knowledge";

export type CatalogProductWithSourceRow = Database["public"]["Tables"]["catalog_products"]["Row"] & {
  source: Database["public"]["Tables"]["knowledge_sources"]["Row"];
};
export type CatalogProductIngredientWithRelationsRow = Database["public"]["Tables"]["catalog_product_ingredients"]["Row"] & {
  ingredient: Database["public"]["Tables"]["ingredients"]["Row"];
  source: Database["public"]["Tables"]["knowledge_sources"]["Row"];
};

export type KnowledgeRepository = {
  listVerifiedProducts(query: CatalogProductListQuery): Promise<CatalogProductWithSourceRow[]>;
  findVerifiedProduct(productId: string): Promise<CatalogProductWithSourceRow | null>;
  listVerifiedProductIngredients(productId: string): Promise<CatalogProductIngredientWithRelationsRow[]>;
  findVerifiedByBarcode(barcode: string): Promise<CatalogProductWithSourceRow | null>;
  listVerifiedProductsForMatching(): Promise<CatalogProductWithSourceRow[]>;
};

export function createKnowledgeRepository(supabase: SupabaseClient<Database>): KnowledgeRepository {
  const productSelection = "*, source:knowledge_sources!catalog_products_primary_source_id_fkey(*)";
  return {
    async listVerifiedProducts(query) {
      let request = supabase.from("catalog_products").select(productSelection).eq("status", "verified").order("brand_name").order("product_name").limit(query.limit);
      if (query.search) request = request.or(`brand_name.ilike.%${query.search}%,product_name.ilike.%${query.search}%`);
      const { data, error } = await request;
      if (error) throw new Error("KNOWLEDGE_PRODUCT_READ_FAILED", { cause: error });
      return data as unknown as CatalogProductWithSourceRow[];
    },
    async findVerifiedProduct(productId) {
      const { data, error } = await supabase.from("catalog_products").select(productSelection).eq("id", productId).eq("status", "verified").maybeSingle();
      if (error) throw new Error("KNOWLEDGE_PRODUCT_READ_FAILED", { cause: error });
      return data as unknown as CatalogProductWithSourceRow | null;
    },
    async listVerifiedProductIngredients(productId) {
      const { data, error } = await supabase.from("catalog_product_ingredients").select("*, ingredient:ingredients!catalog_product_ingredients_ingredient_id_fkey(*), source:knowledge_sources!catalog_product_ingredients_source_id_fkey(*)").eq("catalog_product_id", productId).order("ingredient_order", { ascending: true, nullsFirst: false });
      if (error) throw new Error("KNOWLEDGE_INGREDIENT_READ_FAILED", { cause: error });
      return data as unknown as CatalogProductIngredientWithRelationsRow[];
    },
    async findVerifiedByBarcode(barcode) {
      const { data, error } = await supabase.from("catalog_products").select(productSelection).eq("status", "verified").eq("barcode", barcode).maybeSingle();
      if (error) throw new Error("KNOWLEDGE_PRODUCT_READ_FAILED", { cause: error });
      return data as unknown as CatalogProductWithSourceRow | null;
    },
    async listVerifiedProductsForMatching() {
      const { data, error } = await supabase.from("catalog_products").select(productSelection).eq("status", "verified").order("id").limit(500);
      if (error) throw new Error("KNOWLEDGE_PRODUCT_READ_FAILED", { cause: error });
      return data as unknown as CatalogProductWithSourceRow[];
    },
  };
}
