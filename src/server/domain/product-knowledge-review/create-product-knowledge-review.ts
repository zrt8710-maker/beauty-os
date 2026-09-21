import { randomUUID } from "node:crypto";

import {
  PRODUCT_KNOWLEDGE_REVIEW_SCHEMA_VERSION,
  productKnowledgeReviewSchema,
  type ProductKnowledgeReview,
} from "@/schemas/product-knowledge-review";
import type { KnowledgeCandidate } from "@/schemas/knowledge-candidate";

export function createProductKnowledgeReview(
  candidate: KnowledgeCandidate,
  options: {
    catalogProductId?: string;
    sourceId?: string;
  } = {},
): ProductKnowledgeReview {
  return productKnowledgeReviewSchema.parse({
    schema_version: PRODUCT_KNOWLEDGE_REVIEW_SCHEMA_VERSION,
    candidate_id: candidate.candidate_id,
    seed_target: {
      catalog_product_id: options.catalogProductId ?? randomUUID(),
      source_id: options.sourceId ?? randomUUID(),
    },
    identity_review: {
      approved: false,
      brand_name_confirmed: false,
      product_name_confirmed: false,
      variant_confirmed: false,
      confidence: null,
      notes: "",
    },
    classification_review: {
      product_type: {
        value: candidate.classification_candidate.product_type,
        approved: false,
      },
    },
    decision_review: {
      primary_role: {
        value: candidate.decision_candidate.primary_role.value,
        approved: false,
        confidence: candidate.decision_candidate.primary_role.confidence,
        evidence_source: null,
        notes: "",
      },
      capabilities: [],
    },
    review_metadata: {
      reviewed_by: null,
      reviewed_at: null,
    },
  });
}
