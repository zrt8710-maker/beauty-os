import { z } from "zod";

import { recognitionObservedTextSchema } from "@/schemas/product-recognition";

const nullableText = (max: number) =>
  z.string().trim().min(1).max(max).nullable();

export const manualIdentityClueInputSchema = z.object({
  query: z.string().trim().min(1).max(200),
  brand_name: nullableText(120).optional().default(null),
}).strict();

/**
 * Untrusted identity input supplied by a person or Recognition. A clue is
 * never a confirmed product identity and deliberately contains no Catalog or
 * Product Knowledge fields.
 */
export const productIdentityClueSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("image_recognition"),
    raw_query: z.null(),
    brand_name: nullableText(120),
    product_name: nullableText(200),
    recognition_confidence: z.number().int().min(0).max(100),
    observed_text: z.array(recognitionObservedTextSchema).max(30),
  }).strict(),
  z.object({
    source: z.literal("manual_search"),
    raw_query: z.string().trim().min(1).max(200),
    brand_name: nullableText(120),
    product_name: nullableText(200),
    recognition_confidence: z.null(),
    observed_text: z.array(recognitionObservedTextSchema).max(30).default([]),
  }).strict(),
]);

export type ProductIdentityClue = z.infer<typeof productIdentityClueSchema>;
