import { z } from "zod";

import {
  EDITABLE_OWNED_PRODUCT_STATUSES,
  PRODUCT_CATEGORIES,
  PRODUCT_SUBCATEGORIES,
  PRODUCT_TYPES,
  USER_ASSET_CATEGORIES,
} from "@/schemas/product";

const nullableText = (max: number) =>
  z.string().trim().min(1).max(max).nullable();
const nullableDate = z.iso.date().nullable();

export const PRODUCT_IDENTITY_RESOLUTION_KINDS = [
  "catalog",
  "external",
  "unknown",
] as const;

export const productIdentityMatchInputSchema = z
  .object({
    brand_name: nullableText(120),
    product_name: z.string().trim().min(1).max(200),
    barcode: z.string().trim().min(8).max(32).nullable().optional(),
    category: z.enum(PRODUCT_CATEGORIES).nullable().optional(),
    product_type: z.enum(PRODUCT_TYPES).nullable().optional(),
  })
  .strict();

export const productIdentityCandidateSchema = z.object({
  id: z.uuid(),
  catalog_product_id: z.uuid(),
  brand_name: z.string().min(1).max(120),
  product_name: z.string().min(1).max(200),
  variant_name: z.string().min(1).max(200).nullable(),
  barcode: z.string().min(8).max(32).nullable(),
  category: z.enum(PRODUCT_CATEGORIES).nullable(),
  subcategory: z.enum(PRODUCT_SUBCATEGORIES).nullable(),
  product_type: z.enum(PRODUCT_TYPES).nullable(),
  catalog_confidence: z.number().int().min(0).max(100),
  catalog_image_url: z.url().max(2000).nullable().optional(),
});

export const productIdentityMatchResultSchema = z.object({
  status: z.enum(["no_match", "candidate", "match_conflict"]),
  candidates: z.array(productIdentityCandidateSchema),
  confidence: z.number().int().min(0).max(100).nullable(),
  match_reason: z
    .enum(["barcode_exact", "normalized_name_exact"])
    .nullable(),
});

export const createOwnedProductWithIdentitySchema = z
  .object({
    resolution_kind: z.enum(PRODUCT_IDENTITY_RESOLUTION_KINDS),
    brand_name: nullableText(120),
    product_name: z.string().trim().min(1).max(200),
    variant_name: nullableText(200),
    barcode: z.string().trim().min(8).max(32).nullable(),
    category: z.enum(PRODUCT_CATEGORIES),
    product_type: z.enum(PRODUCT_TYPES),
    catalog_product_id: z.uuid().nullable(),
    asset_category: z.enum(USER_ASSET_CATEGORIES).default("other"),
    confirmation_token: z.string().min(32).nullable().default(null),
    idempotency_key: z.uuid(),
    status: z.enum(EDITABLE_OWNED_PRODUCT_STATUSES).default("active"),
    purchase_date: nullableDate,
    manufacture_date: nullableDate.optional(),
    // New Product Add no longer collects an opened date. Keep null/date
    // compatibility for legacy callers while normalizing an omitted value.
    opened_at: nullableDate.optional().default(null),
    expires_on: nullableDate.default(null),
    quantity_remaining_percent: z.number().int().min(0).max(100),
    notes: nullableText(2000),
    package_size: nullableText(100).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.resolution_kind === "catalog" && !input.catalog_product_id) {
      context.addIssue({
        code: "custom",
        message: "Catalog 身份必须包含 catalog_product_id。",
        path: ["catalog_product_id"],
      });
    }

    if (input.resolution_kind !== "catalog" && input.catalog_product_id) {
      context.addIssue({
        code: "custom",
        message: "非 Catalog 身份不能关联 catalog_product_id。",
        path: ["catalog_product_id"],
      });
    }

    if (input.resolution_kind === "external" && !input.confirmation_token) {
      context.addIssue({
        code: "custom",
        message: "External 身份必须包含已确认的识别令牌。",
        path: ["confirmation_token"],
      });
    }

    if (input.resolution_kind !== "external" && input.confirmation_token) {
      context.addIssue({
        code: "custom",
        message: "只有 External 身份可以携带识别令牌。",
        path: ["confirmation_token"],
      });
    }

    if (
      input.purchase_date &&
      input.opened_at &&
      input.opened_at < input.purchase_date
    ) {
      context.addIssue({
        code: "custom",
        message: "开封日期不能早于购买日期。",
        path: ["opened_at"],
      });
    }
  });

export type ProductIdentityCandidate = z.infer<
  typeof productIdentityCandidateSchema
>;
export type ProductIdentityMatchInput = z.infer<
  typeof productIdentityMatchInputSchema
>;
export type ProductIdentityMatchResult = z.infer<
  typeof productIdentityMatchResultSchema
>;
export type CreateOwnedProductWithIdentityInput = z.infer<
  typeof createOwnedProductWithIdentitySchema
>;
export type ProductIdentityResolutionKind =
  (typeof PRODUCT_IDENTITY_RESOLUTION_KINDS)[number];
