import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/database.types";
import type { CatalogSeedInput } from "@/schemas/catalog-seed";
import { createCatalogSeedWriteRepository } from "@/server/repositories/catalog-seed-write-repository";

const catalogProductId = "10000000-0000-4000-8000-000000000001";
const sourceId = "20000000-0000-4000-8000-000000000001";

const input: CatalogSeedInput = {
  schema_version: "catalog-seed/v0.1",
  catalog_product_id: catalogProductId,
  source: {
    source_id: sourceId,
    source_type: "official_brand",
    name: "Beauty OS official product page",
    source_url: "https://example.com/catalog-serum",
    license_note: "Official identity data",
    retrieved_at: "2026-08-24T00:00:00.000Z",
  },
  identity: {
    brand_name: "Beauty OS",
    product_name: "Catalog Serum",
    variant_name: null,
    barcode: "12345678",
    category: "skincare",
    subcategory: "face_care",
    product_type: "serum",
    confidence: 98,
    status: "verified",
  },
};

const receipt = {
  outcome: "created",
  catalog_product_id: catalogProductId,
  source_id: sourceId,
  source_created: true,
  catalog_product_created: true,
  status: "verified",
};

describe("CatalogSeedWriteRepository", () => {
  it("calls exactly one RPC and never accesses a table directly", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: receipt, error: null });
    const from = vi.fn();
    const repository = createCatalogSeedWriteRepository({
      rpc,
      from,
    } as unknown as SupabaseClient<Database>);

    await expect(repository.applyAtomically(input)).resolves.toEqual(receipt);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("apply_catalog_seed_v01", {
      p_input: input,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("preserves the database error as the write failure cause", async () => {
    const rpcError = { code: "23505", message: "identity conflict" };
    const rpc = vi.fn().mockResolvedValue({ data: null, error: rpcError });
    const repository = createCatalogSeedWriteRepository({
      rpc,
    } as unknown as SupabaseClient<Database>);

    let thrown: unknown;
    try {
      await repository.applyAtomically(input);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({
      message: "CATALOG_SEED_WRITE_FAILED",
      cause: rpcError,
    });
  });

  it("strictly rejects an invalid RPC receipt", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ...receipt, unexpected: true },
      error: null,
    });
    const repository = createCatalogSeedWriteRepository({
      rpc,
    } as unknown as SupabaseClient<Database>);

    await expect(repository.applyAtomically(input)).rejects.toMatchObject({
      message: "CATALOG_SEED_WRITE_RECEIPT_INVALID",
      cause: expect.any(Error),
    });
  });
});
