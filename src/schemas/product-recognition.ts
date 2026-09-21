import { z } from "zod";

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();

export const recognitionObservedTextSchema = z.object({
  value: z.string().trim().min(1).max(500),
  type: z.enum(["brand", "product_name", "package_size", "barcode", "marketing_text", "unknown"]),
}).strict();

export const productRecognitionRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("natural_language"), product_name: z.string().trim().min(1).max(200), brand_name: nullableText(120).default(null) }).strict(),
  z.object({
    mode: z.literal("image"),
    images: z.array(z.object({
      position: z.enum(["front", "back", "bottom"]),
      data_url: z.string().trim().min(32).max(7_000_000),
    }).strict()).min(1).max(3),
  }).strict(),
]);

/** Visual observation only: no variant, type, barcode identity, or product knowledge. */
export const productRecognitionCandidateSchema = z.object({
  brand_name: nullableText(120),
  product_name: nullableText(200),
  confidence: z.number().int().min(0).max(100),
  observed_text: z.array(recognitionObservedTextSchema).max(30),
  recognition_reference: z.string().min(32).nullable().default(null),
}).strict();

export const productRecognitionResponseSchema = z.object({
  status: z.enum(["candidates", "no_match"]),
  candidates: z.array(productRecognitionCandidateSchema).max(20),
}).strict().superRefine((result, context) => {
  if (result.status === "no_match" && result.candidates.length > 0) {
    context.addIssue({ code: "custom", message: "无识别结果时不能包含候选。", path: ["candidates"] });
  }
});

export type ProductRecognitionRequest = z.infer<typeof productRecognitionRequestSchema>;
export type ProductRecognitionCandidate = z.infer<typeof productRecognitionCandidateSchema>;
export type ProductRecognitionResponse = z.infer<typeof productRecognitionResponseSchema>;
