import { z } from "zod";

import { PRODUCT_TYPES } from "@/schemas/product";
import { PRODUCT_KNOWLEDGE_CARE_ROLE_CODES } from "@/schemas/product-knowledge-curation";

export const PRODUCT_KNOWLEDGE_REVIEW_SCHEMA_VERSION =
  "product-knowledge-review/v0.1" as const;

const nullableConfidence = z.number().int().min(0).max(100).nullable();
const nullableText = (max: number) =>
  z.string().trim().min(1).max(max).nullable();

/**
 * A review manifest is deliberately allowed to be incomplete. Its schema makes
 * drafts durable; the domain validator decides whether a draft may be compiled.
 */
export const productKnowledgeReviewSchema = z
  .object({
    schema_version: z.literal(PRODUCT_KNOWLEDGE_REVIEW_SCHEMA_VERSION),
    candidate_id: z.string().trim().min(1).max(500),
    seed_target: z
      .object({
        catalog_product_id: z.uuid(),
        source_id: z.uuid(),
      })
      .strict(),
    identity_review: z
      .object({
        approved: z.boolean(),
        brand_name_confirmed: z.boolean(),
        product_name_confirmed: z.boolean(),
        variant_confirmed: z.boolean(),
        confidence: nullableConfidence,
        notes: z.string().trim().max(2000),
      })
      .strict(),
    classification_review: z
      .object({
        product_type: z
          .object({
            value: z.enum(PRODUCT_TYPES).nullable(),
            approved: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    decision_review: z
      .object({
        primary_role: z
          .object({
            value: z.enum(PRODUCT_KNOWLEDGE_CARE_ROLE_CODES).nullable(),
            approved: z.boolean(),
            confidence: nullableConfidence,
            evidence_source: nullableText(2000),
            notes: z.string().trim().max(2000),
          })
          .strict(),
        capabilities: z.array(z.never()).length(0),
      })
      .strict(),
    review_metadata: z
      .object({
        reviewed_by: nullableText(200),
        reviewed_at: z.iso.datetime({ offset: true }).nullable(),
      })
      .strict(),
  })
  .strict();

export type ProductKnowledgeReview = z.infer<
  typeof productKnowledgeReviewSchema
>;
