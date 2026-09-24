import { describe, expect, it, vi } from "vitest";

import {
  CatalogIdentityConfirmationRequiredError,
  CatalogVariantConfirmationRequiredError,
  createConfirmedCatalogCandidateRepository,
} from "@/server/repositories/confirmed-catalog-candidate-repository";

const candidate = { brand_name: "Brand", product_name: "Product", variant_name: null, barcode: null, confidence: 82 };

describe("confirmed Catalog candidate lifecycle", () => {
  it("reuses a unique canonical Catalog identity despite full-width, case, spacing, or punctuation differences", async () => {
    const insert = vi.fn();
    const findByIdentity = vi.fn(async () => [catalog("existing-catalog-id")]);
    const repository = createConfirmedCatalogCandidateRepository(catalogClient([], insert) as never, { findByIdentity });

    await expect(repository.findOrCreate({ ...candidate, brand_name: "ＢＲＡＮＤ", product_name: "Pro- duct  " })).resolves.toEqual({ catalogProductId: "existing-catalog-id", created: false });

    expect(findByIdentity).toHaveBeenCalledWith("brand", "product");
    expect(insert).not.toHaveBeenCalled();
  });

  it("keeps barcode exact as the highest-priority reuse key", async () => {
    const insert = vi.fn();
    const repository = createConfirmedCatalogCandidateRepository(
      barcodeCatalogClient([{ id: "barcode-catalog-id" }], insert) as never,
      { findByIdentity: vi.fn(async () => []) },
    );

    await expect(repository.findOrCreate({ ...candidate, barcode: "12345678" })).resolves.toEqual({ catalogProductId: "barcode-catalog-id", created: false });
    expect(insert).not.toHaveBeenCalled();
  });

  it("creates only a candidate-status Catalog row when no canonical row exists", async () => {
    const inserted = { id: "new-catalog-id" };
    const insert = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: inserted, error: null }) }) });
    const repository = createConfirmedCatalogCandidateRepository(
      catalogClient([], insert) as never,
      { findByIdentity: vi.fn(async () => []) },
    );

    await expect(repository.findOrCreate(candidate)).resolves.toEqual({ catalogProductId: "new-catalog-id", created: true });
    expect(insert).toHaveBeenCalledWith({ ...candidate, status: "candidate" });
    expect(insert).not.toHaveBeenCalledWith(expect.objectContaining({ status: "verified" }));
  });

  it("reports a concurrent insertion as reuse, so research can be deduplicated by Catalog ID", async () => {
    const insert = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: null, error: { code: "23505" } }) }) });
    const findByIdentity = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([catalog("concurrent-catalog-id")]);
    const repository = createConfirmedCatalogCandidateRepository(catalogClient([], insert) as never, { findByIdentity });

    await expect(repository.findOrCreate(candidate)).resolves.toEqual({ catalogProductId: "concurrent-catalog-id", created: false });
  });

  it("does not reuse a canonical match with a conflicting variant", async () => {
    const insert = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "new" }, error: null }) }) });
    const repository = createConfirmedCatalogCandidateRepository(
      catalogClient([], insert) as never,
      { findByIdentity: vi.fn(async () => [catalog("existing", "30 ml")]) },
    );

    await expect(repository.findOrCreate({ ...candidate, variant_name: "50 ml", variant_evidence: "packaging_observed" })).resolves.toEqual({ catalogProductId: "new", created: true });
    expect(insert).toHaveBeenCalled();
  });

  it("reuses an existing generic identity when an external 6.0 mention has no durable variant evidence", async () => {
    const insert = vi.fn();
    const repository = createConfirmedCatalogCandidateRepository(
      catalogClient([], insert) as never,
      { findByIdentity: vi.fn(async () => [catalog("canonical", null)]) },
    );

    await expect(repository.findOrCreate({ ...candidate, variant_name: "6.0舒缓版" })).resolves.toEqual({ catalogProductId: "canonical", created: false });
    expect(insert).not.toHaveBeenCalled();
  });

  it("requires confirmation instead of inserting another row when multiple canonical matches exist", async () => {
    const insert = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "new" }, error: null }) }) });
    const repository = createConfirmedCatalogCandidateRepository(
      catalogClient([], insert) as never,
      { findByIdentity: vi.fn(async () => [catalog("first"), catalog("second")]) },
    );

    await expect(repository.findOrCreate(candidate)).rejects.toBeInstanceOf(CatalogVariantConfirmationRequiredError);
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not use a similar alias when canonical brand and product identity differ", async () => {
    const insert = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "new" }, error: null }) }) });
    const findByIdentity = vi.fn(async () => []);
    const repository = createConfirmedCatalogCandidateRepository(catalogClient([], insert) as never, { findByIdentity });

    await expect(repository.findOrCreate({ ...candidate, product_name: "Different Product" })).resolves.toEqual({ catalogProductId: "new", created: true });
    expect(findByIdentity).toHaveBeenCalledWith("brand", "differentproduct");
    expect(insert).toHaveBeenCalled();
  });

  it("reuses a unique canonical recall with a stored variant when the confirmed candidate omits the variant", async () => {
    const insert = vi.fn();
    const existing = catalog("a9aa26bb-1320-424e-a0a2-9ca0684acb99", "2.0");
    const repository = createConfirmedCatalogCandidateRepository(catalogClient([], insert) as never, {
      findByIdentity: vi.fn(async () => [existing]),
      recallByIdentity: vi.fn(async () => ({ exact: [existing], plausible: [], exact_reason: "canonical_name_exact" as const })),
    });

    await expect(repository.findOrCreate({ ...candidate, brand_name: "珀莱雅", product_name: "双抗精华" }))
      .resolves.toEqual({ catalogProductId: existing.id, created: false });
    expect(insert).not.toHaveBeenCalled();
  });

  it("blocks INSERT when an externally confirmed name still collides with a plausible existing Catalog identity", async () => {
    const insert = vi.fn();
    const existing = catalog("a9aa26bb-1320-424e-a0a2-9ca0684acb99", "2.0");
    const repository = createConfirmedCatalogCandidateRepository(catalogClient([], insert) as never, {
      findByIdentity: vi.fn(async () => []),
      recallByIdentity: vi.fn(async () => ({ exact: [], plausible: [existing], exact_reason: null })),
    });

    await expect(repository.findOrCreate({ ...candidate, brand_name: "珀莱雅", product_name: "双抗焕亮精华液" }))
      .rejects.toBeInstanceOf(CatalogIdentityConfirmationRequiredError);
    expect(insert).not.toHaveBeenCalled();
  });

  it("uses post-discovery reconciliation as the final Dr.Ci:Labo duplicate backstop", async () => {
    const insert = vi.fn();
    const existing = catalog("d9e2c05b-7403-43ed-af53-0e5b0aca45d0");
    const reconcileExternalIdentity = vi.fn(async () => [existing]);
    const repository = createConfirmedCatalogCandidateRepository(catalogClient([], insert) as never, {
      findByIdentity: vi.fn(async () => []),
      recallByIdentity: vi.fn(async () => ({ exact: [], plausible: [], exact_reason: null })),
      reconcileExternalIdentity,
    });

    await expect(repository.findOrCreate({
      ...candidate,
      brand_name: "城野医生（Dr.Ci:Labo）",
      product_name: "Labo Labo毛孔细致焕活精华水",
      variant_name: "100ml",
      product_type: null,
      original_identity: {
        brand_name: "城野医生",
        product_name: "毛孔收敛精华水",
      },
    })).rejects.toBeInstanceOf(CatalogIdentityConfirmationRequiredError);
    expect(reconcileExternalIdentity).toHaveBeenCalledWith(expect.objectContaining({
      original_brand_name: "城野医生",
      original_product_name: "毛孔收敛精华水",
    }));
    expect(insert).not.toHaveBeenCalled();
  });
});

function catalog(id: string, variant_name: string | null = null) {
  return {
    id,
    brand_name: "Brand",
    product_name: "Product",
    variant_name,
    barcode: null,
    category: "skincare",
    subcategory: "face_care",
    product_type: "serum",
    confidence: 90,
    status: "candidate",
    created_at: "2026-09-12T00:00:00.000Z",
    updated_at: "2026-09-12T00:00:00.000Z",
  } as const;
}

function catalogClient(rows: Array<{ id: string }>, insert: ReturnType<typeof vi.fn>) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    limit: () => builder,
    is: async () => ({ data: rows, error: null }),
    insert,
  };
  return { from: () => builder };
}

function barcodeCatalogClient(rows: Array<{ id: string }>, insert: ReturnType<typeof vi.fn>) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    limit: async () => ({ data: rows, error: null }),
    insert,
  };
  return { from: () => builder };
}
