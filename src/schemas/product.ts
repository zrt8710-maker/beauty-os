import { z } from "zod";

export const PRODUCT_CATEGORIES = [
  "skincare",
  "makeup",
  "bodycare",
  "haircare",
  "fragrance",
  "beauty_tool",
  "other",
] as const;

export const PRODUCT_SUBCATEGORIES = [
  "face_care",
  "eye_care",
  "lip_care",
  "sun_care",
  "base_makeup",
  "cheek_makeup",
  "eye_makeup",
  "brow_makeup",
  "lip_makeup",
  "setting_makeup",
  "body_care",
  "hair_care",
  "fragrance",
  "tool",
  "other",
] as const;

export const PRODUCT_TYPES = [
  "makeup_remover",
  "cleanser",
  "toner",
  "essence",
  "serum",
  "treatment",
  "moisturizer",
  "face_oil",
  "sunscreen",
  "mask",
  "eye_care",
  "lip_care",
  "primer",
  "foundation",
  "bb_cc_cream",
  "concealer",
  "powder",
  "blush",
  "contour",
  "highlighter",
  "eyeshadow",
  "eyeliner",
  "mascara",
  "brow_product",
  "lip_color",
  "setting_spray",
  "body_cleanser",
  "body_lotion",
  "body_treatment",
  "shampoo",
  "conditioner",
  "hair_treatment",
  "hair_styling",
  "perfume",
  "body_mist",
  "applicator",
  "device",
  "other",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
export type ProductSubcategory = (typeof PRODUCT_SUBCATEGORIES)[number];
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const USER_ASSET_CATEGORIES = [
  "skincare",
  "makeup",
  "cleansing",
  "other",
] as const;

export type UserAssetCategory = (typeof USER_ASSET_CATEGORIES)[number];

export const PRODUCT_TYPE_META: Record<
  ProductType,
  {
    category: ProductCategory;
    subcategory: ProductSubcategory;
    label: string;
  }
> = {
  makeup_remover: { category: "skincare", subcategory: "face_care", label: "卸妆" },
  cleanser: { category: "skincare", subcategory: "face_care", label: "洁面" },
  toner: { category: "skincare", subcategory: "face_care", label: "化妆水" },
  essence: { category: "skincare", subcategory: "face_care", label: "精华水" },
  serum: { category: "skincare", subcategory: "face_care", label: "精华" },
  treatment: { category: "skincare", subcategory: "face_care", label: "功效护理" },
  moisturizer: { category: "skincare", subcategory: "face_care", label: "面霜/乳液" },
  face_oil: { category: "skincare", subcategory: "face_care", label: "面部油" },
  sunscreen: { category: "skincare", subcategory: "sun_care", label: "防晒" },
  mask: { category: "skincare", subcategory: "face_care", label: "面膜" },
  eye_care: { category: "skincare", subcategory: "eye_care", label: "眼部护理" },
  lip_care: { category: "skincare", subcategory: "lip_care", label: "唇部护理" },
  primer: { category: "makeup", subcategory: "base_makeup", label: "妆前" },
  foundation: { category: "makeup", subcategory: "base_makeup", label: "粉底" },
  bb_cc_cream: { category: "makeup", subcategory: "base_makeup", label: "BB/CC霜" },
  concealer: { category: "makeup", subcategory: "base_makeup", label: "遮瑕" },
  powder: { category: "makeup", subcategory: "base_makeup", label: "粉类底妆" },
  blush: { category: "makeup", subcategory: "cheek_makeup", label: "腮红" },
  contour: { category: "makeup", subcategory: "cheek_makeup", label: "修容" },
  highlighter: { category: "makeup", subcategory: "cheek_makeup", label: "高光" },
  eyeshadow: { category: "makeup", subcategory: "eye_makeup", label: "眼影" },
  eyeliner: { category: "makeup", subcategory: "eye_makeup", label: "眼线" },
  mascara: { category: "makeup", subcategory: "eye_makeup", label: "睫毛膏" },
  brow_product: { category: "makeup", subcategory: "brow_makeup", label: "眉部产品" },
  lip_color: { category: "makeup", subcategory: "lip_makeup", label: "唇彩/口红" },
  setting_spray: { category: "makeup", subcategory: "setting_makeup", label: "定妆喷雾" },
  body_cleanser: { category: "bodycare", subcategory: "body_care", label: "身体清洁" },
  body_lotion: { category: "bodycare", subcategory: "body_care", label: "身体乳" },
  body_treatment: { category: "bodycare", subcategory: "body_care", label: "身体护理" },
  shampoo: { category: "haircare", subcategory: "hair_care", label: "洗发" },
  conditioner: { category: "haircare", subcategory: "hair_care", label: "护发素" },
  hair_treatment: { category: "haircare", subcategory: "hair_care", label: "发膜/头皮护理" },
  hair_styling: { category: "haircare", subcategory: "hair_care", label: "造型" },
  perfume: { category: "fragrance", subcategory: "fragrance", label: "香水" },
  body_mist: { category: "fragrance", subcategory: "fragrance", label: "香氛喷雾" },
  applicator: { category: "beauty_tool", subcategory: "tool", label: "上妆工具" },
  device: { category: "beauty_tool", subcategory: "tool", label: "美容仪器" },
  other: { category: "other", subcategory: "other", label: "其他" },
};

export const OWNED_PRODUCT_STATUSES = [
  "unopened",
  "active",
  "paused",
  "finished",
  "discarded",
  "archived",
] as const;

export const EDITABLE_OWNED_PRODUCT_STATUSES = [
  "unopened",
  "active",
  "paused",
  "finished",
  "discarded",
] as const;

export const PRODUCT_IDENTITY_STATUSES = ["matched", "unknown"] as const;

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();
const nullableDate = z.iso.date().nullable();

export const productCreateSchema = z
  .object({
    brand_name: nullableText(120),
    product_name: z.string().trim().min(1).max(200),
    category: z.enum(PRODUCT_CATEGORIES),
    product_type: z.enum(PRODUCT_TYPES),
  })
  .strict()
  .superRefine((product, context) => {
    if (PRODUCT_TYPE_META[product.product_type].category !== product.category) {
      context.addIssue({
        code: "custom",
        message: "产品类型与大类不匹配。",
        path: ["product_type"],
      });
    }
  });

export const productSchema = z.object({
  id: z.uuid(),
  brand_name: nullableText(120),
  product_name: z.string().min(1).max(200),
  variant_name: nullableText(200).default(null),
  barcode: z.string().min(8).max(32).nullable().default(null),
  identity_status: z.enum(PRODUCT_IDENTITY_STATUSES).default("unknown"),
  category: z.enum(PRODUCT_CATEGORIES),
  subcategory: z.enum(PRODUCT_SUBCATEGORIES),
  product_type: z.enum(PRODUCT_TYPES),
  catalog_product_id: z.uuid().nullable().optional(),
  catalog_image_url: z.url().nullable().optional(),
  // Supabase serializes PostgreSQL timestamptz values with an explicit offset
  // (for example, `2026-08-19T10:00:00+00:00`) rather than always using `Z`.
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

export const productListQuerySchema = z
  .object({
    category: z.enum(PRODUCT_CATEGORIES).optional(),
    search: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[\p{L}\p{N}\s&+'’./-]+$/u, "搜索词包含不支持的字符。")
      .optional(),
  })
  .strict();

export const ownedProductStateSchema = z
  .object({
    product_id: z.uuid(),
    asset_category: z.enum(USER_ASSET_CATEGORIES).default("other"),
    status: z.enum(EDITABLE_OWNED_PRODUCT_STATUSES).default("active"),
    purchase_date: nullableDate,
    manufacture_date: nullableDate.optional(),
    package_size: nullableText(100).optional(),
    opened_at: nullableDate,
    expires_on: nullableDate.default(null),
    quantity_remaining_percent: z.number().int().min(0).max(100),
    notes: nullableText(2000),
  })
  .strict()
  .superRefine((ownedProduct, context) => {
    if (
      ownedProduct.purchase_date &&
      ownedProduct.opened_at &&
      ownedProduct.opened_at < ownedProduct.purchase_date
    ) {
      context.addIssue({
        code: "custom",
        message: "开封日期不能早于购买日期。",
        path: ["opened_at"],
      });
    }
  });

export const ownedProductCreateSchema = ownedProductStateSchema;

export const ownedProductUpdateSchema = z
  .object({
    asset_category: z.enum(USER_ASSET_CATEGORIES).optional(),
    status: z.enum(EDITABLE_OWNED_PRODUCT_STATUSES).optional(),
    purchase_date: nullableDate.optional(),
    manufacture_date: nullableDate.optional(),
    package_size: nullableText(100).optional(),
    opened_at: nullableDate.optional(),
    expires_on: nullableDate.optional(),
    quantity_remaining_percent: z.number().int().min(0).max(100).optional(),
    notes: nullableText(2000).optional(),
    // Client updates may only clear an override. Setting it is server-controlled
    // after a completed, asset-bound upload has passed ownership validation.
    image_override_upload_id: z.null().optional(),
  })
  .strict()
  .refine((update) => Object.keys(update).length > 0, "至少需要更新一个字段。");

export const ownedProductSchema = z.object({
  id: z.uuid(),
  product_id: z.uuid(),
  asset_category: z.enum(USER_ASSET_CATEGORIES).optional(),
  status: z.enum(OWNED_PRODUCT_STATUSES),
  purchase_date: nullableDate,
  manufacture_date: nullableDate.optional(),
  opened_at: nullableDate,
  expires_on: nullableDate.default(null),
  quantity_remaining_percent: z.number().int().min(0).max(100),
  notes: nullableText(2000),
  package_size: nullableText(100).optional(),
  identified_image_url: z.url().nullable().optional(),
  identified_image_source_url: z.url().nullable().optional(),
  image_override_upload_id: z.uuid().nullable().optional(),
  archived_at: z.iso.datetime({ offset: true }).nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
  product: productSchema,
  image: z.object({
    resolved_url: z.url().nullable(),
    source: z.enum(["user_override", "identified", "legacy", "catalog", "none"]),
    has_override: z.boolean(),
  }).optional(),
});

export const ownedProductListQuerySchema = z
  .object({
    status: z.enum(OWNED_PRODUCT_STATUSES).optional(),
  })
  .strict();

export const ownedProductIdSchema = z.uuid();

export type Product = z.infer<typeof productSchema>;
export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type OwnedProduct = z.infer<typeof ownedProductSchema>;
export type OwnedProductCreateInput = z.infer<typeof ownedProductCreateSchema>;
export type OwnedProductUpdateInput = z.infer<typeof ownedProductUpdateSchema>;
export type OwnedProductListQuery = z.infer<typeof ownedProductListQuerySchema>;
