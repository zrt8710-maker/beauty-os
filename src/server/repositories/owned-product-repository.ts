import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables } from "@/db/database.types";
import type { OwnedProductListQuery } from "@/schemas/product";
import type { ProductRow } from "@/server/repositories/product-repository";

export type OwnedProductRow = Tables<"user_owned_products">;
type CatalogImageRow = Pick<Tables<"catalog_products">, "catalog_image_url">;
type ProductWithOptionalCatalogImageRow = ProductRow & {
  catalog_product?: CatalogImageRow | null;
};
export type OwnedProductWithProductRow = OwnedProductRow & {
  product: ProductWithOptionalCatalogImageRow;
};

type OwnedProductWrite = Pick<
  OwnedProductRow,
  | "product_id"
  | "asset_category"
  | "status"
  | "purchase_date"
  | "manufacture_date"
  | "opened_at"
  | "expires_on"
  | "quantity_remaining_percent"
  | "notes"
  | "package_size"
  | "image_override_upload_id"
>;

type OwnedProductUpdate = Partial<Omit<OwnedProductWrite, "product_id">> & {
  updated_at: string;
};

const ownedProductSelection = "*, product:products(*)" as const;
const ownedProductWithCatalogImageSelection = "*, product:products(*, catalog_product:catalog_products(catalog_image_url))" as const;

export type OwnedProductRepository = {
  listByUserId(
    userId: string,
    query: OwnedProductListQuery,
    timing?: { requestId: string },
  ): Promise<OwnedProductWithProductRow[]>;
  listByUserIdWithCatalogImage(
    userId: string,
    query: OwnedProductListQuery,
  ): Promise<OwnedProductWithProductRow[]>;
  findById(
    userId: string,
    ownedProductId: string,
  ): Promise<OwnedProductWithProductRow | null>;
  create(
    userId: string,
    input: OwnedProductWrite,
  ): Promise<OwnedProductWithProductRow>;
  update(
    userId: string,
    ownedProductId: string,
    update: OwnedProductUpdate,
  ): Promise<OwnedProductWithProductRow | null>;
  archive(
    userId: string,
    ownedProductId: string,
    archivedAt: string,
  ): Promise<OwnedProductWithProductRow | null>;
};

export function createOwnedProductRepository(
  supabase: SupabaseClient<Database>,
): OwnedProductRepository {
  return {
    async listByUserId(userId, query, timing) {
      let request = supabase
        .from("user_owned_products")
        .select(ownedProductSelection)
        .eq("user_id", userId)
        .is("archived_at", null)
        .order("updated_at", { ascending: false });

      if (query.status) {
        request = request.eq("status", query.status);
      }

      const startedAt = Date.now();
      const { data, error } = await request;
      logTodayQueryTiming(timing, "owned_product_joined", startedAt, !error);

      if (error) {
        throw new Error("OWNED_PRODUCT_READ_FAILED", { cause: error });
      }

      return data;
    },

    async listByUserIdWithCatalogImage(userId, query) {
      let request = supabase
        .from("user_owned_products")
        .select(ownedProductWithCatalogImageSelection)
        .eq("user_id", userId)
        .is("archived_at", null)
        .order("updated_at", { ascending: false });

      if (query.status) {
        request = request.eq("status", query.status);
      }

      const { data, error } = await request;
      if (error) {
        throw new Error("OWNED_PRODUCT_READ_FAILED", { cause: error });
      }

      return data;
    },

    async findById(userId, ownedProductId) {
      const { data, error } = await supabase
        .from("user_owned_products")
        .select(ownedProductSelection)
        .eq("id", ownedProductId)
        .eq("user_id", userId)
        .is("archived_at", null)
        .maybeSingle();

      if (error) {
        throw new Error("OWNED_PRODUCT_READ_FAILED", { cause: error });
      }

      return data;
    },

    async create(userId, input) {
      const { data, error } = await supabase
        .from("user_owned_products")
        .insert({
          ...input,
          user_id: userId,
        })
        .select(ownedProductSelection)
        .single();

      if (error || !data) {
        throw new Error("OWNED_PRODUCT_CREATE_FAILED", { cause: error });
      }

      return data;
    },

    async update(userId, ownedProductId, update) {
      const { data, error } = await supabase
        .from("user_owned_products")
        .update(update)
        .eq("id", ownedProductId)
        .eq("user_id", userId)
        .is("archived_at", null)
        .select(ownedProductSelection)
        .maybeSingle();

      if (error) {
        throw new Error("OWNED_PRODUCT_UPDATE_FAILED", { cause: error });
      }

      return data;
    },

    async archive(userId, ownedProductId, archivedAt) {
      const { data, error } = await supabase
        .from("user_owned_products")
        .update({
          status: "archived",
          archived_at: archivedAt,
          updated_at: archivedAt,
        })
        .eq("id", ownedProductId)
        .eq("user_id", userId)
        .is("archived_at", null)
        .select(ownedProductSelection)
        .maybeSingle();

      if (error) {
        throw new Error("OWNED_PRODUCT_DELETE_FAILED", { cause: error });
      }

      return data;
    },
  };
}

function logTodayQueryTiming(timing: { requestId: string } | undefined, queryKind: string, startedAt: number, success: boolean) {
  if (process.env.NODE_ENV !== "development" || !timing) return;
  console.info("[today-supabase]", { requestId: timing.requestId, queryKind, durationMs: Date.now() - startedAt, success });
}
