import { z } from "zod";

import { PRODUCT_CATEGORIES, PRODUCT_SUBCATEGORIES, PRODUCT_TYPES } from "@/schemas/product";

const sourceSchema = z.object({
  id: z.uuid(),
  source_type: z.enum(["official_brand", "official_retailer", "open_dataset", "user_submitted", "ai_candidate"]),
  name: z.string().min(1).max(200),
  source_url: z.url().nullable(),
  license_note: z.string().max(2000).nullable(),
  retrieved_at: z.iso.datetime({ offset: true }),
});

export const catalogProductSchema = z.object({
  id: z.uuid(),
  brand_name: z.string().min(1).max(120),
  product_name: z.string().min(1).max(200),
  variant_name: z.string().min(1).max(200).nullable(),
  barcode: z.string().min(8).max(32).nullable(),
  category: z.enum(PRODUCT_CATEGORIES),
  subcategory: z.enum(PRODUCT_SUBCATEGORIES),
  product_type: z.enum(PRODUCT_TYPES),
  confidence: z.number().int().min(0).max(100),
  status: z.literal("verified"),
  source: sourceSchema,
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

export const catalogIngredientSchema = z.object({
  id: z.uuid(),
  inci_name: z.string().min(1).max(200),
  display_name: z.string().min(1).max(200).nullable(),
  aliases: z.array(z.string().min(1).max(200)).max(20),
  ingredient_kind: z.string().min(1).max(80).nullable(),
});

export const catalogProductIngredientSchema = z.object({
  ingredient_order: z.number().int().min(1).max(500).nullable(),
  confidence: z.number().int().min(0).max(100),
  evidence_note: z.string().max(2000).nullable(),
  ingredient: catalogIngredientSchema,
  source: sourceSchema,
});

export const catalogProductListQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).regex(/^[\p{L}\p{N}\s&+'’./-]+$/u, "搜索词包含不支持的字符。").optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

export const catalogProductIdSchema = z.uuid();

export type CatalogProduct = z.infer<typeof catalogProductSchema>;
export type CatalogProductIngredient = z.infer<typeof catalogProductIngredientSchema>;
export type CatalogProductListQuery = z.infer<typeof catalogProductListQuerySchema>;
