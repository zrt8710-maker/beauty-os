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
  findVerifiedProduct(productId: string, timing?: { requestId: string; queryKind?: string }): Promise<CatalogProductWithSourceRow | null>;
  listVerifiedProductIngredients(productId: string, timing?: { requestId: string; queryKind?: string }): Promise<CatalogProductIngredientWithRelationsRow[]>;
  listVerifiedProductIngredientsByProductIds?(productIds: string[], timing?: { requestId: string; queryKind?: string }): Promise<ReadonlyMap<string, CatalogProductIngredientWithRelationsRow[]>>;
  findVerifiedByBarcode(barcode: string): Promise<CatalogProductWithSourceRow | null>;
  findVerifiedByIdentity(brandName: string, productName: string): Promise<CatalogProductWithSourceRow[]>;
};

export function createKnowledgeRepository(supabase: SupabaseClient<Database>): KnowledgeRepository {
  const productSelection = "*, source:knowledge_sources!catalog_products_primary_source_id_fkey(*)";
  const ingredientSelection = "*, ingredient:ingredients!catalog_product_ingredients_ingredient_id_fkey(*), source:knowledge_sources!catalog_product_ingredients_source_id_fkey(*)";
  return {
    async listVerifiedProducts(query) {
      let request = supabase.from("catalog_products").select(productSelection).eq("status", "verified").order("brand_name").order("product_name").limit(query.limit);
      if (query.search) request = request.or(`brand_name.ilike.%${query.search}%,product_name.ilike.%${query.search}%`);
      const { data, error } = await request;
      if (error) throw new Error("KNOWLEDGE_PRODUCT_READ_FAILED", { cause: error });
      return data as unknown as CatalogProductWithSourceRow[];
    },
    async findVerifiedProduct(productId, timing) {
      const startedAt = Date.now();
      const { data, error } = await supabase.from("catalog_products").select(productSelection).eq("id", productId).eq("status", "verified").maybeSingle();
      logTodayQueryTiming(timing, timing?.queryKind ?? "catalog_product", productId, startedAt, !error);
      if (error) throw new Error("KNOWLEDGE_PRODUCT_READ_FAILED", { cause: error });
      return data as unknown as CatalogProductWithSourceRow | null;
    },
    async listVerifiedProductIngredients(productId, timing) {
      const startedAt = Date.now();
      const { data, error } = await supabase.from("catalog_product_ingredients").select(ingredientSelection).eq("catalog_product_id", productId).order("ingredient_order", { ascending: true, nullsFirst: false });
      logTodayQueryTiming(timing, timing?.queryKind ?? "catalog_ingredient", productId, startedAt, !error);
      if (error) throw new Error("KNOWLEDGE_INGREDIENT_READ_FAILED", { cause: error });
      return data as unknown as CatalogProductIngredientWithRelationsRow[];
    },
    async listVerifiedProductIngredientsByProductIds(productIds, timing) {
      const ids = [...new Set(productIds)];
      if (ids.length === 0) return new Map();
      const startedAt = Date.now();
      const { data, error } = await supabase
        .from("catalog_product_ingredients")
        .select(ingredientSelection)
        .in("catalog_product_id", ids)
        .order("ingredient_order", { ascending: true, nullsFirst: false });
      logTodayBatchQueryTiming(timing, timing?.queryKind ?? "catalog_ingredient_batch", ids.length, startedAt, !error);
      if (error) throw new Error("KNOWLEDGE_INGREDIENT_READ_FAILED", { cause: error });
      const result = new Map<string, CatalogProductIngredientWithRelationsRow[]>();
      for (const row of data as unknown as CatalogProductIngredientWithRelationsRow[]) {
        const rows = result.get(row.catalog_product_id) ?? [];
        rows.push(row);
        result.set(row.catalog_product_id, rows);
      }
      return result;
    },
    async findVerifiedByBarcode(barcode) {
      const { data, error } = await supabase.from("catalog_products").select(productSelection).eq("status", "verified").eq("barcode", barcode).maybeSingle();
      if (error) throw new Error("KNOWLEDGE_PRODUCT_READ_FAILED", { cause: error });
      return data as unknown as CatalogProductWithSourceRow | null;
    },
    async findVerifiedByIdentity(brandName, productName) {
      const { data, error } = await supabase
        .rpc("find_verified_catalog_products_by_identity", {
          p_brand_name: brandName,
          p_product_name: productName,
        })
        .select(productSelection);
      if (error) throw new Error("KNOWLEDGE_PRODUCT_READ_FAILED", { cause: error });
      return data as unknown as CatalogProductWithSourceRow[];
    },
  };
}

function logTodayBatchQueryTiming(timing: { requestId: string; queryKind?: string } | undefined, queryKind: string, catalogProductCount: number, startedAt: number, success: boolean) {
  if (process.env.NODE_ENV !== "development" || !timing) return;
  console.info("[today-supabase]", { requestId: timing.requestId, queryKind, catalogProductCount, durationMs: Date.now() - startedAt, success });
}

function logTodayQueryTiming(timing: { requestId: string; queryKind?: string } | undefined, queryKind: string, catalogProductId: string, startedAt: number, success: boolean) {
  if (process.env.NODE_ENV !== "development" || !timing) return;
  console.info("[today-supabase]", { requestId: timing.requestId, queryKind, catalogProductId: catalogProductId.slice(0, 8), durationMs: Date.now() - startedAt, success });
}
