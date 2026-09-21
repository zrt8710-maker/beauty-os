import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/database.types";
import type { CatalogSeedInput } from "@/schemas/catalog-seed";
import {
  CatalogSeedLookupReadError,
  createCatalogSeedLookupRepository,
} from "@/server/repositories/catalog-seed-lookup-repository";

const sourceId = "10000000-0000-4000-8000-000000000001";
const catalogProductId = "20000000-0000-4000-8000-000000000001";
const otherCatalogProductId = "20000000-0000-4000-8000-000000000002";
const timestamp = "2026-08-24T00:00:00.000Z";

const input: CatalogSeedInput = {
  schema_version: "catalog-seed/v0.1",
  catalog_product_id: catalogProductId,
  source: {
    source_id: sourceId,
    source_type: "official_brand",
    name: "Beauty OS official product page",
    source_url: "https://example.com/product",
    license_note: null,
    retrieved_at: timestamp,
  },
  identity: {
    brand_name: "Beauty OS",
    product_name: "Hydration Serum",
    variant_name: null,
    barcode: "12345678",
    category: "skincare",
    subcategory: "face_care",
    product_type: "serum",
    confidence: 98,
    status: "verified",
  },
};

const sourceRow = {
  id: sourceId,
  source_type: "official_brand",
  name: "Beauty OS official product page",
  source_url: "https://example.com/product",
  license_note: null,
  retrieved_at: timestamp,
  created_at: timestamp,
};

const catalogRow = catalogFixture(catalogProductId);
const otherCatalogRow = catalogFixture(otherCatalogProductId);

describe("CatalogSeedLookupRepository", () => {
  it("requires an explicit trusted service-role read confirmation", () => {
    expect(() => createCatalogSeedLookupRepository(
      {} as SupabaseClient<Database>,
      undefined as never,
    )).toThrow("CATALOG_SEED_TRUSTED_READ_REQUIRED");
  });

  it("inspects id, barcode, raw identity, and normalized identity without writes", async () => {
    const sourceById = maybeSingleQuery({ data: sourceRow, error: null });
    const catalogById = maybeSingleQuery({ data: catalogRow, error: null });
    const barcodeMatch = maybeSingleQuery({ data: otherCatalogRow, error: null });
    const rawIdentity = manyQuery({
      data: [otherCatalogRow, catalogRow],
      error: null,
    });
    const normalizedRows = [otherCatalogRow, catalogRow];
    const rpc = vi.fn().mockResolvedValue({
      data: normalizedRows,
      error: null,
    });
    const catalogQueries = [catalogById, barcodeMatch, rawIdentity];
    let catalogQueryIndex = 0;
    const from = vi.fn((table: string) => {
      if (table === "knowledge_sources") return sourceById.builder;
      if (table === "catalog_products") {
        return catalogQueries[catalogQueryIndex++].builder;
      }
      throw new Error(`unexpected table ${table}`);
    });
    const repository = createCatalogSeedLookupRepository({
      from,
      rpc,
    } as unknown as SupabaseClient<Database>, trustedReadConfirmation());

    await expect(repository.inspect(input)).resolves.toEqual({
      source_by_id: sourceRow,
      catalog_by_id: catalogRow,
      barcode_match: otherCatalogRow,
      raw_identity_matches: [catalogRow, otherCatalogRow],
      normalized_verified_matches: [catalogRow, otherCatalogRow],
    });

    expect(sourceById.eq).toHaveBeenCalledWith("id", sourceId);
    expect(catalogById.eq).toHaveBeenCalledWith("id", catalogProductId);
    expect(barcodeMatch.eq).toHaveBeenCalledWith("barcode", "12345678");
    expect(rawIdentity.eq).toHaveBeenCalledWith("brand_name", "Beauty OS");
    expect(rawIdentity.eq).toHaveBeenCalledWith(
      "product_name",
      "Hydration Serum",
    );
    expect(rawIdentity.isFilter).toHaveBeenCalledWith("variant_name", null);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "find_verified_catalog_products_by_identity",
      {
        p_brand_name: "Beauty OS",
        p_product_name: "Hydration Serum",
      },
    );
    for (const query of [sourceById, catalogById, barcodeMatch, rawIdentity]) {
      expect(query.insert).not.toHaveBeenCalled();
      expect(query.update).not.toHaveBeenCalled();
      expect(query.deleteMutation).not.toHaveBeenCalled();
    }
  });

  it("skips barcode lookup and applies a raw non-null variant filter", async () => {
    const withoutBarcode: CatalogSeedInput = {
      ...input,
      identity: {
        ...input.identity,
        variant_name: "Rich",
        barcode: null,
      },
    };
    const sourceById = maybeSingleQuery({ data: null, error: null });
    const catalogById = maybeSingleQuery({ data: null, error: null });
    const rawIdentity = manyQuery({ data: [], error: null });
    const catalogQueries = [catalogById, rawIdentity];
    let catalogQueryIndex = 0;
    const from = vi.fn((table: string) => {
      if (table === "knowledge_sources") return sourceById.builder;
      if (table === "catalog_products") {
        return catalogQueries[catalogQueryIndex++].builder;
      }
      throw new Error(`unexpected table ${table}`);
    });
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const repository = createCatalogSeedLookupRepository({
      from,
      rpc,
    } as unknown as SupabaseClient<Database>, trustedReadConfirmation());

    const result = await repository.inspect(withoutBarcode);

    expect(result.barcode_match).toBeNull();
    expect(catalogQueryIndex).toBe(2);
    expect(rawIdentity.eq).toHaveBeenCalledWith("variant_name", "Rich");
    expect(rawIdentity.isFilter).not.toHaveBeenCalled();
  });

  it("wraps table errors with a stable code, stage, and cause", async () => {
    const cause = { code: "PGRST001", message: "source read failed" };
    const sourceById = maybeSingleQuery({ data: null, error: cause });
    const from = vi.fn(() => sourceById.builder);
    const rpc = vi.fn();
    const repository = createCatalogSeedLookupRepository({
      from,
      rpc,
    } as unknown as SupabaseClient<Database>, trustedReadConfirmation());

    let thrown: unknown;
    try {
      await repository.inspect(input);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CatalogSeedLookupReadError);
    expect(thrown).toMatchObject({
      code: "CATALOG_SEED_LOOKUP_READ_FAILED",
      stage: "source_by_id",
      cause,
    });
    expect(from).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("wraps normalized identity RPC errors at the correct stage", async () => {
    const sourceById = maybeSingleQuery({ data: null, error: null });
    const catalogById = maybeSingleQuery({ data: null, error: null });
    const barcodeMatch = maybeSingleQuery({ data: null, error: null });
    const rawIdentity = manyQuery({ data: [], error: null });
    const catalogQueries = [catalogById, barcodeMatch, rawIdentity];
    let catalogQueryIndex = 0;
    const from = vi.fn((table: string) => {
      if (table === "knowledge_sources") return sourceById.builder;
      return catalogQueries[catalogQueryIndex++].builder;
    });
    const cause = { code: "P0001", message: "identity query failed" };
    const rpc = vi.fn().mockResolvedValue({ data: null, error: cause });
    const repository = createCatalogSeedLookupRepository({
      from,
      rpc,
    } as unknown as SupabaseClient<Database>, trustedReadConfirmation());

    await expect(repository.inspect(input)).rejects.toMatchObject({
      code: "CATALOG_SEED_LOOKUP_READ_FAILED",
      stage: "normalized_verified_matches",
      cause,
    });
  });
});

function trustedReadConfirmation() {
  return {
    rls_access: "service_role",
    purpose: "catalog_seed_dry_run",
  } as const;
}

function catalogFixture(id: string) {
  return {
    id,
    brand_name: "Beauty OS",
    product_name: "Hydration Serum",
    variant_name: null,
    barcode: id === catalogProductId ? "87654321" : "12345678",
    category: "skincare",
    subcategory: "face_care",
    product_type: "serum",
    primary_source_id: sourceId,
    confidence: 98,
    status: "verified",
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function maybeSingleQuery(result: { data: unknown; error: unknown }) {
  const insert = vi.fn();
  const update = vi.fn();
  const deleteMutation = vi.fn();
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle,
    insert,
    update,
    delete: deleteMutation,
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  return {
    builder,
    eq: builder.eq,
    maybeSingle,
    insert,
    update,
    deleteMutation,
  };
}

function manyQuery(result: { data: unknown; error: unknown }) {
  const insert = vi.fn();
  const update = vi.fn();
  const deleteMutation = vi.fn();
  const then = vi.fn((resolve, reject) =>
    Promise.resolve(result).then(resolve, reject));
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    then,
    insert,
    update,
    delete: deleteMutation,
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.is.mockReturnValue(builder);
  return {
    builder,
    eq: builder.eq,
    isFilter: builder.is,
    insert,
    update,
    deleteMutation,
  };
}
