import { z } from "zod";

export const EXTERNAL_PRODUCT_FACT_SCHEMA_VERSION =
  "external-product-fact/v0.1" as const;
export const PRODUCT_FACT_REQUEST_SCHEMA_VERSION =
  "external-product-fact-request/v0.1" as const;

const nullableText = (max: number) =>
  z.string().trim().min(1).max(max).nullable();

export const productFactRequestSchema = z
  .object({
    schema_version: z.literal(PRODUCT_FACT_REQUEST_SCHEMA_VERSION),
    mode: z.literal("barcode"),
    barcode: z.string().regex(/^\d{8,14}$/),
    locale: z.string().trim().min(2).max(20).default("zh-CN"),
    market: z.string().trim().regex(/^[A-Z]{2}$/).default("CN"),
  })
  .strict();

export const productFactIssueSchema = z
  .object({
    code: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(1000),
    fields: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  })
  .strict();

export const externalProductFactSchema = z
  .object({
    schema_version: z.literal(EXTERNAL_PRODUCT_FACT_SCHEMA_VERSION),
    fact_id: z.string().trim().min(1).max(400),
    identity: z
      .object({
        brand_name: nullableText(120),
        product_name: nullableText(200),
        variant_name: nullableText(200),
        barcode: z.string().regex(/^\d{8,14}$/),
        quantity: nullableText(120),
      })
      .strict(),
    label: z
      .object({
        categories_tags: z.array(z.string().trim().min(1).max(300)).max(100),
        ingredients_text: nullableText(50_000),
      })
      .strict(),
    media: z
      .object({
        image_front_url: z.url().max(2000).nullable(),
        stored: z.literal(false),
      })
      .strict(),
    source: z
      .object({
        provider_code: z.string().trim().min(1).max(80),
        source_type: z.literal("open_dataset"),
        source_name: z.string().trim().min(1).max(200),
        source_url: z.url().max(2000),
        raw_record_id: z.string().trim().min(1).max(300),
        retrieved_at: z.iso.datetime({ offset: true }),
        modified_at: z.iso.datetime({ offset: true }).nullable(),
        license: z.string().trim().min(1).max(2000),
        source_quality: z.number().int().min(0).max(100).nullable(),
      })
      .strict(),
    warnings: z.array(productFactIssueSchema).max(50),
  })
  .strict();

export const productFactResultSchema = z
  .object({
    provider_code: z.string().trim().min(1).max(80),
    status: z.enum(["found", "not_found", "failed"]),
    fact: externalProductFactSchema.nullable(),
    issues: z.array(productFactIssueSchema).max(50),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status === "found" && result.fact === null) {
      context.addIssue({
        code: "custom",
        message: "found 结果必须包含 External Product Fact。",
        path: ["fact"],
      });
    }
    if (result.status !== "found" && result.fact !== null) {
      context.addIssue({
        code: "custom",
        message: "not_found/failed 结果不能包含 External Product Fact。",
        path: ["fact"],
      });
    }
  });

export type ProductFactRequest = z.infer<typeof productFactRequestSchema>;
export type ProductFactIssue = z.infer<typeof productFactIssueSchema>;
export type ExternalProductFact = z.infer<typeof externalProductFactSchema>;
export type ProductFactResult = z.infer<typeof productFactResultSchema>;
