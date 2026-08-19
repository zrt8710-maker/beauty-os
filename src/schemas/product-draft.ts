import { z } from "zod";

import {
  PRODUCT_CATEGORIES,
  PRODUCT_SUBCATEGORIES,
  PRODUCT_TYPES,
  PRODUCT_TYPE_META,
} from "@/schemas/product";

export const PRODUCT_DRAFT_SOURCES = ["manual", "image", "ai"] as const;
export const PRODUCT_DRAFT_STATUSES = [
  "pending",
  "confirmed",
  "rejected",
] as const;

const nullableText = (max: number) =>
  z.string().trim().min(1).max(max).nullable();
const nullableBarcode = z.string().trim().min(8).max(32).nullable().default(null);

const draftFields = z.object({
  brand_name: nullableText(120),
  product_name: nullableText(200),
  category: z.enum(PRODUCT_CATEGORIES).nullable(),
  subcategory: z.enum(PRODUCT_SUBCATEGORIES).nullable(),
  product_type: z.enum(PRODUCT_TYPES).nullable(),
  notes: nullableText(2000),
  barcode: nullableBarcode,
});

function validateClassification(
  value: {
    category: (typeof PRODUCT_CATEGORIES)[number] | null;
    subcategory: (typeof PRODUCT_SUBCATEGORIES)[number] | null;
    product_type: (typeof PRODUCT_TYPES)[number] | null;
  },
  context: z.RefinementCtx,
) {
  if (!value.category || !value.subcategory || !value.product_type) {
    return;
  }

  const metadata = PRODUCT_TYPE_META[value.product_type];

  if (
    metadata.category !== value.category ||
    metadata.subcategory !== value.subcategory
  ) {
    context.addIssue({
      code: "custom",
      message: "产品分类、子分类与具体类型不匹配。",
      path: ["product_type"],
    });
  }
}

export const productDraftCreateSchema = z
  .object({ upload_asset_id: z.uuid() })
  .strict();

export const productDraftContentSchema = draftFields
  .strict()
  .superRefine(validateClassification);

export const productDraftUpdateSchema = draftFields
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "至少需要更新一个字段。");

export const productDraftConfirmationSchema = draftFields
  .extend({
    product_name: z.string().trim().min(1).max(200),
    category: z.enum(PRODUCT_CATEGORIES),
    subcategory: z.enum(PRODUCT_SUBCATEGORIES),
    product_type: z.enum(PRODUCT_TYPES),
  })
  .strict()
  .superRefine(validateClassification);

export const productDraftSchema = draftFields.extend({
  id: z.uuid(),
  upload_asset_id: z.uuid(),
  source: z.enum(PRODUCT_DRAFT_SOURCES),
  status: z.enum(PRODUCT_DRAFT_STATUSES),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  candidate_catalog_product_id: z.uuid().nullable().default(null),
  match_source: z.enum(["barcode_exact", "normalized_name_exact"]).nullable().default(null),
  match_confidence: z.number().int().min(0).max(100).nullable().default(null),
  match_evidence: z.string().min(1).max(1000).nullable().default(null),
  knowledge_confirmed_at: z.iso.datetime().nullable().default(null),
});

export const productDraftListQuerySchema = z
  .object({ status: z.enum(PRODUCT_DRAFT_STATUSES).optional() })
  .strict();

export const productDraftIdSchema = z.uuid();

export const productDraftConfirmResultSchema = z.object({
  product_id: z.uuid(),
  owned_product_id: z.uuid(),
});

export const productDraftConfirmSchema = z.object({
  confirmation: z.enum(["link_candidate", "manual"]),
}).strict();

export const productDraftMatchResultSchema = z.object({
  status: z.enum(["no_match", "candidate", "match_conflict"]),
  draft: productDraftSchema,
});

export type ProductDraft = z.infer<typeof productDraftSchema>;
export type ProductDraftUpdateInput = z.infer<typeof productDraftUpdateSchema>;
export type ProductDraftListQuery = z.infer<typeof productDraftListQuerySchema>;
export type ProductDraftConfirmResult = z.infer<
  typeof productDraftConfirmResultSchema
>;
export type ProductDraftMatchResult = z.infer<
  typeof productDraftMatchResultSchema
>;
