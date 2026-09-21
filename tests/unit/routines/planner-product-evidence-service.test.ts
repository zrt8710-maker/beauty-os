import { describe, expect, it, vi } from "vitest";

import {
  createPlannerProductEvidenceService,
  projectIngredientKnowledgePack,
} from "@/server/services/planner-product-evidence-service";

const catalogProductId = "10000000-0000-4000-8000-000000000001";

function draft(input: {
  type: "cleanser" | "toner" | "serum" | "moisturizer";
  claim?: string;
  usage?: string[];
  texture?: string | null;
}) {
  const refs = ["source-1"];
  return {
    catalog_product_id: catalogProductId,
    research_payload: {
      field_confidence: {
        claims: { score: 90, has_conflict: false, evidence_refs: refs },
        usage: { score: 90, has_conflict: false, evidence_refs: refs },
        texture: { score: 90, has_conflict: false, evidence_refs: refs },
        product_type: { score: 90, has_conflict: false, evidence_refs: refs },
      },
      sources: [{ source_id: "source-1", source_type: "official_brand", title: "Official product page" }],
      claims: input.claim ? [{ raw_text: input.claim, normalized_claim: null, evidence_refs: refs }] : [],
      usage: { instructions: input.usage ?? [], cautions: [], evidence_refs: refs },
      texture: input.texture ? { value: input.texture, evidence_refs: refs } : null,
      ingredients: { status: "unknown", items: [] },
      product_type: { value: input.type, basis: "external_evidence", evidence_refs: refs },
    },
  } as any;
}

function evidence(item: ReturnType<typeof draft>) {
  return createPlannerProductEvidenceService({
    drafts: { getLatestUsableDraft: vi.fn().mockResolvedValue(item) },
  }).findByCatalogProductId(catalogProductId);
}

describe("Planner moisturization purpose evidence", () => {
  it("keeps partial named ingredients as advisory fit context without upgrading hard facts", async () => {
    const item = draft({ type: "cleanser", claim: "洁后不紧绷", usage: ["早晚取适量加水起泡使用"], texture: "奶油膏状，可起泡" });
    item.research_payload.ingredients = {
      status: "partial",
      items: [{ raw_name: "Sodium Lauroyl Glycinate", normalized_name: null, confidence: null, evidence_refs: ["source-1"] }],
    } as any;

    await expect(evidence(item)).resolves.toMatchObject({
      supportedPurposes: ["cleansing"],
      ingredients: [],
      advisoryIngredients: [{ name: "Sodium Lauroyl Glycinate", evidenceRefs: ["source-1"] }],
      knownFacts: ["productType", "claims", "texture", "usage", "ingredients"],
      unknownFields: expect.not.arrayContaining(["ingredients"]),
    });
  });

  it("keeps conflicted ingredient sections out of advisory fit context", async () => {
    const item = draft({ type: "cleanser", claim: "洁后不紧绷" });
    item.research_payload.ingredients = {
      status: "partial",
      items: [{ raw_name: "Decyl Glucoside", normalized_name: null, confidence: null, evidence_refs: ["source-1"] }],
      conflicts: [{ field: "ingredients", values: ["A", "B"], severity: "review_required", evidence_refs: ["source-1", "source-1"] }],
    } as any;

    await expect(evidence(item)).resolves.toMatchObject({ advisoryIngredients: [] });
  });

  it("treats a hydrating toner as hydration support, not baseline moisturization", async () => {
    await expect(evidence(draft({ type: "toner", claim: "补水保湿", texture: "清透精华水" }))).resolves.toMatchObject({
      supportedPurposes: ["hydration_support"],
    });
  });

  it("accepts a non-moisturizer for baseline moisturization only with explicit sealing evidence", async () => {
    await expect(evidence(draft({
      type: "serum",
      claim: "补水保湿",
      usage: ["作为晚间护肤最后一步，帮助锁水"],
      texture: "emulsion",
    }))).resolves.toMatchObject({
      supportedPurposes: ["basic_moisturization", "hydration_support"],
    });
  });

  it("accepts a source-backed moisturizer type as a baseline moisturization candidate", async () => {
    await expect(evidence(draft({ type: "moisturizer" }))).resolves.toMatchObject({
      supportedPurposes: ["basic_moisturization"],
    });
  });

  it("merges explicit formal purposes into the same Planner evidence projection", async () => {
    const result = await createPlannerProductEvidenceService({
      drafts: { getLatestUsableDraft: vi.fn().mockResolvedValue(draft({ type: "toner", claim: "补水保湿" })) },
      formal: {
        findByCatalogProductId: vi.fn().mockResolvedValue({
          identity: { product_type: "toner" },
          care_roles: [{ care_role_code: "moisturizer", status: "verified", confidence: 90 }],
          capabilities: [],
        }),
      },
    }).findByCatalogProductId(catalogProductId);

    expect(result).toMatchObject({
      provenance: "formal_verified",
      supportedPurposes: ["hydration_support", "basic_moisturization"],
    });
  });

  it("keeps usable draft purposes when formal knowledge is absent", async () => {
    const result = await createPlannerProductEvidenceService({
      drafts: { getLatestUsableDraft: vi.fn().mockResolvedValue(draft({ type: "toner", claim: "补水保湿" })) },
      formal: { findByCatalogProductId: vi.fn().mockResolvedValue(null) },
    }).findByCatalogProductId(catalogProductId);

    expect(result).toMatchObject({
      provenance: "draft_derived",
      supportedPurposes: ["hydration_support"],
    });
  });

  it("adds Pack knowledge only for a source-backed ingredient actually in the product, even before normalization", async () => {
    const item = draft({ type: "toner", claim: "补水保湿" });
    item.research_payload.ingredients = {
      status: "found",
      items: [{ raw_name: "Niacinamide", normalized_name: null, confidence: null, evidence_refs: ["source-1"] }],
    } as any;
    const result = await createPlannerProductEvidenceService({
      drafts: { getLatestUsableDraft: vi.fn().mockResolvedValue(item) },
      ingredientKnowledgePack: {
        findForIngredientNames: vi.fn().mockResolvedValue([
          {
            canonical_name: "Niacinamide",
            display_name_zh: "烟酰胺",
            functions: ["皮脂调理相关"],
            statement_zh: "外用研究支持烟酰胺与皮脂调理、角质层屏障支持及肤色改善相关。",
            boundary: ["不能仅凭含烟酰胺就断言产品一定控油。"],
            sources: ["https://pubmed.ncbi.nlm.nih.gov/16766489/"],
          },
          {
            canonical_name: "Glycerin",
            display_name_zh: "甘油",
            functions: ["吸湿保湿"],
            statement_zh: "甘油是常用保湿剂。",
            boundary: [],
            sources: ["https://pubmed.ncbi.nlm.nih.gov/18510666/"],
          },
        ]),
      },
    }).findByCatalogProductId(catalogProductId);

    expect(result.ingredientKnowledge).toEqual([expect.objectContaining({
      displayNameZh: "烟酰胺",
      functions: ["皮脂调理相关"],
      statementZh: "外用研究支持烟酰胺与皮脂调理、角质层屏障支持及肤色改善相关。",
      boundaries: ["不能仅凭含烟酰胺就断言产品一定控油。"],
    })]);
  });

  it("keeps an explicit Colloidal Sulfur compatibility match as Sulfur knowledge", () => {
    expect(projectIngredientKnowledgePack(["Colloidal Sulfur"], [{
      canonical_name: "Sulfur",
      display_name_zh: "硫",
      functions: ["角质调理相关"],
      statement_zh: "外用硫具有角质调理相关作用。",
      use_for_today_explanation: [],
      boundary: ["不能仅凭含硫就断言产品一定祛痘。"],
      sources: ["https://pubmed.ncbi.nlm.nih.gov/15303787/"],
      aliases_zh: [],
    }])).toEqual([{
      canonicalName: "Sulfur",
      displayNameZh: "硫",
      functions: ["角质调理相关"],
      statementZh: "外用硫具有角质调理相关作用。",
      boundaries: ["不能仅凭含硫就断言产品一定祛痘。"],
    }]);
  });
});
