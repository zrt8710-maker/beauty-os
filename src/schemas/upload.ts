import { z } from "zod";

export const PRODUCT_IMAGE_BUCKET = "product-images";
export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const UPLOAD_PURPOSES = ["product_image"] as const;
export const UPLOAD_STATUSES = ["pending", "ready", "failed"] as const;

const safeFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/u.test(value),
    "文件名包含不支持的字符。",
  );

export const uploadCreateSchema = z
  .object({
    file_name: safeFileNameSchema,
    mime_type: z.enum(PRODUCT_IMAGE_MIME_TYPES),
    file_size: z.number().int().min(1).max(MAX_PRODUCT_IMAGE_BYTES),
    purpose: z.enum(UPLOAD_PURPOSES),
    product_id: z.uuid().nullable().default(null),
    owned_product_id: z.uuid().nullable().default(null),
  }).strict().superRefine((upload, context) => {
    if (upload.product_id !== null && upload.owned_product_id !== null) {
      context.addIssue({ code: "custom", message: "图片只能绑定产品或具体资产之一。", path: ["owned_product_id"] });
    }
  });

export const uploadListQuerySchema = z
  .object({
    product_id: z.uuid().optional(),
  })
  .strict();

export const uploadIdSchema = z.uuid();

export const uploadAssetSchema = z.object({
  id: z.uuid(),
  product_id: z.uuid().nullable(),
  owned_product_id: z.uuid().nullable().default(null),
  file_name: safeFileNameSchema,
  mime_type: z.enum(PRODUCT_IMAGE_MIME_TYPES),
  file_size: z.number().int().min(1).max(MAX_PRODUCT_IMAGE_BYTES),
  purpose: z.enum(UPLOAD_PURPOSES),
  status: z.enum(UPLOAD_STATUSES),
  created_at: z.iso.datetime(),
  signed_url: z.url().nullable(),
});

export const uploadTaskSchema = z.object({
  asset: uploadAssetSchema,
  signed_upload: z.object({
    path: z.string().min(1),
    token: z.string().min(1),
    signed_url: z.url(),
  }),
});

export type UploadAsset = z.infer<typeof uploadAssetSchema>;
export type UploadCreateInput = z.infer<typeof uploadCreateSchema>;
export type UploadListQuery = z.infer<typeof uploadListQuerySchema>;
export type UploadTask = z.infer<typeof uploadTaskSchema>;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];
