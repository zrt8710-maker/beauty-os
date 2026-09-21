import { describe, expect, it, vi } from "vitest";

import {
  manualSearchToIdentityClue,
  recognitionCandidateToIdentityClue,
} from "@/domain/product-identity-clue";
import { productIdentityClueSchema } from "@/schemas/product-identity-clue";
import { productIdentityResolutionRequestSchema } from "@/schemas/product-identity-resolution";
import { createProductIdentityAgent } from "@/server/product-identity/product-identity-agent";
import { createInternalCatalogIdentityProvider } from "@/server/product-identity/internal-catalog-identity-provider";
import { ExternalProductDiscoveryUnavailableError } from "@/server/product-identity/agent-plan-external-discovery-provider";

const catalogIdentity = {
  catalog_product_id: "10000000-0000-4000-8000-000000000001",
  brand_name: "安修泽",
  product_name: "油橄榄修颜舒润精华",
  variant_name: null,
  barcode: null,
  category: "skincare" as const,
  subcategory: "face_care" as const,
  product_type: "serum" as const,
};

describe("Product Identity Clue and Agent", () => {
  it("normalizes a Recognition candidate into an image clue before resolution", async () => {
    const internal = internalProvider({ status: "no_match" });
    const external = externalProvider();
    const clue = recognitionCandidateToIdentityClue({
      brand_name: "ONCUR",
      product_name: "PHYTO-OLIVE REPAIR MOISTURE ESSENCE",
      confidence: 95,
      observed_text: [
        { value: "50ml", type: "package_size" },
      ],
      recognition_reference: "r".repeat(32),
    });

    await createProductIdentityAgent(internal, external).resolve(clue);

    expect(clue).toMatchObject({ source: "image_recognition", raw_query: null, brand_name: "ONCUR" });
    expect(internal.resolve).toHaveBeenCalledTimes(1);
    expect(external.discover).toHaveBeenCalledWith(expect.objectContaining({
      clue: expect.objectContaining({
        source: "image_recognition",
        recognition_confidence: 95,
        observed_text: [{ value: "50ml", type: "package_size" }],
      }),
      search_results: [],
    }));
  });

  it("keeps an explicitly observed image barcode on the strict Catalog fast path", async () => {
    const internal = internalProvider({ status: "matched", candidate: catalogIdentity, match_method: "barcode_exact" });
    const external = externalProvider();
    const clue = recognitionCandidateToIdentityClue({
      brand_name: "ONCUR", product_name: "包装文字", confidence: 95,
      observed_text: [{ value: "8801234567890", type: "barcode" }], recognition_reference: "r".repeat(32),
    });

    await expect(createProductIdentityAgent(internal, external).resolve(clue)).resolves.toMatchObject({ status: "matched", match_method: "barcode_exact" });
    expect(internal.resolve).toHaveBeenCalledWith(expect.objectContaining({ barcode: "8801234567890" }));
    expect(external.discover).not.toHaveBeenCalled();
  });

  it("returns immediately after an Internal Catalog match without calling external search or discovery", async () => {
    const internal = internalProvider({ status: "matched", candidate: catalogIdentity, match_method: "brand_product_exact" });
    const external = externalProvider();
    const search = { providerCode: "volcengine_search_infinity", search: vi.fn() };

    await expect(createProductIdentityAgent(internal, external, search)
      .resolve(manualSearchToIdentityClue({ query: "安修泽：油橄榄修颜舒润精华" })))
      .resolves.toMatchObject({ status: "matched", catalog_product_id: catalogIdentity.catalog_product_id });

    expect(search.search).not.toHaveBeenCalled();
    expect(external.discover).not.toHaveBeenCalled();
  });

  it("emits timing without changing an Internal Catalog result", async () => {
    const internal = internalProvider({ status: "matched", candidate: catalogIdentity, match_method: "brand_product_exact" });
    const timings: Array<{ stage: string; elapsed_ms: number }> = [];

    await expect(createProductIdentityAgent(internal, externalProvider()).resolve(
      manualSearchToIdentityClue({ query: "安修泽：油橄榄修颜舒润精华" }),
      { timingReporter: (event) => timings.push(event) },
    )).resolves.toMatchObject({
      status: "matched",
      catalog_product_id: catalogIdentity.catalog_product_id,
    });

    expect(timings).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "internal_catalog_total" }),
    ]));
  });

  it("normalizes concatenated manual text and sends it to the same Agent", async () => {
    const confirmedCandidate = { ...catalogIdentity, category: null, subcategory: null, product_type: null };
    const internal = internalProvider({ status: "matched", candidate: confirmedCandidate, match_method: "brand_product_exact" });
    const external = externalProvider();
    const clue = manualSearchToIdentityClue({ query: "安修泽油橄榄修颜舒润精华" });

    const result = await createProductIdentityAgent(internal, external).resolve(clue);

    expect(clue).toEqual({
      source: "manual_search",
      raw_query: "安修泽油橄榄修颜舒润精华",
      brand_name: null,
      product_name: "安修泽油橄榄修颜舒润精华",
      recognition_confidence: null,
      observed_text: [],
    });
    expect(result).toMatchObject({ status: "matched" });
    expect(external.discover).not.toHaveBeenCalled();
  });

  it("returns multiple Catalog candidates for an ambiguous manual phrase", async () => {
    const second = { ...catalogIdentity, catalog_product_id: "10000000-0000-4000-8000-000000000002", product_name: "Advanced Night Repair 小棕瓶" };
    const internal = internalProvider({ status: "catalog_candidates", candidates: [catalogIdentity, second] });

    const result = await createProductIdentityAgent(internal, externalProvider())
      .resolve(manualSearchToIdentityClue({ query: "小棕瓶" }));

    expect(result).toMatchObject({ status: "catalog_candidates" });
    if (result.status === "catalog_candidates") expect(result.candidates).toHaveLength(2);
  });

  it("continues to external discovery only after the user rejects a recalled Catalog candidate", async () => {
    const internal = internalProvider({ status: "catalog_candidates", candidates: [{
      ...catalogIdentity,
      catalog_product_id: "1c101680-836a-4fa7-aff2-f0873ac20d10",
      brand_name: "薇诺娜",
      product_name: "清痘修复精华液",
      product_type: "treatment",
    }] });
    const externalCandidate = discoveredIdentity({
      brand_name: "薇诺娜",
      product_name: "公开搜索产品",
    });
    const external = { providerCode: "external", discover: vi.fn().mockResolvedValue([externalCandidate]) };
    const clue = manualSearchToIdentityClue({ query: "清痘精华液", brand_name: "薇诺娜" });

    await expect(createProductIdentityAgent(internal, external).resolve(clue))
      .resolves.toMatchObject({ status: "catalog_candidates" });
    expect(external.discover).not.toHaveBeenCalled();

    await expect(createProductIdentityAgent(internal, external).resolve(clue, {
      declinedCatalogProductIds: ["1c101680-836a-4fa7-aff2-f0873ac20d10"],
    })).resolves.toMatchObject({
      status: "external_candidate",
      candidates: [{ product_name: "公开搜索产品" }],
    });
    expect(external.discover).toHaveBeenCalledTimes(1);
  });

  it("stops before SearchInfinity and Agent2 when Internal Catalog recalls one plausible existing candidate", async () => {
    const catalogCandidate = {
      id: catalogIdentity.catalog_product_id,
      ...catalogIdentity,
      catalog_confidence: 90,
      catalog_image_url: "https://images.example/proya.jpg",
    };
    const internal = createInternalCatalogIdentityProvider({
      match: vi.fn(),
      recallForConfirmation: vi.fn().mockResolvedValue({
        status: "catalog_candidates",
        candidates: [catalogCandidate],
        confidence: null,
        match_reason: "plausible_name_recall",
      }),
    });
    const external = externalProvider();
    const search = { providerCode: "volcengine_search_infinity", search: vi.fn() };

    await expect(createProductIdentityAgent(internal, external, search).resolve({
      source: "manual_search",
      raw_query: "珀莱雅 双抗焕亮精华液",
      brand_name: "珀莱雅",
      product_name: "双抗焕亮精华液",
      recognition_confidence: null,
      observed_text: [],
    })).resolves.toMatchObject({
      status: "catalog_candidates",
      candidates: [{ catalog_image_url: "https://images.example/proya.jpg" }],
    });

    expect(search.search).not.toHaveBeenCalled();
    expect(external.discover).not.toHaveBeenCalled();
  });

  it("passes a brandless manual clue to the external research boundary, which may safely return unknown", async () => {
    const internal = internalProvider({ status: "no_match" });
    const external = externalProvider();

    const result = await createProductIdentityAgent(internal, external)
      .resolve(manualSearchToIdentityClue({ query: "绿色补水" }));

    expect(result).toMatchObject({ status: "unknown", reason: "no_product_match" });
    expect(external.discover).toHaveBeenCalledWith(expect.objectContaining({
      clue: expect.objectContaining({ source: "manual_search", raw_query: "绿色补水", recognition_confidence: null }),
      search_results: [],
    }));
  });

  it("supplies SearchInfinity leads to Agent2 after an Internal Catalog miss", async () => {
    const internal = internalProvider({ status: "no_match" });
    const external = externalProvider();
    const search = {
      providerCode: "volcengine_search_infinity",
      search: vi.fn().mockResolvedValue([{
        title: "Brand Product 官方旗舰店", url: "https://example.com/product", snippet: "Product", summary: null,
        site_name: "Example", rank_score: 0.9, authority_level: null, authority_description: null,
      }]),
    };

    await createProductIdentityAgent(internal, external, search)
      .resolve(manualSearchToIdentityClue({ query: "Brand Product", brand_name: "Brand" }));

    expect(search.search).toHaveBeenCalledWith({ brand: "Brand", product_name: "Brand Product", variant_name: null });
    expect(external.discover).toHaveBeenCalledWith(expect.objectContaining({
      search_results: [expect.objectContaining({ url: "https://example.com/product" })],
    }));
  });

  it("falls back to supplemental Agent-Plan discovery when SearchInfinity fails", async () => {
    const internal = internalProvider({ status: "no_match" });
    const external = externalProvider();
    const search = { providerCode: "volcengine_search_infinity", search: vi.fn().mockRejectedValue(new Error("SEARCH_DOWN")) };

    await createProductIdentityAgent(internal, external, search)
      .resolve(manualSearchToIdentityClue({ query: "Brand Product", brand_name: "Brand" }));

    expect(external.discover).toHaveBeenCalledWith(expect.objectContaining({ search_results: [] }));
  });

  it("returns an explicit unavailable business outcome when the external provider is unavailable", async () => {
    const external = {
      providerCode: "external",
      discover: vi.fn().mockRejectedValue(new ExternalProductDiscoveryUnavailableError()),
    };

    await expect(createProductIdentityAgent(
      internalProvider({ status: "no_match" }),
      external,
    ).resolve(manualSearchToIdentityClue({ query: "真正不存在的新品", brand_name: "新品牌" })))
      .resolves.toMatchObject({
        status: "unavailable",
        observed_identity: {
          brand_name: "新品牌",
          product_name: "真正不存在的新品",
        },
      });
  });

  it("reconciles an enriched Dr.Ci:Labo result to an existing Catalog candidate before external confirmation", async () => {
    const externalCandidate = discoveredIdentity({
      brand_name: "城野医生（Dr.Ci:Labo）",
      product_name: "Labo Labo毛孔细致焕活精华水",
      variant_name: "100ml",
    });
    const existing = {
      ...catalogIdentity,
      catalog_product_id: "d9e2c05b-7403-43ed-af53-0e5b0aca45d0",
      brand_name: "城野医生",
      product_name: "毛孔收敛爽肤水",
      product_type: "toner" as const,
    };
    const internal = {
      ...internalProvider({ status: "no_match" }),
      reconcileExternal: vi.fn().mockResolvedValue([existing]),
    };
    const external = {
      providerCode: "external",
      discover: vi.fn().mockResolvedValue([externalCandidate]),
    };

    const result = await createProductIdentityAgent(internal, external).resolve({
      source: "manual_search",
      raw_query: "毛孔收敛精华水",
      brand_name: "城野医生",
      product_name: "毛孔收敛精华水",
      recognition_confidence: null,
      observed_text: [],
    });

    expect(internal.reconcileExternal).toHaveBeenCalledWith(
      expect.objectContaining({ brand_name: "城野医生", product_name: "毛孔收敛精华水" }),
      [externalCandidate],
    );
    expect(result).toMatchObject({
      status: "catalog_candidates",
      candidates: [{ catalog_product_id: existing.catalog_product_id }],
      fallback_external_candidates: [{ product_name: externalCandidate.product_name }],
    });
  });

  it("keeps a truly new externally discovered product on the external confirmation path", async () => {
    const externalCandidate = discoveredIdentity({ product_name: "全新焕亮面霜", product_type: "moisturizer" });
    const internal = {
      ...internalProvider({ status: "no_match" }),
      reconcileExternal: vi.fn().mockResolvedValue([]),
    };
    const external = { providerCode: "external", discover: vi.fn().mockResolvedValue([externalCandidate]) };

    await expect(createProductIdentityAgent(internal, external).resolve({
      source: "manual_search",
      raw_query: "全新焕亮面霜",
      brand_name: "新品牌",
      product_name: "全新焕亮面霜",
      recognition_confidence: null,
      observed_text: [],
    })).resolves.toMatchObject({
      status: "external_candidate",
      candidates: [{ product_name: "全新焕亮面霜" }],
    });
  });

  it("rejects confirmed identity and knowledge fields in a clue", () => {
    expect(productIdentityClueSchema.safeParse({
      source: "manual_search",
      raw_query: "小棕瓶",
      brand_name: null,
      product_name: "小棕瓶",
      recognition_confidence: null,
      observed_text: [],
      catalog_product_id: catalogIdentity.catalog_product_id,
    }).success).toBe(false);
  });

  it("requires a Recognition reference only for image clues", () => {
    const manualClue = manualSearchToIdentityClue({ query: "小棕瓶" });
    const imageClue = {
      source: "image_recognition" as const,
      raw_query: null,
      brand_name: "ONCUR",
      product_name: "PHYTO-OLIVE REPAIR MOISTURE ESSENCE",
      recognition_confidence: 95,
      observed_text: [],
    };

    expect(productIdentityResolutionRequestSchema.safeParse({
      identity_clue: manualClue,
      recognition_reference: null,
    }).success).toBe(true);
    expect(productIdentityResolutionRequestSchema.safeParse({
      identity_clue: imageClue,
      recognition_reference: null,
    }).success).toBe(false);
  });
});

function internalProvider(result: unknown) {
  return { providerCode: "catalog", resolve: vi.fn().mockResolvedValue(result) };
}

function externalProvider() {
  return { providerCode: "external", discover: vi.fn().mockResolvedValue([]) };
}

function discoveredIdentity(patch: Record<string, unknown> = {}) {
  return {
    brand_name: "新品牌",
    product_name: "新产品",
    variant_name: null,
    barcode: null,
    product_type: null,
    image_url: null,
    image_source_url: null,
    source_reference: {
      provider: "agent2",
      display_name: "公开产品来源",
      source_name: "公开产品来源",
      url: "https://example.com/product",
    },
    discovery_metadata: {
      aliases: [],
      confidence: 85,
      sources: [{ url: "https://example.com/product", title: "产品", source_type: "official" }],
      uncertainties: [],
    },
    confirmation_token: null,
    confirmation_id: null,
    ...patch,
  };
}
