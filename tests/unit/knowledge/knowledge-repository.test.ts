import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/database.types";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";

describe("KnowledgeRepository identity query", () => {
  it("loads and groups verified ingredient rows in one batch query", async () => {
    const ids = [
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
    ];
    const rows = ids.map((catalog_product_id) => ({ catalog_product_id }));
    const order = vi.fn().mockResolvedValue({ data: rows, error: null });
    const inQuery = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ in: inQuery });
    const from = vi.fn().mockReturnValue({ select });
    const repository = createKnowledgeRepository(
      { from, rpc: vi.fn() } as unknown as SupabaseClient<Database>,
    );

    const result = await repository.listVerifiedProductIngredientsByProductIds!(ids);

    expect(from).toHaveBeenCalledTimes(1);
    expect(inQuery).toHaveBeenCalledWith("catalog_product_id", ids);
    expect(result.get(ids[0])).toEqual([rows[0]]);
    expect(result.get(ids[1])).toEqual([rows[1]]);
  });

  it("queries one verified catalog row by exact barcode in the database", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const barcodeEq = vi.fn().mockReturnValue({ maybeSingle });
    const statusEq = vi.fn().mockReturnValue({ eq: barcodeEq });
    const select = vi.fn().mockReturnValue({ eq: statusEq });
    const from = vi.fn().mockReturnValue({ select });
    const rpc = vi.fn();
    const supabase = { rpc, from } as unknown as SupabaseClient<Database>;
    const repository = createKnowledgeRepository(supabase);

    await repository.findVerifiedByBarcode("12345678");

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("catalog_products");
    expect(statusEq).toHaveBeenCalledWith("status", "verified");
    expect(barcodeEq).toHaveBeenCalledWith("barcode", "12345678");
    expect(maybeSingle).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses one database identity RPC instead of loading catalog rows", async () => {
    const select = vi.fn().mockResolvedValue({ data: [], error: null });
    const rpc = vi.fn().mockReturnValue({ select });
    const from = vi.fn();
    const supabase = { rpc, from } as unknown as SupabaseClient<Database>;
    const repository = createKnowledgeRepository(supabase);

    await repository.findVerifiedByIdentity(" CeraVe ", "Daily-SPF");

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "find_verified_catalog_products_by_identity",
      {
        p_brand_name: " CeraVe ",
        p_product_name: "Daily-SPF",
      },
    );
    expect(select).toHaveBeenCalledWith(
      "*, source:knowledge_sources!catalog_products_primary_source_id_fkey(*)",
    );
    expect(from).not.toHaveBeenCalled();
  });
});
