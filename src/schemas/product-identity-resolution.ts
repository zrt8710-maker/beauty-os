import { z } from "zod";

import { PRODUCT_CATEGORIES, PRODUCT_SUBCATEGORIES, PRODUCT_TYPES } from "@/schemas/product";
import { productIdentityClueSchema } from "@/schemas/product-identity-clue";

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();
const nullableHttpsUrl = z.url().refine((value) => new URL(value).protocol === "https:", "图片 URL 必须使用 HTTPS。").nullable().optional();
const discoveryMetadataSchema = z.object({
  aliases: z.array(z.string().trim().min(1).max(200)).max(20),
  confidence: z.number().int().min(0).max(100),
  sources: z.array(z.object({
    url: z.url().max(2000),
    title: nullableText(500),
    source_type: nullableText(80),
  }).strict()).min(1).max(10),
  uncertainties: z.array(z.string().trim().min(1).max(1000)).max(20),
}).strict();

export const observedProductIdentitySchema = z.object({
  brand_name: nullableText(120),
  product_name: nullableText(200),
  variant_name: nullableText(200),
  barcode: z.string().trim().min(8).max(32).nullable(),
}).strict();

export const catalogProductIdentitySchema = z.object({
  catalog_product_id: z.uuid(),
  brand_name: z.string().trim().min(1).max(120),
  product_name: z.string().trim().min(1).max(200),
  variant_name: nullableText(200),
  barcode: z.string().trim().min(8).max(32).nullable(),
  category: z.enum(PRODUCT_CATEGORIES).nullable(),
  subcategory: z.enum(PRODUCT_SUBCATEGORIES).nullable(),
  product_type: z.enum(PRODUCT_TYPES).nullable(),
  catalog_image_url: nullableHttpsUrl.default(null),
}).strict();

export const externalProductIdentitySchema = z.object({
  brand_name: nullableText(120),
  product_name: z.string().trim().min(1).max(200),
  variant_name: nullableText(200),
  formulation_version: nullableText(80).optional(),
  package_sizes: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  barcode: z.string().trim().min(8).max(32).nullable(),
  product_type: z.enum(PRODUCT_TYPES).nullable(),
  // Display-only evidence metadata. It must never be used by identity decisions.
  image_url: nullableHttpsUrl,
  image_source_url: nullableHttpsUrl,
  source_reference: z.object({
    provider: z.string().trim().min(1).max(100),
    display_name: z.string().trim().min(1).max(200),
    source_name: z.string().trim().min(1).max(200),
    url: z.url().max(2000).nullable(),
  }).strict(),
  // Agent2 evidence is display metadata only; its signed confirmation token
  // retains it until the user actually confirms this candidate.
  discovery_metadata: discoveryMetadataSchema.optional(),
  confirmation_token: z.string().min(32).nullable().default(null),
  confirmation_id: z.uuid().nullable().default(null),
}).strict();

export const externalIdentityConfirmationRequestSchema = externalProductIdentitySchema
  .pick({
    brand_name: true,
    product_name: true,
    variant_name: true,
    barcode: true,
    product_type: true,
    confirmation_token: true,
    confirmation_id: true,
  })
  .extend({
    confirmation_token: z.string().min(32),
    confirmation_id: z.uuid(),
  })
  .strict();

export const productIdentityResolutionRequestSchema = z.object({
  identity_clue: productIdentityClueSchema,
  recognition_reference: z.string().min(32).nullable().default(null),
  declined_catalog_product_ids: z.array(z.uuid()).max(20).default([]),
}).strict().superRefine((request, context) => {
  const hasReference = request.recognition_reference !== null;
  if (request.identity_clue.source === "image_recognition" && !hasReference) {
    context.addIssue({
      code: "custom",
      message: "图片识别线索必须包含有效的识别引用。",
      path: ["recognition_reference"],
    });
  }
  if (request.identity_clue.source === "manual_search" && hasReference) {
    context.addIssue({
      code: "custom",
      message: "手动搜索线索不能携带图片识别引用。",
      path: ["recognition_reference"],
    });
  }
});

export const productIdentityResolutionSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("matched"),
    source: z.literal("beauty_os_catalog"),
    catalog_product_id: z.uuid(),
    product_identity: catalogProductIdentitySchema,
    match_method: z.enum(["barcode_exact", "brand_product_exact"]),
  }).strict(),
  z.object({
    status: z.literal("catalog_candidates"),
    source: z.literal("beauty_os_catalog"),
    candidates: z.array(catalogProductIdentitySchema).min(1).max(20),
    fallback_external_candidates: z.array(externalProductIdentitySchema).max(20).default([]),
  }).strict(),
  z.object({
    status: z.literal("external_candidate"),
    source: z.literal("external_discovery"),
    candidates: z.array(externalProductIdentitySchema).min(1).max(20),
  }).strict(),
  z.object({
    status: z.literal("unknown"),
    observed_identity: observedProductIdentitySchema,
    reason: z.enum(["insufficient_identity_evidence", "no_product_match"]),
  }).strict(),
  z.object({
    status: z.literal("unavailable"),
    observed_identity: observedProductIdentitySchema,
    failure_kind: z.enum(["first_event_timeout", "overall_timeout", "http_error", "schema_error", "empty_output", "unknown"]),
  }).strict(),
]);

export type ObservedProductIdentity = z.infer<typeof observedProductIdentitySchema>;
export type CatalogProductIdentity = z.infer<typeof catalogProductIdentitySchema>;
export type ExternalProductIdentity = z.infer<typeof externalProductIdentitySchema>;
export type ExternalIdentityConfirmationRequest = z.infer<typeof externalIdentityConfirmationRequestSchema>;
export type ProductIdentityResolutionRequest = z.infer<typeof productIdentityResolutionRequestSchema>;
export type ProductIdentityResolution = z.infer<typeof productIdentityResolutionSchema>;
