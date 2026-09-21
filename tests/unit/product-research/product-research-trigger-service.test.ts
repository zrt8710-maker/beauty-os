import { describe, expect, it, vi } from "vitest";
import type { Agent3ResearchResult } from "@/schemas/product-research";
import type { ProductResearchDraft } from "@/schemas/product-research-draft";

import type { KnowledgeRepository } from "@/server/repositories/knowledge-repository";
import type { ProductResearchDraftRepository } from "@/server/repositories/product-research-draft-repository";
import type { ProductResearchProvider } from "@/server/product-research/volcengine-agent-plan-provider";
import type { ProductSearchProvider } from "@/server/product-search/product-search-provider";
import { createProductResearchTriggerService } from "@/server/services/product-research-trigger-service";
import { buildProductResearchDraftResult } from "@/server/services/product-research-draft-builder";

const catalogId = "10000000-0000-4000-8000-000000000001";
const timestamp = "2026-08-27T00:00:00.000Z";
const researchInput = { catalog_product_id: catalogId, brand_name: "CeraVe", product_name: "Moisturizing Cream", variant_name: null, barcode: null, aliases: [], identity_sources: [] };

function providerResult(): Agent3ResearchResult {
  const supported = (value: unknown, reason: string) => ({ value, evidence_refs: ["source_1"], confidence: 90, reasons: [reason], has_conflict: false, includes_ai_inference: false });
  return {
    research_payload: {
      identity: supported({ aliases: [] }, "Official source"),
      ingredients: supported({ status: "found", raw_text: ["Water"], items: [{ raw_name: "Water", normalized_name: "Water", confidence: 90 }] }, "Official ingredients"),
      claims: supported([{ raw_text: "Provides hydration", normalized_claim: "Provides hydration", confidence: 90 }], "Official claim"),
      texture: supported("cream", "Official texture"),
      usage: supported({ instructions: ["Apply after cleansing"], am_pm: [], frequency: null, routine_order: null, leave_on: true, rinse_off: false, cautions: ["Avoid eyes"] }, "Official usage"),
      product_type: supported("moisturizer", "Official taxonomy"),
      uncertainties: [], conflicts: [],
    },
    sources: [{ source_id: "source_1", url: "https://www.cerave.com/", title: "CeraVe", source_type: "official_brand", authority_tier: 1, retrieved_at: timestamp }],
    overall_confidence: 90,
    research_run_id: "run_1",
  } as unknown as Agent3ResearchResult;
}

function unknownBlock() {
  return { value: null, evidence_refs: [], confidence: 0, reasons: ["unknown"], has_conflict: false, includes_ai_inference: false };
}

function completeDraft(version = 1) {
  const composed = buildProductResearchDraftResult(researchInput, providerResult());
  return {
    ...composed,
    id: `30000000-0000-4000-8000-00000000000${version}`,
    catalog_product_id: catalogId,
    research_version: version,
    status: "draft",
    reviewed_by: null,
    reviewed_at: null,
    created_by: "ai",
    research_model: null,
    created_at: timestamp,
    updated_at: timestamp,
  } as unknown as ProductResearchDraft;
}

function dependencies(overrides: { research?: ProductResearchProvider["research"]; search?: ProductSearchProvider["search"]; latest?: unknown; latestUsable?: unknown; verified?: boolean } = {}) {
  const createDraft = vi.fn(async (input) => ({ ...input, id: "30000000-0000-4000-8000-000000000001", status: "draft", reviewed_by: null, reviewed_at: null, created_at: timestamp, updated_at: timestamp }));
  const drafts: ProductResearchDraftRepository = {
    createDraft, getDraft: vi.fn(), listDrafts: vi.fn(async () => []),
    getLatestDraft: vi.fn(async () => (overrides.latest ?? null) as never), updateReviewStatus: vi.fn(),
    getLatestUsableDraft: vi.fn(async () => (overrides.latestUsable ?? null) as never), listUsableDrafts: vi.fn(async () => []),
    listRecentDrafts: vi.fn(async () => []), updatePayload: vi.fn(),
  };
  const knowledge: KnowledgeRepository = {
    listVerifiedProducts: vi.fn(), findVerifiedByBarcode: vi.fn(), findVerifiedByIdentity: vi.fn(),
    findVerifiedProduct: vi.fn(async () => overrides.verified ? {} as never : null),
    listVerifiedProductIngredients: vi.fn(async () => overrides.verified ? [{}] as never : []),
  };
  const provider: ProductResearchProvider = { providerCode: "volcengine_agent_plan", research: overrides.research ?? vi.fn(async () => providerResult()) };
  const searchProvider: ProductSearchProvider | undefined = overrides.search
    ? { providerCode: "volcengine_search_infinity", search: overrides.search }
    : undefined;
  return { drafts, knowledge, provider, searchProvider, createDraft };
}

describe("Agent3 product research trigger", () => {
  it("researches only a confirmed Catalog ID and saves a provisional AI draft", async () => {
    const setup = dependencies();
    const service = createProductResearchTriggerService({ ...setup, model: "doubao-seed-2.1-turbo" });
    await expect(service.trigger(researchInput)).resolves.toBe("started");
    expect(setup.provider.research).toHaveBeenCalledWith(expect.objectContaining({
      ...researchInput,
      enrichment_focus: expect.arrayContaining(["ingredients", "texture"]),
    }));
    expect(setup.createDraft).toHaveBeenCalledWith(expect.objectContaining({ catalog_product_id: catalogId, created_by: "ai" }));
    expect(setup.createDraft.mock.calls[0]?.[0]).not.toHaveProperty("owned_product_id");
  });

  it("adds SearchInfinity candidate leads before research and safely falls back when search fails", async () => {
    const lead = { title: "CeraVe product", url: "https://search.example/cerave", snippet: null, summary: null, site_name: null, rank_score: null, authority_level: null, authority_description: null };
    const enriched = dependencies({ search: vi.fn(async () => [lead]) });
    await expect(createProductResearchTriggerService({ ...enriched, model: null }).rerun(researchInput)).resolves.toBe("started");
    expect(enriched.provider.research).toHaveBeenCalledWith(expect.objectContaining({ search_results: [lead] }));

    const fallback = dependencies({ search: vi.fn(async () => { throw new Error("search unavailable"); }) });
    await expect(createProductResearchTriggerService({ ...fallback, model: null }).rerun({ ...researchInput, catalog_product_id: "10000000-0000-4000-8000-000000000002" })).resolves.toBe("started");
    expect(fallback.searchProvider?.search).toHaveBeenCalledTimes(6);
    expect(fallback.provider.research).toHaveBeenCalledWith(expect.objectContaining({ search_results: [] }));
  });

  it("deduplicates a complete draft and retries transient provider failures once", async () => {
    const existing = {
      research_version: 1,
      status: "draft",
      ...(() => {
        const result = providerResult();
        return {
          research_payload: {
            identity: { brand_name: "CeraVe", product_name: "Moisturizing Cream", variant_name: null, barcode: null, aliases: [], confidence: 90, evidence_refs: ["source_1"], uncertainties: [] },
            ingredients: { status: "found", raw_text: ["Water"], items: [{ raw_name: "Water", normalized_name: "Water", ingredient_order: null, confidence: 90, evidence_refs: ["source_1"] }], conflicts: [], confidence: 90 },
            claims: [{ raw_text: "Provides hydration", normalized_claim: "Provides hydration", confidence: 90, evidence_refs: ["source_1"] }],
            texture: { value: "cream", basis: "external_evidence", confidence: 90, evidence_refs: ["source_1"] },
            usage: { instructions: ["Apply after cleansing"], am_pm: [], frequency: null, routine_order: null, leave_on: null, rinse_off: null, cautions: ["Avoid eyes"], confidence: 90, evidence_refs: ["source_1"] },
            product_type: { value: "moisturizer", confidence: 90, basis: "external_evidence", evidence_refs: ["source_1"] },
            care_role_candidates: [], capability_candidates: [], risk_cautions: [],
            field_confidence: Object.fromEntries(["identity", "ingredients", "claims", "texture", "usage", "product_type", "care_role", "capability", "risk"].map((field) => [field, { score: 90, evidence_refs: ["source_1"], reasons: [], has_conflict: false, includes_ai_inference: false }])),
            sources: result.sources, uncertainties: [], conflicts: [],
          },
        };
      })(),
    };
    const first = dependencies({ latest: existing, latestUsable: existing });
    await expect(createProductResearchTriggerService({ ...first, model: null }).trigger(researchInput)).resolves.toBe("existing_draft");
    expect(first.provider.research).not.toHaveBeenCalled();

    const transientResearch = vi.fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(providerResult());
    const second = dependencies({ research: transientResearch });
    const service = createProductResearchTriggerService({ ...second, model: null });
    await expect(service.trigger(researchInput)).resolves.toBe("started");
    expect(second.provider.research).toHaveBeenCalledTimes(2);
    expect(second.createDraft).toHaveBeenCalledTimes(1);
  });

  it("does not mistake verified identity plus one ingredient for complete Product Knowledge", async () => {
    const setup = dependencies({ verified: true });
    await expect(createProductResearchTriggerService({ ...setup, model: null }).trigger(researchInput)).resolves.toBe("started");
    expect(setup.provider.research).toHaveBeenCalledTimes(1);
    expect(setup.createDraft).toHaveBeenCalledTimes(1);
  });

  it("retains the verified shortcut only when effective core knowledge is complete", async () => {
    const existing = completeDraft();
    const setup = dependencies({ verified: true, latest: existing, latestUsable: existing });
    await expect(createProductResearchTriggerService({ ...setup, model: null }).trigger(researchInput)).resolves.toBe("verified_knowledge");
    expect(setup.provider.research).not.toHaveBeenCalled();
    expect(setup.createDraft).not.toHaveBeenCalled();
  });

  it("does not create a snapshot when every research section is unknown", async () => {
    const setup = dependencies({ research: vi.fn(async () => ({
      ...providerResult(),
      research_payload: {
        ...providerResult().research_payload,
        identity: { value: null, evidence_refs: [], confidence: 0, reasons: ["unknown"], has_conflict: false, includes_ai_inference: false },
        ingredients: { value: null, evidence_refs: [], confidence: 0, reasons: ["unknown"], has_conflict: false, includes_ai_inference: false },
        claims: { value: null, evidence_refs: [], confidence: 0, reasons: ["unknown"], has_conflict: false, includes_ai_inference: false },
        texture: { value: null, evidence_refs: [], confidence: 0, reasons: ["unknown"], has_conflict: false, includes_ai_inference: false },
        usage: { value: null, evidence_refs: [], confidence: 0, reasons: ["unknown"], has_conflict: false, includes_ai_inference: false },
        product_type: { value: null, evidence_refs: [], confidence: 0, reasons: ["unknown"], has_conflict: false, includes_ai_inference: false },
      },
    })) });
    await expect(createProductResearchTriggerService({ ...setup, model: "doubao-seed-2.1-turbo" }).rerun(researchInput)).resolves.toBe("failed");
    expect(setup.createDraft).not.toHaveBeenCalled();
  });

  it("lets an explicit Admin rerun create the next immutable AI snapshot", async () => {
    const existing = { research_version: 4, status: "draft" };
    const setup = dependencies({ latest: existing, verified: true });
    const service = createProductResearchTriggerService({ ...setup, model: "doubao-seed-2.1-turbo" });

    await expect(service.rerun(researchInput)).resolves.toBe("started");

    expect(setup.provider.research).toHaveBeenCalledWith(expect.objectContaining({
      ...researchInput,
      enrichment_focus: expect.arrayContaining(["ingredients", "claims", "texture"]),
    }));
    expect(setup.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      catalog_product_id: catalogId,
      research_version: 5,
      created_by: "ai",
    }));
    expect(existing).toEqual({ research_version: 4, status: "draft" });
  });

  it("reuses persisted identity aliases and official identity sources as request-local classifier context", async () => {
    const existing = completeDraft();
    existing.research_payload.identity.aliases = ["Moisturizing Cream Lotion"];
    existing.research_payload.identity.evidence_refs = ["source_1"];
    existing.research_payload.sources[0] = {
      ...existing.research_payload.sources[0],
      url: "https://www.cerave.com/skincare/moisturizers/moisturizing-cream",
      source_type: "official_product_page",
    };
    const research = vi.fn(async () => providerResult());
    const setup = dependencies({ latest: existing, latestUsable: existing, research });

    await createProductResearchTriggerService({ ...setup, model: null }).rerun(researchInput);

    expect(research).toHaveBeenCalledWith(expect.objectContaining({
      aliases: ["Moisturizing Cream Lotion"],
      identity_sources: [expect.objectContaining({
        url: "https://www.cerave.com/skincare/moisturizers/moisturizing-cream",
        source_type: "official_product_page",
      })],
    }));
    expect(researchInput).toMatchObject({ aliases: [], identity_sources: [] });
  });

  it("normalizes a trusted localized identity source before Admin rerun research", async () => {
    const existing = completeDraft();
    existing.research_payload.identity.evidence_refs = ["source_1"];
    existing.research_payload.sources[0] = {
      ...existing.research_payload.sources[0],
      url: "https://www.brand.example/products/serum",
      source_type: "官方产品页",
    };
    const research = vi.fn(async () => providerResult());
    const setup = dependencies({ latest: existing, latestUsable: existing, research });

    await createProductResearchTriggerService({ ...setup, model: null }).rerun(researchInput);

    expect(research).toHaveBeenCalledWith(expect.objectContaining({
      identity_sources: [expect.objectContaining({
        url: "https://www.brand.example/products/serum",
        source_type: "official_product_page",
      })],
    }));
  });

  it("keeps existing snapshots untouched when an explicit rerun fails", async () => {
    const existing = { research_version: 2, status: "draft" };
    const setup = dependencies({ latest: existing, research: vi.fn(async () => { throw new Error("network"); }) });

    await expect(createProductResearchTriggerService({ ...setup, model: null }).rerun(researchInput)).resolves.toBe("failed");

    expect(setup.createDraft).not.toHaveBeenCalled();
    expect(existing).toEqual({ research_version: 2, status: "draft" });
  });

  it("keeps the first usable partial draft when automatic continuation fails", async () => {
    const sparse = providerResult();
    sparse.research_payload.ingredients = {
      value: null, evidence_refs: [], confidence: 0, reasons: ["unknown"], has_conflict: false, includes_ai_inference: false,
    };
    sparse.research_payload.claims = {
      value: null, evidence_refs: [], confidence: 0, reasons: ["unknown"], has_conflict: false, includes_ai_inference: false,
    };
    sparse.research_payload.texture = {
      value: null, evidence_refs: [], confidence: 0, reasons: ["unknown"], has_conflict: false, includes_ai_inference: false,
    };
    const research = vi.fn()
      .mockResolvedValueOnce(sparse)
      .mockRejectedValue(new Error("continuation unavailable"));
    const setup = dependencies({ research });

    await expect(createProductResearchTriggerService({ ...setup, model: null }).trigger(researchInput)).resolves.toBe("partial");

    expect(setup.createDraft).toHaveBeenCalledTimes(1);
    expect(setup.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      catalog_product_id: catalogId,
      research_version: 1,
    }));
  });

  it("uses gap-targeted usage queries in round two and preserves round-one facts", async () => {
    const first = providerResult();
    first.research_payload.usage = unknownBlock();
    const second = providerResult();
    second.research_payload.ingredients = unknownBlock();
    second.research_payload.claims = unknownBlock();
    second.research_payload.texture = unknownBlock();
    second.research_payload.product_type = unknownBlock();
    const research = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const search = vi.fn<ProductSearchProvider["search"]>(async () => []);
    const setup = dependencies({ research, search });

    await expect(createProductResearchTriggerService({ ...setup, model: null }).trigger(researchInput)).resolves.toBe("started");

    expect(research).toHaveBeenNthCalledWith(1, expect.objectContaining({ research_mode: "broad" }));
    expect(research).toHaveBeenNthCalledWith(2, expect.objectContaining({
      research_mode: "gap_targeted",
      enrichment_focus: expect.arrayContaining(["usage", "cautions"]),
    }));
    const queries = search.mock.calls.map(([input]) => input.query);
    expect(queries.slice(-1)[0]).toContain("使用方法 注意事项");
    expect(setup.createDraft).toHaveBeenCalledTimes(2);
    expect(setup.createDraft.mock.calls[1]?.[0].research_payload.usage.instructions).toEqual(["Apply after cleansing"]);
  });

  it("uses an ingredient-specific query when ingredients remain missing", async () => {
    const first = providerResult();
    first.research_payload.ingredients = unknownBlock();
    const second = providerResult();
    second.research_payload.claims = unknownBlock();
    second.research_payload.texture = unknownBlock();
    second.research_payload.usage = unknownBlock();
    second.research_payload.product_type = unknownBlock();
    const search = vi.fn<ProductSearchProvider["search"]>(async () => []);
    const setup = dependencies({ research: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second), search });

    await createProductResearchTriggerService({ ...setup, model: null }).trigger(researchInput);

    expect(search.mock.calls.map(([input]) => input.query)).toContainEqual(expect.stringContaining("成分表 全成分"));
  });

  it("returns partial when a successful second round adds no useful knowledge", async () => {
    const sparse = providerResult();
    sparse.research_payload.usage = unknownBlock();
    const setup = dependencies({ research: vi.fn(async () => sparse) });

    await expect(createProductResearchTriggerService({ ...setup, model: null }).trigger(researchInput)).resolves.toBe("partial");
    expect(setup.createDraft).toHaveBeenCalledTimes(2);
  });

  it("emits one safe terminal record for every executable terminal outcome", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      await createProductResearchTriggerService({ ...dependencies(), model: null }).trigger(researchInput);
      const complete = completeDraft();
      await createProductResearchTriggerService({ ...dependencies({ latest: complete, latestUsable: complete }), model: null }).trigger(researchInput);
      await createProductResearchTriggerService({ ...dependencies({ verified: true, latest: complete, latestUsable: complete }), model: null }).trigger(researchInput);
      await createProductResearchTriggerService({ ...dependencies(), provider: null, model: null }).trigger(researchInput);
      const sparse = providerResult();
      sparse.research_payload.usage = unknownBlock();
      await createProductResearchTriggerService({ ...dependencies({ research: vi.fn(async () => sparse) }), model: null }).trigger(researchInput);

      const outcomes = info.mock.calls.flatMap(([label, payload]) =>
        label === "AGENT3_RESEARCH_DEBUG"
          && typeof payload === "object"
          && payload !== null
          && "stage" in payload
          && payload.stage === "research_terminal"
          && "outcome" in payload
          ? [payload.outcome]
          : []);
      expect(outcomes).toEqual(expect.arrayContaining(["completed", "existing_draft", "verified_knowledge", "failed", "partial"]));
    } finally {
      info.mockRestore();
    }
  });
});
