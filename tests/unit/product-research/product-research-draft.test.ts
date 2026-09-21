import { describe, expect, it } from "vitest";

import {
  productResearchDraftCreateSchema,
  productResearchDraftReviewUpdateSchema,
  type ProductResearchDraft,
  type ProductResearchDraftCreate,
} from "@/schemas/product-research-draft";
import type { ProductResearchDraftRepository } from "@/server/repositories/product-research-draft-repository";
import { stripLegacyShelfLife } from "@/server/repositories/product-research-draft-repository";
import {
  ProductResearchDraftTransitionError,
  createProductResearchDraftService,
} from "@/server/services/product-research-draft-service";

const candidateCatalogId = "10000000-0000-4000-8000-000000000001";
const verifiedCatalogId = "10000000-0000-4000-8000-000000000002";
const reviewerId = "20000000-0000-4000-8000-000000000001";
const timestamp = "2026-08-27T00:00:00.000Z";

function createInput(catalogProductId = candidateCatalogId, version = 1): ProductResearchDraftCreate {
  return productResearchDraftCreateSchema.parse({
    catalog_product_id: catalogProductId,
    research_version: version,
    overall_confidence: 72,
    created_by: "ai",
    research_model: "future-agent2",
    research_run_id: null,
    research_payload: {
      identity: {
        brand_name: "Example Brand",
        product_name: "Example Serum",
        aliases: ["Example Repair Serum"],
        variant_name: null,
        barcode: null,
        confidence: 80,
        evidence_refs: ["src_1"],
        uncertainties: [],
      },
      ingredients: {
        status: "partial",
        raw_text: ["Aqua, Glycerin"],
        items: [{
          raw_name: "Aqua",
          normalized_name: "Water",
          ingredient_order: 1,
          confidence: 90,
          evidence_refs: ["src_1"],
        }],
        conflicts: [],
        confidence: 75,
      },
      claims: [{
        raw_text: "帮助维持肌肤水润",
        normalized_claim: "hydration",
        confidence: 70,
        evidence_refs: ["src_1"],
      }],
      texture: {
        value: "serum",
        basis: "external_evidence",
        confidence: 80,
        evidence_refs: ["src_1"],
      },
      usage: {
        instructions: ["洁面后使用"],
        am_pm: ["am", "pm"],
        frequency: null,
        routine_order: "cleanse_after",
        leave_on: true,
        rinse_off: false,
        cautions: [],
        confidence: 70,
        evidence_refs: ["src_1"],
      },
      product_type: {
        value: "serum",
        confidence: 80,
        basis: "external_evidence",
        evidence_refs: ["src_1"],
      },
      care_role_candidates: [{
        code: "hydration",
        confidence: 70,
        basis: "ai_inference",
        evidence_refs: ["src_1"],
      }],
      capability_candidates: [{
        code: "hydration",
        confidence: 70,
        basis: "ai_inference",
        evidence_refs: ["src_1"],
      }],
      risk_cautions: [],
      field_confidence: {
        identity: confidence(80), ingredients: confidence(75), claims: confidence(70),
        texture: confidence(80), usage: confidence(70), product_type: confidence(80),
        care_role: confidence(70, true), capability: confidence(70, true), risk: confidence(0, false),
      },
      sources: [{
        source_id: "src_1",
        url: "https://example.test/product",
        title: "Example product page",
        source_type: "official_website",
        authority_tier: 2,
        retrieved_at: timestamp,
      }],
      uncertainties: [],
      conflicts: [],
    },
  });
}

function confidence(score: number, inference = false) {
  return {
    score,
    evidence_refs: score === 0 ? [] : ["src_1"],
    reasons: score === 0 ? ["unknown"] : ["source evidence"],
    has_conflict: false,
    includes_ai_inference: inference,
  };
}

function row(input: ProductResearchDraftCreate, status: ProductResearchDraft["status"] = "draft"): ProductResearchDraft {
  return {
    ...input,
    id: `30000000-0000-4000-8000-${String(input.research_version).padStart(12, "0")}`,
    status,
    reviewed_by: null,
    reviewed_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

describe("Product Research Draft contracts", () => {
  it("rejects shelf-life in new drafts while stripping it from historical payloads", () => {
    const input = createInput();
    const legacyPayload = {
      ...input.research_payload,
      shelf_life: { pao_months: 12 },
      field_confidence: {
        ...input.research_payload.field_confidence,
        shelf_life: confidence(90),
      },
    };

    expect(productResearchDraftCreateSchema.safeParse({
      ...input,
      research_payload: legacyPayload,
    }).success).toBe(false);
    expect(stripLegacyShelfLife(legacyPayload)).toEqual(input.research_payload);
  });

  it("accepts drafts for candidate and verified Catalog identities without publishing knowledge", async () => {
    const created: ProductResearchDraft[] = [];
    const repository = fakeRepository(created);
    const service = createProductResearchDraftService(repository);

    await service.createDraft(createInput(candidateCatalogId));
    await service.createDraft(createInput(verifiedCatalogId));

    expect(created.map((item) => item.catalog_product_id)).toEqual([
      candidateCatalogId,
      verifiedCatalogId,
    ]);
    expect(created.every((item) => item.status === "draft")).toBe(true);
  });

  it("keeps versions separate and returns the latest version", async () => {
    const first = row(createInput(candidateCatalogId, 1));
    const second = row(createInput(candidateCatalogId, 2));
    const repository = fakeRepository([first, second]);
    const service = createProductResearchDraftService(repository);

    await expect(service.getLatestDraft(candidateCatalogId)).resolves.toMatchObject({
      research_version: 2,
    });
    await expect(service.listDrafts(candidateCatalogId)).resolves.toHaveLength(2);
  });

  it("rejects invalid payload references, out-of-range confidence, and invalid review statuses", () => {
    const missingSource = createInput();
    expect(() => productResearchDraftCreateSchema.parse({
      ...missingSource,
      research_payload: {
        ...missingSource.research_payload,
        claims: [{ ...missingSource.research_payload.claims[0], evidence_refs: ["missing"] }],
      },
    })).toThrow();
    expect(() => productResearchDraftCreateSchema.parse({ ...missingSource, overall_confidence: 101 })).toThrow();
    expect(() => productResearchDraftReviewUpdateSchema.parse({ status: "verified", reviewed_by: null, reviewed_at: null })).toThrow();
  });

  it("accepts URL-less package evidence while retaining URL validation and source-id evidence refs", () => {
    const packageLabel = createInput();
    packageLabel.research_payload.sources[0] = {
      ...packageLabel.research_payload.sources[0],
      source_id: "package_label_01",
      url: null,
      source_type: "package_label",
    };
    packageLabel.research_payload.identity.evidence_refs = ["package_label_01"];
    packageLabel.research_payload.ingredients.items[0].evidence_refs = ["package_label_01"];
    packageLabel.research_payload.claims[0].evidence_refs = ["package_label_01"];
    packageLabel.research_payload.texture!.evidence_refs = ["package_label_01"];
    packageLabel.research_payload.usage.evidence_refs = ["package_label_01"];
    packageLabel.research_payload.product_type.evidence_refs = ["package_label_01"];
    packageLabel.research_payload.care_role_candidates[0].evidence_refs = ["package_label_01"];
    packageLabel.research_payload.capability_candidates[0].evidence_refs = ["package_label_01"];
    Object.values(packageLabel.research_payload.field_confidence).forEach((field) => {
      if (field.evidence_refs.length > 0) field.evidence_refs = ["package_label_01"];
    });
    expect(productResearchDraftCreateSchema.safeParse(packageLabel).success).toBe(true);

    const invalidUrl = structuredClone(packageLabel);
    invalidUrl.research_payload.sources[0].url = "not-a-url";
    expect(productResearchDraftCreateSchema.safeParse(invalidUrl).success).toBe(false);

    const missingRef = structuredClone(packageLabel);
    missingRef.research_payload.identity.evidence_refs = ["missing_source"];
    expect(productResearchDraftCreateSchema.safeParse(missingRef).success).toBe(false);
  });

  it("supports the basic review lifecycle without publishing ingredients, roles, or capabilities", async () => {
    const draft = row(createInput());
    const repository = fakeRepository([draft]);
    const service = createProductResearchDraftService(repository);

    await service.updateReviewStatus(draft.id, {
      status: "review_pending", reviewed_by: null, reviewed_at: null,
    });
    await expect(service.updateReviewStatus(draft.id, {
      status: "approved", reviewed_by: reviewerId, reviewed_at: timestamp,
    })).resolves.toMatchObject({ status: "approved", reviewed_by: reviewerId });
    await expect(service.updateReviewStatus(draft.id, {
      status: "review_pending", reviewed_by: null, reviewed_at: null,
    })).rejects.toBeInstanceOf(ProductResearchDraftTransitionError);
  });
});

function fakeRepository(records: ProductResearchDraft[]): ProductResearchDraftRepository {
  return {
    async createDraft(input) {
      const created = row(input);
      records.push(created);
      return created;
    },
    async getDraft(id) {
      return records.find((item) => item.id === id) ?? null;
    },
    async getLatestDraft(catalogProductId) {
      return records.filter((item) => item.catalog_product_id === catalogProductId)
        .sort((left, right) => right.research_version - left.research_version)[0] ?? null;
    },
    async getLatestUsableDraft(catalogProductId) {
      return records.filter((item) => item.catalog_product_id === catalogProductId && ["draft", "review_pending", "approved"].includes(item.status))
        .sort((left, right) => right.research_version - left.research_version)[0] ?? null;
    },
    async listDrafts(catalogProductId) {
      return records.filter((item) => item.catalog_product_id === catalogProductId)
        .sort((left, right) => right.research_version - left.research_version);
    },
    async listUsableDrafts() {
      return records.filter((item) => ["draft", "review_pending", "approved"].includes(item.status));
    },
    async listRecentDrafts() {
      return [...records].sort((left, right) => right.created_at.localeCompare(left.created_at));
    },
    async updatePayload(id, research_payload) {
      const index = records.findIndex((item) => item.id === id);
      if (index < 0) return null;
      const updated = { ...records[index], research_payload, updated_at: timestamp };
      records[index] = updated;
      return updated;
    },
    async updateReviewStatus(id, update) {
      const index = records.findIndex((item) => item.id === id);
      if (index < 0) return null;
      const updated = { ...records[index], ...update, updated_at: timestamp };
      records[index] = updated;
      return updated;
    },
  };
}
