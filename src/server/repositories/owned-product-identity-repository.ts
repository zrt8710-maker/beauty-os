import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import type { ProductRow } from "@/server/repositories/product-repository";
import type { CreateOwnedProductWithIdentityInput } from "@/schemas/product-identity";
import {
  OwnedProductIdentityRepositoryError,
  ownedProductCreateDebug,
  type OwnedProductCreateTimingReporter,
  toSafeException,
  toSafePostgresError,
} from "@/server/owned-products/owned-product-create-debug";
import type { OwnedProductWithProductRow } from "@/server/repositories/owned-product-repository";

export type AtomicOwnedProductIdentityInput =
  CreateOwnedProductWithIdentityInput & { subcategory: string };

export type OwnedProductIdentityRepository = {
  create(
    userId: string,
    input: AtomicOwnedProductIdentityInput,
  ): Promise<OwnedProductWithProductRow>;
};

const selection = "*, product:products(*, catalog_product:catalog_products(catalog_image_url))" as const;
const rpcName = "create_owned_product_with_identity_idempotent";

export function createOwnedProductIdentityRepository(
  supabase: SupabaseClient<Database>,
  timingReporter?: OwnedProductCreateTimingReporter,
): OwnedProductIdentityRepository {
  return {
    async create(userId, input) {
      const rpcParameterTypes = {
        p_asset_category: "string" as const,
        p_catalog_product_id: input.catalog_product_id === null ? "null" as const : "string" as const,
        p_idempotency_key: "string" as const,
        p_manufacture_date: input.manufacture_date == null ? "null" as const : "string" as const,
        p_package_size: input.package_size == null ? "null" as const : "string" as const,
        p_resolution_kind: "string" as const,
        p_user_id: "string" as const,
      };
      let data: unknown;
      let error: unknown;
      const rpcStartedAt = performance.now();
      try {
        ({ data, error } = await supabase.rpc(rpcName, {
          p_user_id: userId,
          p_resolution_kind: input.resolution_kind,
          p_brand_name: input.brand_name as never,
          p_product_name: input.product_name,
          p_variant_name: input.variant_name as never,
          p_barcode: (input.barcode ?? null) as never,
          p_category: input.category,
          p_subcategory: input.subcategory,
          p_product_type: input.product_type,
          p_catalog_product_id: input.catalog_product_id as never,
          p_asset_category: input.asset_category,
          p_status: input.status,
          p_purchase_date: input.purchase_date as never,
          p_manufacture_date: (input.manufacture_date ?? null) as never,
          p_opened_at: (input.opened_at ?? null) as never,
          p_expires_on: input.expires_on as never,
          p_quantity_remaining_percent: input.quantity_remaining_percent,
          p_notes: input.notes as never,
          p_package_size: (input.package_size ?? null) as never,
          p_idempotency_key: input.idempotency_key,
        })
        .select(selection)
        .single());
      } catch (exception) {
        const safeException = toSafeException(exception);
        ownedProductCreateDebug({
          create_stage: "rpc_exception",
          resolution_kind: input.resolution_kind,
          idempotency_key_present: Boolean(input.idempotency_key),
          rpc_name: rpcName,
          rpc_parameter_types: rpcParameterTypes,
          exception_name: safeException.name,
          exception_message: safeException.message,
        });
        throw new OwnedProductIdentityRepositoryError(
          { code: null, message: null, details: null, hint: null },
          safeException,
        );
      } finally {
        timingReporter?.({ stage: "asset_rpc", elapsed_ms: Math.round(performance.now() - rpcStartedAt) });
      }

      if (error) {
        const postgres = toSafePostgresError(error);
        ownedProductCreateDebug({
          create_stage: "rpc_failed",
          resolution_kind: input.resolution_kind,
          idempotency_key_present: Boolean(input.idempotency_key),
          rpc_name: rpcName,
          postgres_error_code: postgres.code,
          postgres_error_message: postgres.message,
          postgres_error_details: postgres.details,
          postgres_error_hint: postgres.hint,
          rpc_parameter_types: rpcParameterTypes,
        });
        throw new OwnedProductIdentityRepositoryError(postgres);
      }

      if (!data) {
        ownedProductCreateDebug({
          create_stage: "rpc_empty_response",
          resolution_kind: input.resolution_kind,
          idempotency_key_present: Boolean(input.idempotency_key),
          rpc_name: rpcName,
          rpc_parameter_types: rpcParameterTypes,
          exception_name: "RpcEmptyResponseError",
          exception_message: "RPC returned neither data nor an error.",
        });
        throw new OwnedProductIdentityRepositoryError(
          { code: null, message: null, details: null, hint: null },
          { name: "RpcEmptyResponseError", message: "RPC returned neither data nor an error." },
        );
      }

      if (hasProductRelation(data)) {
        return data as OwnedProductWithProductRow;
      }

      const ownedRow = data as { product_id: string };
      const hydrationStartedAt = performance.now();
      const { data: product, error: productError } = await supabase
        .from("products")
        .select("*, catalog_product:catalog_products(catalog_image_url)")
        .eq("id", ownedRow.product_id)
        .single();
      timingReporter?.({
        stage: "fallback_hydration",
        elapsed_ms: Math.round(performance.now() - hydrationStartedAt),
      });

      if (productError || !product) {
        const postgres = toSafePostgresError(productError);
        ownedProductCreateDebug({
          create_stage: "product_hydration_failed",
          resolution_kind: input.resolution_kind,
          rpc_name: rpcName,
          postgres_error_code: postgres.code,
          postgres_error_message: postgres.message,
          postgres_error_details: postgres.details,
          postgres_error_hint: postgres.hint,
        });
        throw new OwnedProductIdentityRepositoryError(postgres);
      }

      return { ...(data as object), product: product as ProductRow } as OwnedProductWithProductRow;
    },
  };
}

function hasProductRelation(data: unknown): data is OwnedProductWithProductRow {
  if (typeof data !== "object" || data === null || !("product" in data)) return false;
  const product = data.product;
  return typeof product === "object" && product !== null;
}
