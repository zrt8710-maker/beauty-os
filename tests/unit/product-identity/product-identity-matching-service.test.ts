import { describe, expect, it, vi } from "vitest";

import type { CatalogIdentityProduct, CatalogIdentityRepository } from "@/server/repositories/catalog-identity-repository";
import { createProductIdentityMatcher } from "@/server/services/product-identity-matching-service";

const source = {
  id: "30000000-0000-4000-8000-000000000001",
  source_type: "official_brand",
  name: "Brand",
  source_url: "https://example.com",
  license_note: null,
  retrieved_at: "2026-08-18T00:00:00.000Z",
  created_at: "2026-08-18T00:00:00.000Z",
};
const catalog: CatalogIdentityProduct = {
  id: "20000000-0000-4000-8000-000000000001",
  brand_name: "CeraVe",
  product_name: "Daily SPF",
  variant_name: null,
  barcode: "12345678",
  category: "skincare",
  subcategory: "sun_care",
  product_type: "sunscreen",
  confidence: 95,
  status: "verified",
  created_at: source.created_at,
  updated_at: source.created_at,
  catalog_image_url: "https://images.example/catalog-product.jpg",
};
const candidate = {
  id: catalog.id,
  catalog_product_id: catalog.id,
  brand_name: catalog.brand_name,
  product_name: catalog.product_name,
  variant_name: catalog.variant_name,
  barcode: catalog.barcode,
  category: catalog.category,
  subcategory: catalog.subcategory,
  product_type: catalog.product_type,
  catalog_confidence: catalog.confidence,
  catalog_image_url: catalog.catalog_image_url,
};

function setup() {
  const knowledge: CatalogIdentityRepository = {
    findById: vi.fn(),
    listIdentityProducts: vi.fn(),
    findByBarcode: vi.fn(),
    findByIdentity: vi.fn(),
  };

  return {
    knowledge,
    matcher: createProductIdentityMatcher(knowledge),
  };
}

describe("ProductIdentityMatcher", () => {
  it("returns a user-confirmed candidate even when taxonomy is not researched", async () => {
    const confirmed: CatalogIdentityProduct = {
      ...catalog,
      status: "candidate",
      category: null,
      subcategory: null,
      product_type: null,
    };
    const { knowledge, matcher } = setup();
    vi.mocked(knowledge.findByBarcode).mockResolvedValue(confirmed);

    await expect(matcher.match({
      brand_name: "HFP",
      product_name: "果酸毛孔净透精华水",
      barcode: "12345678",
    })).resolves.toEqual(expect.objectContaining({
      status: "candidate",
      candidates: [expect.objectContaining({
        catalog_product_id: confirmed.id,
        category: null,
        product_type: null,
      })],
    }));
  });

  it("returns a verified barcode exact candidate without running name matching", async () => {
    const { knowledge, matcher } = setup();
    vi.mocked(knowledge.findByBarcode).mockResolvedValue(catalog);

    const result = await matcher.match({
      brand_name: "Different Brand",
      product_name: "Different Product",
      barcode: "12345678",
    });

    expect(result).toEqual({
      status: "candidate",
      candidates: [candidate],
      confidence: 100,
      match_reason: "barcode_exact",
    });
    expect(knowledge.findByIdentity).not.toHaveBeenCalled();
  });

  it("falls back to normalized brand and product name exact matching", async () => {
    const { knowledge, matcher } = setup();
    vi.mocked(knowledge.findByBarcode).mockResolvedValue(null);
    vi.mocked(knowledge.findByIdentity).mockResolvedValue([
      catalog,
    ]);

    const result = await matcher.match({
      brand_name: " CeraVe ",
      product_name: "Daily-SPF",
      barcode: "not-found",
      category: "skincare",
      product_type: "sunscreen",
    });

    expect(result).toEqual({
      status: "candidate",
      candidates: [candidate],
      confidence: 90,
      match_reason: "normalized_name_exact",
    });
    expect(knowledge.findByIdentity).toHaveBeenCalledWith(
      " CeraVe ",
      "Daily-SPF",
    );
  });

  it("returns no_match when neither barcode nor normalized name resolves", async () => {
    const { knowledge, matcher } = setup();
    vi.mocked(knowledge.findByBarcode).mockResolvedValue(null);
    vi.mocked(knowledge.findByIdentity).mockResolvedValue([]);

    const result = await matcher.match({
      brand_name: "Unknown",
      product_name: "Unknown Product",
      barcode: "not-found",
    });

    expect(result).toEqual({
      status: "no_match",
      candidates: [],
      confidence: null,
      match_reason: null,
    });
  });

  it("returns conflict when the database identity query returns multiple candidates", async () => {
    const duplicate = {
      ...catalog,
      id: "20000000-0000-4000-8000-000000000002",
      variant_name: "Rich",
    };
    const duplicateCandidate = {
      ...candidate,
      id: duplicate.id,
      catalog_product_id: duplicate.id,
      variant_name: duplicate.variant_name,
    };
    const { knowledge, matcher } = setup();
    vi.mocked(knowledge.findByIdentity).mockResolvedValue([
      catalog,
      duplicate,
    ]);

    const result = await matcher.match({
      brand_name: "CeraVe",
      product_name: "Daily SPF",
    });

    expect(result).toEqual({
      status: "match_conflict",
      candidates: [candidate, duplicateCandidate],
      confidence: null,
      match_reason: "normalized_name_exact",
    });
  });

  it("treats the PROYA brand-aware canonical recall as one deterministic existing match", async () => {
    const proya = {
      ...catalog,
      id: "a9aa26bb-1320-424e-a0a2-9ca0684acb99",
      brand_name: "珀莱雅",
      product_name: "珀莱雅双抗精华2.0",
      variant_name: "2.0",
      barcode: null,
      status: "candidate" as const,
    };
    const knowledge = {
      ...setup().knowledge,
      recallByIdentity: vi.fn(async () => ({ exact: [proya], plausible: [], exact_reason: "canonical_name_exact" as const })),
    };

    await expect(createProductIdentityMatcher(knowledge).match({
      brand_name: "珀莱雅",
      product_name: "双抗精华",
    })).resolves.toMatchObject({
      status: "candidate",
      candidates: [{ catalog_product_id: proya.id }],
      match_reason: "normalized_name_exact",
    });
  });

  it("returns a plausible same-brand product only as a Catalog confirmation candidate", async () => {
    const knowledge = {
      ...setup().knowledge,
      recallByIdentity: vi.fn(async () => ({ exact: [], plausible: [catalog], exact_reason: null })),
    };

    await expect(createProductIdentityMatcher(knowledge).recallForConfirmation!({
      brand_name: "CeraVe",
      product_name: "Daily Hydrating SPF",
    })).resolves.toEqual({
      status: "catalog_candidates",
      candidates: [candidate],
      confidence: null,
      match_reason: "plausible_name_recall",
    });
  });

  it("delegates identity lookup to one database query regardless of catalog size", async () => {
    const { knowledge, matcher } = setup();
    vi.mocked(knowledge.findByIdentity).mockResolvedValue([catalog]);

    await matcher.match({
      brand_name: "CeraVe",
      product_name: "Daily SPF",
    });

    expect(knowledge.findByIdentity).toHaveBeenCalledTimes(1);
    expect(knowledge.findByIdentity).toHaveBeenCalledWith(
      "CeraVe",
      "Daily SPF",
    );
  });

  it("uses verified Catalog boundaries to parse concatenated manual text", async () => {
    const { knowledge, matcher } = setup();
    const chineseCatalog = {
      ...catalog,
      brand_name: "安修泽",
      product_name: "油橄榄修颜舒润精华",
    };
    vi.mocked(knowledge.listIdentityProducts).mockImplementation(async ({ search }) =>
      search === "安修泽" ? [chineseCatalog] : []
    );

    const result = await matcher.searchByText!("安修泽油橄榄修颜舒润精华");

    expect(result.exact).toBe(true);
    expect(result.candidates).toEqual([
      expect.objectContaining({
        brand_name: "安修泽",
        product_name: "油橄榄修颜舒润精华",
      }),
    ]);
  });

  it("runs unbranded split recalls concurrently while retaining the first matching split in source order", async () => {
    const { knowledge, matcher } = setup();
    const firstSplit = { ...catalog, id: "20000000-0000-4000-8000-000000000011", brand_name: "ab", product_name: "cdef" };
    const laterSplit = { ...catalog, id: "20000000-0000-4000-8000-000000000012", brand_name: "abc", product_name: "def" };
    const pending = new Map<string, (rows: CatalogIdentityProduct[]) => void>();
    vi.mocked(knowledge.listIdentityProducts).mockImplementation(({ search }) => {
      if (search === "abcdef") return Promise.resolve([]);
      return new Promise<CatalogIdentityProduct[]>((resolve) => {
        pending.set(search!, resolve);
      });
    });

    const lookup = matcher.searchByText!("abcdef");
    await vi.waitFor(() => expect(pending.size).toBe(3));
    // Complete a later split first. The result must still use the first split
    // that the former serial implementation would have encountered.
    pending.get("abc")!([laterSplit]);
    pending.get("abcd")!([]);
    pending.get("ab")!([firstSplit]);

    await expect(lookup).resolves.toEqual({
      exact: true,
      candidates: [expect.objectContaining({ catalog_product_id: firstSplit.id })],
    });
  });

  it("keeps fuzzy Catalog text matches as candidates instead of an exact match", async () => {
    const { knowledge, matcher } = setup();
    const second = { ...catalog, id: "20000000-0000-4000-8000-000000000002", product_name: "小棕瓶眼霜" };
    vi.mocked(knowledge.listIdentityProducts).mockResolvedValue([
      { ...catalog, product_name: "小棕瓶精华" },
      second,
    ]);

    const result = await matcher.searchByText!("小棕瓶");

    expect(result.exact).toBe(false);
    expect(result.candidates).toHaveLength(2);
  });
});
