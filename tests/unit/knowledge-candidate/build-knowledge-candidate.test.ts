import { describe, expect, it } from "vitest";

import type { ExternalProductFact } from "@/schemas/external-product-fact";
import { knowledgeCandidateSchema } from "@/schemas/knowledge-candidate";
import { buildKnowledgeCandidate } from "@/server/domain/knowledge-candidate";

describe("KnowledgeCandidateBuilder", () => {
  it.each([
    ["en:moisturizers", "moisturizer", "moisturizer"],
    ["en:facial-cleansers", "cleanser", "cleanser"],
  ] as const)(
    "maps %s deterministically to product type and role candidates",
    (tag, productType, role) => {
      const candidate = buildKnowledgeCandidate(fact([tag]), {
        factFileName: "4006381333931.facts.json",
      });

      expect(candidate).toMatchObject({
        schema_version: "knowledge-candidate/v0.1",
        input_fact: {
          file_name: "4006381333931.facts.json",
          ingredients_text_reference: {
            json_path: "$.label.ingredients_text",
            present: true,
          },
        },
        classification_candidate: {
          category: "skincare",
          product_type: productType,
          mapping_source: "external_category_tag",
          matched_external_value: tag,
          confidence: 85,
        },
        decision_candidate: {
          primary_role: {
            value: role,
            source: "product_type_mapping",
            confidence: 85,
          },
          capabilities: [],
        },
      });
    },
  );

  it("keeps unsupported external categories unknown", () => {
    const candidate = buildKnowledgeCandidate(fact(["en:serums"]), {
      factFileName: "product.facts.json",
    });

    expect(candidate).toMatchObject({
      classification_candidate: {
        category: null,
        product_type: null,
        mapping_source: "unmapped",
        matched_external_value: null,
        confidence: null,
      },
      decision_candidate: {
        primary_role: {
          value: null,
          source: "unmapped",
          confidence: null,
        },
        capabilities: [],
      },
      warnings: [expect.objectContaining({
        code: "KNOWLEDGE_CANDIDATE_CLASSIFICATION_UNMAPPED",
      })],
    });
  });

  it("keeps conflicting deterministic mappings unknown for human review", () => {
    const candidate = buildKnowledgeCandidate(
      fact(["en:moisturizers", "en:cleansers"]),
      { factFileName: "product.facts.json" },
    );

    expect(candidate).toMatchObject({
      classification_candidate: {
        product_type: null,
        mapping_source: "conflict",
      },
      decision_candidate: {
        primary_role: { value: null },
        capabilities: [],
      },
      warnings: [expect.objectContaining({
        code: "KNOWLEDGE_CANDIDATE_CLASSIFICATION_CONFLICT",
      })],
    });
  });

  it("does not let ingredient text affect classification, safety, or capabilities", () => {
    const harmless = buildKnowledgeCandidate(
      fact(["en:moisturizers"], "Aqua, Glycerin"),
      { factFileName: "product.facts.json" },
    );
    const alarming = buildKnowledgeCandidate(
      fact(["en:moisturizers"], "Unknown irritant, marketing active"),
      { factFileName: "product.facts.json" },
    );

    expect(alarming.classification_candidate).toEqual(
      harmless.classification_candidate,
    );
    expect(alarming.decision_candidate).toEqual(harmless.decision_candidate);
    expect(alarming.decision_candidate.capabilities).toEqual([]);
    expect(alarming).not.toHaveProperty("risk");
    expect(alarming).not.toHaveProperty("safety");
    expect(JSON.stringify(alarming)).not.toContain("verified");
  });

  it("rejects capability or verification fields at the candidate boundary", () => {
    const candidate = buildKnowledgeCandidate(fact(["en:moisturizers"]), {
      factFileName: "product.facts.json",
    });

    expect(knowledgeCandidateSchema.safeParse({
      ...candidate,
      decision_candidate: {
        ...candidate.decision_candidate,
        capabilities: ["hydration"],
      },
    }).success).toBe(false);
    expect(knowledgeCandidateSchema.safeParse({
      ...candidate,
      verified: true,
    }).success).toBe(false);
  });
});

function fact(
  categories: string[],
  ingredientsText = "Aqua, Glycerin",
): ExternalProductFact {
  return {
    schema_version: "external-product-fact/v0.1",
    fact_id: "open_beauty_facts:4006381333931:1787529600",
    identity: {
      brand_name: "Beauty OS",
      product_name: "Candidate Product",
      variant_name: "30 ml",
      barcode: "4006381333931",
      quantity: "30 ml",
    },
    label: {
      categories_tags: categories,
      ingredients_text: ingredientsText,
    },
    media: { image_front_url: null, stored: false },
    source: {
      provider_code: "open_beauty_facts",
      source_type: "open_dataset",
      source_name: "Open Beauty Facts",
      source_url:
      "https://example.test/product/4006381333931",
      raw_record_id: "4006381333931",
      retrieved_at: "2026-08-24T03:00:00.000Z",
      modified_at: "2026-08-24T00:00:00.000Z",
      license: "ODbL; image terms apply",
      source_quality: 80,
    },
    warnings: [],
  };
}
