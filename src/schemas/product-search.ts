import { z } from "zod";

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();

export const productSearchInputSchema = z.object({
  // Identity discovery can begin from a product-name-only manual clue. Agent3
  // continues to provide a confirmed Catalog brand, while Agent2 may not.
  brand: nullableText(120),
  product_name: z.string().trim().min(1).max(200),
  variant_name: nullableText(200),
  /** Optional application-authored query for bounded research enrichment. */
  query: z.string().trim().min(1).max(500).optional(),
}).strict();

/** Search-provider-returned leads. They are not Beauty OS verified evidence. */
export const productSearchResultSchema = z.object({
  title: z.string().trim().min(1).max(500),
  url: z.url().max(2000),
  snippet: nullableText(8_000),
  summary: nullableText(12_000),
  site_name: nullableText(300),
  rank_score: z.number().finite().nullable(),
  authority_level: z.number().int().min(0).max(20).nullable(),
  authority_description: nullableText(200),
}).strict();

export type ProductSearchInput = z.infer<typeof productSearchInputSchema>;
export type ProductSearchResult = z.infer<typeof productSearchResultSchema>;
