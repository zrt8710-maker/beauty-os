import { z } from "zod";

import { EXTERNAL_PRODUCT_FACT_SCHEMA_VERSION } from "@/schemas/external-product-fact";
import {
  PRODUCT_CATEGORIES,
  PRODUCT_TYPES,
} from "@/schemas/product";
import { PRODUCT_KNOWLEDGE_CARE_ROLE_CODES } from "@/schemas/product-knowledge-curation";

export const KNOWLEDGE_CANDIDATE_SCHEMA_VERSION =
  "knowledge-candidate/v0.1" as const;

const nullableText = (max: number) =>
  z.string().trim().min(1).max(max).nullable();
const nullableConfidence = z.number().int().min(0).max(100).nullable();

export const knowledgeCandidateWarningSchema = z
  .object({
    code: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(1000),
    fields: z.array(z.string().trim().min(1).max(80)).max(20),
  })
  .strict();

export const knowledgeCandidateSchema = z
  .object({
    schema_version: z.literal(KNOWLEDGE_CANDIDATE_SCHEMA_VERSION),
    candidate_id: z.string().trim().min(1).max(500),
    input_fact: z
      .object({
        file_name: z.string().trim().min(1).max(500),
        fact_id: z.string().trim().min(1).max(400),
        schema_version: z.literal(EXTERNAL_PRODUCT_FACT_SCHEMA_VERSION),
        ingredients_text_reference: z
          .object({
            json_path: z.literal("$.label.ingredients_text"),
            present: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    identity_candidate: z
      .object({
        brand_name: nullableText(120),
        product_name: nullableText(200),
        variant_name: nullableText(200),
        barcode: z.string().regex(/^\d{8,14}$/),
      })
      .strict(),
    classification_candidate: z
      .object({
        category: z.enum(PRODUCT_CATEGORIES).nullable(),
        product_type: z.enum(PRODUCT_TYPES).nullable(),
        mapping_source: z.enum([
          "external_category_tag",
          "unmapped",
          "conflict",
        ]),
        matched_external_value: nullableText(300),
        confidence: nullableConfidence,
      })
      .strict(),
    decision_candidate: z
      .object({
        primary_role: z
          .object({
            value: z.enum(PRODUCT_KNOWLEDGE_CARE_ROLE_CODES).nullable(),
            source: z.enum(["product_type_mapping", "unmapped"]),
            confidence: nullableConfidence,
          })
          .strict(),
        capabilities: z.array(z.never()).length(0),
      })
      .strict(),
    warnings: z.array(knowledgeCandidateWarningSchema).max(100),
  })
  .strict();

export type KnowledgeCandidate = z.infer<typeof knowledgeCandidateSchema>;
export type KnowledgeCandidateWarning = z.infer<
  typeof knowledgeCandidateWarningSchema
>;
