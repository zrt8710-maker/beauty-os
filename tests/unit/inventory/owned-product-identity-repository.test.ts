import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/database.types";
import {
  createOwnedProductIdentityRepository,
} from "@/server/repositories/owned-product-identity-repository";

describe("OwnedProductIdentityRepository", () => {
  it("creates product and owned product through one atomic RPC", async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: "owned", product_id: "product", product: { id: "product" } },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ single });
    const rpc = vi.fn().mockReturnValue({ select });
    const from = vi.fn();
    const timings: Array<{ stage: string; elapsed_ms: number }> = [];
    const repository = createOwnedProductIdentityRepository({
      rpc,
      from,
    } as unknown as SupabaseClient<Database>, (event) => timings.push(event));

    await repository.create("user-a", {
      resolution_kind: "external",
      brand_name: "CeraVe",
      product_name: "Daily SPF",
      variant_name: "50 ml",
      barcode: "12345678",
      category: "skincare",
      subcategory: "face_care",
      product_type: "serum",
      catalog_product_id: null,
      asset_category: "cleansing",
      confirmation_token: "x".repeat(32),
      idempotency_key: "10000000-0000-4000-8000-000000000004",
      status: "unopened",
      purchase_date: null,
      opened_at: null,
      expires_on: null,
      quantity_remaining_percent: 100,
      notes: null,
      manufacture_date: "2026-01-02",
      package_size: "50ml",
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "create_owned_product_with_identity_idempotent",
      expect.objectContaining({
        p_user_id: "user-a",
        p_resolution_kind: "external",
        p_variant_name: "50 ml",
        p_barcode: "12345678",
        p_asset_category: "cleansing",
        p_manufacture_date: "2026-01-02",
        p_package_size: "50ml",
        p_idempotency_key: "10000000-0000-4000-8000-000000000004",
      }),
    );
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_identity_status");
    expect(select).toHaveBeenCalledWith("*, product:products(*, catalog_product:catalog_products(catalog_image_url))");
    expect(from).not.toHaveBeenCalled();
    expect(timings).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "asset_rpc" }),
    ]));
  });

  it("sends null to the compatibility RPC when opened_at is omitted", async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: "owned", product_id: "product", product: { id: "product" } },
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) });
    const repository = createOwnedProductIdentityRepository({ rpc } as unknown as SupabaseClient<Database>);

    await repository.create("user-a", {
      resolution_kind: "catalog",
      brand_name: "CeraVe",
      product_name: "Daily SPF",
      variant_name: null,
      barcode: null,
      category: "skincare",
      subcategory: "face_care",
      product_type: "sunscreen",
      catalog_product_id: "10000000-0000-4000-8000-000000000001",
      asset_category: "skincare",
      confirmation_token: null,
      idempotency_key: "10000000-0000-4000-8000-000000000009",
      status: "unopened",
      purchase_date: null,
      manufacture_date: null,
      expires_on: null,
      quantity_remaining_percent: 100,
      notes: null,
      package_size: null,
      opened_at: undefined as never,
    });

    expect(rpc).toHaveBeenCalledWith(
      "create_owned_product_with_identity_idempotent",
      expect.objectContaining({ p_opened_at: null, p_expires_on: null }),
    );
  });

  it("hydrates an external product when the RPC embed relation is null", async () => {
    const ownedRow = {
      id: "owned",
      product_id: "product",
      product: null,
    };
    const product = {
      id: "product",
      brand_name: "hfp",
      product_name: "果酸毛孔净透精华水",
      variant_name: null,
      barcode: null,
      identity_status: "matched",
      category: "skincare",
      subcategory: "face_care",
      product_type: "serum",
      catalog_product_id: null,
      created_by_user_id: "user-a",
      created_at: "2026-08-26T00:00:00.000Z",
      updated_at: "2026-08-26T00:00:00.000Z",
    };
    const rpcSingle = vi.fn().mockResolvedValue({ data: ownedRow, error: null });
    const rpc = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: rpcSingle }) });
    const productSingle = vi.fn().mockResolvedValue({ data: product, error: null });
    const productEq = vi.fn().mockReturnValue({ single: productSingle });
    const productSelect = vi.fn().mockReturnValue({ eq: productEq });
    const from = vi.fn().mockReturnValue({ select: productSelect });
    const repository = createOwnedProductIdentityRepository({ rpc, from } as unknown as SupabaseClient<Database>);

    const result = await repository.create("user-a", {
      resolution_kind: "external",
      brand_name: "hfp",
      product_name: "果酸毛孔净透精华水",
      variant_name: null,
      barcode: null,
      category: "skincare",
      subcategory: "face_care",
      product_type: "serum",
      catalog_product_id: null,
      asset_category: "skincare",
      confirmation_token: "x".repeat(32),
      idempotency_key: "10000000-0000-4000-8000-000000000005",
      status: "unopened",
      purchase_date: null,
      manufacture_date: null,
      opened_at: null,
      expires_on: null,
      quantity_remaining_percent: 100,
      notes: null,
      package_size: null,
    });

    expect(from).toHaveBeenCalledWith("products");
    expect(productEq).toHaveBeenCalledWith("id", "product");
    expect(result.product).toEqual(product);
    expect(result.product.catalog_product_id).toBeNull();
  });

  it("returns the same RPC-owned row on an idempotent external retry", async () => {
    const data = {
      id: "owned-existing",
      product_id: "product-existing",
      product: { id: "product-existing", catalog_product_id: null },
    };
    const single = vi.fn().mockResolvedValue({ data, error: null });
    const rpc = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) });
    const from = vi.fn();
    const repository = createOwnedProductIdentityRepository({ rpc, from } as unknown as SupabaseClient<Database>);
    const input = {
      resolution_kind: "external" as const,
      brand_name: "hfp",
      product_name: "果酸毛孔净透精华水",
      variant_name: null,
      barcode: null,
      category: "skincare" as const,
      subcategory: "face_care",
      product_type: "serum" as const,
      catalog_product_id: null,
      asset_category: "skincare" as const,
      confirmation_token: "x".repeat(32),
      idempotency_key: "10000000-0000-4000-8000-000000000006",
      status: "unopened" as const,
      purchase_date: null,
      manufacture_date: null,
      opened_at: null,
      expires_on: null,
      quantity_remaining_percent: 100,
      notes: null,
      package_size: null,
    };

    const first = await repository.create("user-a", input);
    const retry = await repository.create("user-a", input);

    expect(first.id).toBe("owned-existing");
    expect(retry.id).toBe(first.id);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(from).not.toHaveBeenCalled();
  });

  it("preserves safe PostgREST diagnostics when the atomic RPC fails", async () => {
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "PGRST202",
        message: "Could not find the function public.create_owned_product_with_identity_idempotent",
        details: "Searched for a function with the supplied parameters.",
      },
    });
    const select = vi.fn().mockReturnValue({ single });
    const rpc = vi.fn().mockReturnValue({ select });
    const repository = createOwnedProductIdentityRepository({ rpc } as unknown as SupabaseClient<Database>);

    await expect(repository.create("user-a", {
      resolution_kind: "external",
      brand_name: "CeraVe",
      product_name: "Daily SPF",
      variant_name: null,
      barcode: null,
      category: "skincare",
      subcategory: "face_care",
      product_type: "serum",
      catalog_product_id: null,
      asset_category: "skincare",
      confirmation_token: "x".repeat(32),
      idempotency_key: "10000000-0000-4000-8000-000000000004",
      status: "unopened",
      purchase_date: null,
      manufacture_date: null,
      opened_at: null,
      expires_on: null,
      quantity_remaining_percent: 100,
      notes: null,
      package_size: null,
    })).rejects.toMatchObject({
      name: "OwnedProductIdentityRepositoryError",
      postgres: {
        code: "PGRST202",
        message: "Could not find the function public.create_owned_product_with_identity_idempotent",
        details: "Searched for a function with the supplied parameters.",
      },
    });
  });
});
