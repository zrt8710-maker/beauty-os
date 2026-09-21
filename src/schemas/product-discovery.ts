import { z } from "zod";

import {
  PRODUCT_CATEGORIES,
  PRODUCT_SUBCATEGORIES,
  PRODUCT_TYPES,
} from "@/schemas/product";

export const PRODUCT_DISCOVERY_SCHEMA_VERSION =
  "product-discovery/v0.1" as const;
export const PRODUCT_DISCOVERY_RESULT_VERSION =
  "product-discovery-result/v0.1" as const;

export const PRODUCT_DISCOVERY_MODES = ["barcode", "name"] as const;
export const PRODUCT_DISCOVERY_MATCH_REASONS = [
  "barcode_exact",
  "normalized_identity_exact",
  "name_contains",
] as const;
export const PRODUCT_DISCOVERY_STATUSES = [
  "no_match",
  "existing_exact",
  "existing_variant_candidates",
  "ambiguous",
  "conflict",
] as const;

const barcodeSearchRequestSchema = z
  .object({
    schema_version: z.literal(PRODUCT_DISCOVERY_SCHEMA_VERSION),
    mode: z.literal("barcode"),
    barcode: z.string().trim().min(8).max(64),
    locale: z.string().trim().min(2).max(20).default("zh-CN"),
    market: z.string().trim().regex(/^[A-Z]{2}$/).default("CN"),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();

const nameSearchRequestSchema = z
  .object({
    schema_version: z.literal(PRODUCT_DISCOVERY_SCHEMA_VERSION),
    mode: z.literal("name"),
    brand_name: z.string().trim().min(1).max(120).nullable().default(null),
    product_name: z.string().trim().min(1).max(200),
    locale: z.string().trim().min(2).max(20).default("zh-CN"),
    market: z.string().trim().regex(/^[A-Z]{2}$/).default("CN"),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();

export const productDiscoveryRequestSchema = z.discriminatedUnion("mode", [
  barcodeSearchRequestSchema,
  nameSearchRequestSchema,
]);

export const normalizedProductDiscoveryQuerySchema = z.discriminatedUnion(
  "mode",
  [
    barcodeSearchRequestSchema.extend({
      barcode: z.string().regex(/^\d{8,14}$/),
    }),
    nameSearchRequestSchema,
  ],
);

export const productDiscoveryIssueSchema = z
  .object({
    code: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(1000),
    fields: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  })
  .strict();

export const productCandidateSourceSchema = z
  .object({
    provider_code: z.string().trim().min(1).max(80),
    source_type: z.enum([
      "official_brand",
      "official_retailer",
      "open_dataset",
      "user_submitted",
      "ai_candidate",
    ]),
    source_name: z.string().trim().min(1).max(200),
    source_url: z.url().max(2000).nullable(),
    retrieved_at: z.iso.datetime({ offset: true }),
    license_note: z.string().trim().min(1).max(2000).nullable(),
    authority_level: z.enum([
      "official",
      "official_retailer",
      "open_dataset",
      "user",
      "ai",
    ]),
    fields_supported: z
      .array(
        z.enum([
          "brand_name",
          "product_name",
          "variant_name",
          "barcode",
          "category",
          "subcategory",
          "product_type",
          "image_preview_url",
        ]),
      )
      .min(1)
      .max(20),
    raw_record_id: z.string().trim().min(1).max(300).nullable(),
    source_quality: z.number().int().min(0).max(100).nullable(),
    attribution_required: z.boolean(),
    image_reuse_note: z.string().trim().min(1).max(1000).nullable(),
  })
  .strict();

export const productDiscoveryCandidateSchema = z
  .object({
    candidate_id: z.string().trim().min(1).max(300),
    candidate_kind: z.enum([
      "internal_verified",
      "external",
      "ai_assisted",
    ]),
    brand_name: z.string().trim().min(1).max(120).nullable(),
    product_name: z.string().trim().min(1).max(200),
    variant_name: z.string().trim().min(1).max(200).nullable(),
    barcode: z.string().trim().min(8).max(32).nullable(),
    category_suggestion: z.enum(PRODUCT_CATEGORIES).nullable(),
    subcategory_suggestion: z.enum(PRODUCT_SUBCATEGORIES).nullable(),
    product_type_suggestion: z.enum(PRODUCT_TYPES).nullable(),
    market: z.string().trim().regex(/^[A-Z]{2}$/).nullable(),
    locale: z.string().trim().min(2).max(20).nullable(),
    image_preview_url: z.url().max(2000).nullable(),
    existing_catalog_product_id: z.uuid().nullable(),
    discovery_score: z.number().int().min(0).max(100),
    match_reason: z.enum(PRODUCT_DISCOVERY_MATCH_REASONS),
    verification_eligibility: z.enum([
      "eligible",
      "needs_review",
      "ineligible",
    ]),
    completeness: z.number().int().min(0).max(100),
    warnings: z.array(productDiscoveryIssueSchema).max(20),
    conflicts: z.array(productDiscoveryIssueSchema).max(20),
    sources: z.array(productCandidateSourceSchema).min(1).max(20),
  })
  .strict();

export const productDiscoveryProviderResultSchema = z
  .object({
    provider_code: z.string().trim().min(1).max(80),
    status: z.enum(["ok", "not_found", "failed"]),
    candidates: z.array(productDiscoveryCandidateSchema).max(50),
    issues: z.array(productDiscoveryIssueSchema).max(20),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status === "not_found" && result.candidates.length > 0) {
      context.addIssue({
        code: "custom",
        message: "not_found Provider 结果不能包含候选。",
        path: ["candidates"],
      });
    }
  });

export const productDiscoveryResultSchema = z
  .object({
    result_version: z.literal(PRODUCT_DISCOVERY_RESULT_VERSION),
    query: normalizedProductDiscoveryQuerySchema,
    status: z.enum(PRODUCT_DISCOVERY_STATUSES),
    candidates: z.array(productDiscoveryCandidateSchema).max(20),
    provider_results: z.array(productDiscoveryProviderResultSchema).max(10),
    warnings: z.array(productDiscoveryIssueSchema).max(50),
  })
  .strict();

export type ProductDiscoveryRequest = z.infer<
  typeof productDiscoveryRequestSchema
>;
export type NormalizedProductDiscoveryQuery = z.infer<
  typeof normalizedProductDiscoveryQuerySchema
>;
export type ProductDiscoveryIssue = z.infer<
  typeof productDiscoveryIssueSchema
>;
export type ProductCandidateSource = z.infer<
  typeof productCandidateSourceSchema
>;
export type ProductDiscoveryCandidate = z.infer<
  typeof productDiscoveryCandidateSchema
>;
export type ProductDiscoveryProviderResult = z.infer<
  typeof productDiscoveryProviderResultSchema
>;
export type ProductDiscoveryResult = z.infer<
  typeof productDiscoveryResultSchema
>;

