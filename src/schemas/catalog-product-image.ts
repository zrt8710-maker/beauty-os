import { z } from "zod";

const nullableHttpsUrl = z.url()
  .refine((value) => new URL(value).protocol === "https:", "图片 URL 必须使用 HTTPS。")
  .nullable();

/** Admin-maintained canonical public product image metadata. */
export const catalogProductImageUpdateSchema = z.object({
  catalog_image_url: nullableHttpsUrl,
  // Accepted solely for backwards-compatible batch input; never persisted.
  catalog_image_source_url: nullableHttpsUrl.optional(),
}).strict();

export type CatalogProductImageUpdate = z.infer<typeof catalogProductImageUpdateSchema>;
