import { z } from "zod";

import { PRODUCT_TYPES } from "@/schemas/product";

const lookupContextSchema = {
  locale: z.string().trim().min(2).max(20).default("zh-CN"),
  market: z.string().trim().regex(/^[A-Z]{2}$/).default("CN"),
  limit: z.number().int().min(1).max(20).default(10),
};

const barcodeLookupSchema = z
  .object({
    mode: z.literal("barcode"),
    barcode: z.string().trim().min(8).max(64),
    ...lookupContextSchema,
  })
  .strict();

const nameLookupSchema = z
  .object({
    mode: z.literal("name"),
    brand_name: z.string().trim().min(1).max(120).nullable().default(null),
    product_name: z.string().trim().min(1).max(200),
    ...lookupContextSchema,
  })
  .strict();

export const userProductLookupRequestSchema = z.discriminatedUnion("mode", [
  barcodeLookupSchema,
  nameLookupSchema,
]);

export const userProductLookupCandidateSchema = z
  .object({
    brand_name: z.string().trim().min(1).max(120).nullable(),
    product_name: z.string().trim().min(1).max(200),
    variant_name: z.string().trim().min(1).max(200).nullable(),
    barcode: z.string().trim().min(8).max(32).nullable(),
    image_preview_url: z.url().max(2000).nullable(),
    candidate_kind: z.enum(["catalog", "external"]),
    candidate_source: z.enum(["catalog", "ai", "external"]),
    catalog_product_id: z.uuid().nullable(),
    suggested_product_type: z.enum(PRODUCT_TYPES).nullable(),
    requires_confirmation: z.boolean(),
    confirmation_token: z.string().min(32).nullable().default(null),
    confirmation_id: z.uuid().nullable().default(null),
    source_reference: z.object({
      provider: z.string().trim().min(1).max(100),
      display_name: z.string().trim().min(1).max(200),
      url: z.url().max(2000).nullable(),
    }).strict().optional(),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.candidate_kind === "catalog" && !candidate.catalog_product_id) {
      context.addIssue({
        code: "custom",
        message: "Catalog candidate requires catalog_product_id.",
        path: ["catalog_product_id"],
      });
    }
    if (candidate.candidate_kind === "external" && candidate.catalog_product_id) {
      context.addIssue({
        code: "custom",
        message: "External candidate cannot include catalog_product_id.",
        path: ["catalog_product_id"],
      });
    }
    if (candidate.candidate_kind === "catalog" && candidate.candidate_source !== "catalog") {
      context.addIssue({
        code: "custom",
        message: "Catalog candidate must retain catalog source.",
        path: ["candidate_source"],
      });
    }
    if (candidate.candidate_source === "ai" && candidate.candidate_kind !== "external") {
      context.addIssue({
        code: "custom",
        message: "AI candidate must use external identity resolution.",
        path: ["candidate_kind"],
      });
    }
  });

export const userProductLookupResponseSchema = z
  .object({
    lookup_status: z.enum([
      "catalog_match",
      "external_candidate",
      "multiple_candidates",
      "conflict",
      "no_match",
      "partial",
    ]),
    candidates: z.array(userProductLookupCandidateSchema).max(20),
  })
  .strict();

export type UserProductLookupRequest = z.infer<
  typeof userProductLookupRequestSchema
>;
export type UserProductLookupResponse = z.infer<
  typeof userProductLookupResponseSchema
>;
