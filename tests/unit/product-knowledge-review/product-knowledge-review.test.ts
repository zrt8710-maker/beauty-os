import { describe, expect, it } from "vitest";

import { catalogSeedInputSchema } from "@/schemas/catalog-seed";
import type { ExternalProductFact } from "@/schemas/external-product-fact";
import type { KnowledgeCandidate } from "@/schemas/knowledge-candidate";
import { productKnowledgeCurationInputSchema } from "@/schemas/product-knowledge-curation";
import { productKnowledgeReviewSchema } from "@/schemas/product-knowledge-review";
import { buildKnowledgeCandidate } from "@/server/domain/knowledge-candidate";
import {
  compileProductKnowledgeSeed,
  createProductKnowledgeReview,
  ProductKnowledgeReviewValidationError,
  validateProductKnowledgeReview,
} from "@/server/domain/product-knowledge-review";

describe("Product Knowledge Review", () => {
  it("creates an explicitly unapproved review draft", () => {
    const review = createProductKnowledgeReview(candidate(), {
      catalogProductId: CATALOG_PRODUCT_ID,
      sourceId: SOURCE_ID,
    });

    expect(review).toMatchObject({
      schema_version: "product-knowledge-review/v0.1",
      identity_review: {
        approved: false,
        brand_name_confirmed: false,
        product_name_confirmed: false,
        variant_confirmed: false,
      },
      classification_review: {
        product_type: { value: "moisturizer", approved: false },
      },
      decision_review: {
        primary_role: { value: "moisturizer", approved: false },
        capabilities: [],
      },
    });
    expect(JSON.stringify(review)).not.toContain("verified");
    expect(validateProductKnowledgeReview(candidate(), review).valid).toBe(false);
    expect(() => compileProductKnowledgeSeed({
      candidate: candidate(),
      review,
      fact: fact(),
    })).toThrow(ProductKnowledgeReviewValidationError);
  });

  it.each([
    "approved",
    "brand_name_confirmed",
    "product_name_confirmed",
    "variant_confirmed",
  ] as const)("rejects identity review when %s is false", (field) => {
    const review = approvedReview();
    review.identity_review[field] = false;

    const result = validateProductKnowledgeReview(candidate(), review);

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) =>
      error.path.join(".") === `identity_review.${field}`)).toBe(true);
  });

  it("rejects an unapproved product type", () => {
    const review = approvedReview();
    review.classification_review.product_type.approved = false;

    expect(validateProductKnowledgeReview(candidate(), review).errors)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "REVIEW_PRODUCT_TYPE_NOT_APPROVED" }),
      ]));
  });

  it("rejects a missing primary role", () => {
    const review = approvedReview();
    review.decision_review.primary_role.value = null;

    expect(validateProductKnowledgeReview(candidate(), review).errors)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "REVIEW_PRIMARY_ROLE_MISSING" }),
      ]));
  });

  it("compiles empty capabilities into both existing Seed schemas", () => {
    const compiled = compileProductKnowledgeSeed({
      candidate: candidate(),
      review: approvedReview(),
      fact: fact(),
    });

    expect(catalogSeedInputSchema.safeParse(compiled.identitySeed).success)
      .toBe(true);
    expect(productKnowledgeCurationInputSchema.safeParse(
      compiled.knowledgeSeed,
    ).success).toBe(true);
    expect(compiled.identitySeed).toMatchObject({
      catalog_product_id: CATALOG_PRODUCT_ID,
      source: {
        source_id: SOURCE_ID,
        source_type: "open_dataset",
        name: "Open Beauty Facts",
      },
      identity: {
        brand_name: "Beauty OS",
        product_name: "Daily Moisturizer",
        category: "skincare",
        subcategory: "face_care",
        product_type: "moisturizer",
        status: "verified",
      },
    });
    expect(compiled.knowledgeSeed).toMatchObject({
      roles: [{
        care_role_code: "moisturizer",
        assignment_kind: "primary",
        status: "verified",
      source_locator: "包装标签与外部产品记录人工交叉核对",
      }],
      capabilities: [],
    });
    expect(JSON.stringify(compiled)).not.toContain("Aqua, Glycerin");
    expect(JSON.stringify(compiled)).not.toContain("risk");
  });
});

const CATALOG_PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";

function candidate(): KnowledgeCandidate {
  return buildKnowledgeCandidate(fact(), { factFileName: "sample.facts.json" });
}

function approvedReview() {
  const review = createProductKnowledgeReview(candidate(), {
    catalogProductId: CATALOG_PRODUCT_ID,
    sourceId: SOURCE_ID,
  });
  return productKnowledgeReviewSchema.parse({
    ...review,
    identity_review: {
      approved: true,
      brand_name_confirmed: true,
      product_name_confirmed: true,
      variant_confirmed: true,
      confidence: 95,
      notes: "包装身份已核对。",
    },
    classification_review: {
      product_type: { value: "moisturizer", approved: true },
    },
    decision_review: {
      primary_role: {
        value: "moisturizer",
        approved: true,
        confidence: 90,
      evidence_source: "包装标签与外部产品记录人工交叉核对",
        notes: "人工确认主要用于保湿步骤。",
      },
      capabilities: [],
    },
    review_metadata: {
      reviewed_by: "developer@example.com",
      reviewed_at: "2026-08-24T12:00:00+08:00",
    },
  });
}

function fact(): ExternalProductFact {
  return {
    schema_version: "external-product-fact/v0.1",
    fact_id: "open_beauty_facts:4006381333931:1787529600",
    identity: {
      brand_name: "Beauty OS",
      product_name: "Daily Moisturizer",
      variant_name: "50 ml",
      barcode: "4006381333931",
      quantity: "50 ml",
    },
    label: {
      categories_tags: ["en:moisturizers"],
      ingredients_text: "Aqua, Glycerin",
    },
    media: { image_front_url: null, stored: false },
    source: {
      provider_code: "open_beauty_facts",
      source_type: "open_dataset",
      source_name: "Open Beauty Facts",
      source_url: "https://example.test/product/4006381333931",
      raw_record_id: "4006381333931",
      retrieved_at: "2026-08-24T04:00:00.000Z",
      modified_at: "2026-08-24T00:00:00.000Z",
      license: "ODbL; image terms apply",
      source_quality: 80,
    },
    warnings: [],
  };
}
