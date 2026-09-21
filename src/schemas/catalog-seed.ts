import { z } from "zod";

import {
  PRODUCT_CATEGORIES,
  PRODUCT_SUBCATEGORIES,
  PRODUCT_TYPES,
} from "@/schemas/product";

export const CATALOG_SEED_SCHEMA_VERSION = "catalog-seed/v0.1" as const;
export const CATALOG_SEED_DRY_RUN_REPORT_VERSION =
  "catalog-seed-dry-run/v0.1" as const;

export const CATALOG_SEED_SOURCE_TYPES = [
  "official_brand",
  "official_retailer",
  "open_dataset",
  "user_submitted",
  "ai_candidate",
] as const;

export const CATALOG_SEED_DRY_RUN_STATUSES = [
  "new",
  "existing",
  "conflict",
  "invalid",
] as const;

export const CATALOG_SEED_WRITE_OUTCOMES = ["created", "existing"] as const;

const nullableTrimmedText = (max: number) =>
  z.string().trim().min(1).max(max).nullable().default(null);
const catalogBarcodeSchema = z.string().trim().min(8).max(32);

export const catalogSeedSourceInputSchema = z
  .object({
    source_id: z.uuid(),
    source_type: z.enum(CATALOG_SEED_SOURCE_TYPES),
    name: z.string().trim().min(1).max(200),
    source_url: z.url().max(2000).nullable().default(null),
    license_note: nullableTrimmedText(2000),
    retrieved_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export const catalogSeedIdentityInputSchema = z
  .object({
    brand_name: z.string().trim().min(1).max(120),
    product_name: z.string().trim().min(1).max(200),
    variant_name: nullableTrimmedText(200),
    barcode: catalogBarcodeSchema.nullable().default(null),
    category: z.enum(PRODUCT_CATEGORIES),
    subcategory: z.enum(PRODUCT_SUBCATEGORIES),
    product_type: z.enum(PRODUCT_TYPES),
    confidence: z.number().int().min(0).max(100),
    status: z.literal("verified"),
  })
  .strict();

export const catalogSeedInputSchema = z
  .object({
    schema_version: z.literal(CATALOG_SEED_SCHEMA_VERSION),
    catalog_product_id: z.uuid(),
    source: catalogSeedSourceInputSchema,
    identity: catalogSeedIdentityInputSchema,
  })
  .strict();

export const catalogSeedProductSummarySchema = z
  .object({
    catalog_product_id: z.uuid(),
    brand_name: z.string().min(1).max(120),
    product_name: z.string().min(1).max(200),
    variant_name: z.string().min(1).max(200).nullable(),
    barcode: catalogBarcodeSchema.nullable(),
    category: z.enum(PRODUCT_CATEGORIES),
    subcategory: z.enum(PRODUCT_SUBCATEGORIES),
    product_type: z.enum(PRODUCT_TYPES),
  })
  .strict();

export const catalogSeedDryRunIssueSchema = z
  .object({
    code: z.string().trim().min(1).max(120),
    message: z.string().trim().min(1).max(2000),
    catalog_product_id: z.uuid().nullable(),
    conflicting_catalog_product_id: z.uuid().nullable(),
    path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
  })
  .strict();

export const catalogSeedDryRunReportSchema = z
  .object({
    report_version: z.literal(CATALOG_SEED_DRY_RUN_REPORT_VERSION),
    status: z.enum(CATALOG_SEED_DRY_RUN_STATUSES),
    new_products: z.array(catalogSeedProductSummarySchema),
    existing_products: z.array(catalogSeedProductSummarySchema),
    conflicts: z.array(catalogSeedDryRunIssueSchema),
    warnings: z.array(catalogSeedDryRunIssueSchema),
    errors: z.array(catalogSeedDryRunIssueSchema),
  })
  .strict()
  .superRefine((report, context) => {
    const addInvariantIssue = (message: string, path: string[]) => {
      context.addIssue({ code: "custom", message, path });
    };

    if (report.status === "new") {
      if (report.new_products.length !== 1) {
        addInvariantIssue("new 报告必须包含一个新增产品。", ["new_products"]);
      }
      if (
        report.existing_products.length > 0
        || report.conflicts.length > 0
        || report.errors.length > 0
      ) {
        addInvariantIssue("new 报告不能包含已有产品、冲突或错误。", ["status"]);
      }
    }

    if (report.status === "existing") {
      if (report.existing_products.length !== 1) {
        addInvariantIssue(
          "existing 报告必须包含一个已有产品。",
          ["existing_products"],
        );
      }
      if (
        report.new_products.length > 0
        || report.conflicts.length > 0
        || report.errors.length > 0
      ) {
        addInvariantIssue(
          "existing 报告不能包含新增产品、冲突或错误。",
          ["status"],
        );
      }
    }

    if (report.status === "conflict") {
      if (report.conflicts.length === 0) {
        addInvariantIssue("conflict 报告必须包含至少一个冲突。", ["conflicts"]);
      }
      if (
        report.new_products.length > 0
        || report.existing_products.length > 0
        || report.errors.length > 0
      ) {
        addInvariantIssue(
          "conflict 报告不能包含新增产品、已有产品或校验错误。",
          ["status"],
        );
      }
    }

    if (report.status === "invalid") {
      if (report.errors.length === 0) {
        addInvariantIssue("invalid 报告必须包含至少一个错误。", ["errors"]);
      }
      if (
        report.new_products.length > 0
        || report.existing_products.length > 0
        || report.conflicts.length > 0
      ) {
        addInvariantIssue(
          "invalid 报告不能包含新增产品、已有产品或冲突。",
          ["status"],
        );
      }
    }
  });

export const catalogSeedWriteReceiptSchema = z
  .object({
    outcome: z.enum(CATALOG_SEED_WRITE_OUTCOMES),
    catalog_product_id: z.uuid(),
    source_id: z.uuid(),
    source_created: z.boolean(),
    catalog_product_created: z.boolean(),
    status: z.literal("verified"),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (
      receipt.outcome === "created"
      && !receipt.catalog_product_created
    ) {
      context.addIssue({
        code: "custom",
        message: "created receipt 必须标记 catalog product 已创建。",
        path: ["catalog_product_created"],
      });
    }

    if (
      receipt.outcome === "existing"
      && (receipt.source_created || receipt.catalog_product_created)
    ) {
      context.addIssue({
        code: "custom",
        message: "existing receipt 不能标记新建记录。",
        path: ["outcome"],
      });
    }
  });

export const catalogSeedReadbackSchema = z
  .object({
    catalog_product_id: z.uuid(),
    brand_name: z.string().min(1).max(120),
    product_name: z.string().min(1).max(200),
    variant_name: z.string().min(1).max(200).nullable(),
    barcode: catalogBarcodeSchema.nullable(),
    category: z.enum(PRODUCT_CATEGORIES),
    subcategory: z.enum(PRODUCT_SUBCATEGORIES),
    product_type: z.enum(PRODUCT_TYPES),
    source: catalogSeedSourceInputSchema,
    confidence: z.number().int().min(0).max(100),
    status: z.literal("verified"),
  })
  .strict();

export type CatalogSeedSourceInput = z.infer<
  typeof catalogSeedSourceInputSchema
>;
export type CatalogSeedSourceType =
  (typeof CATALOG_SEED_SOURCE_TYPES)[number];
export type CatalogSeedIdentityInput = z.infer<
  typeof catalogSeedIdentityInputSchema
>;
export type CatalogSeedInput = z.infer<typeof catalogSeedInputSchema>;
export type CatalogSeedProductSummary = z.infer<
  typeof catalogSeedProductSummarySchema
>;
export type CatalogSeedDryRunIssue = z.infer<
  typeof catalogSeedDryRunIssueSchema
>;
export type CatalogSeedDryRunReport = z.infer<
  typeof catalogSeedDryRunReportSchema
>;
export type CatalogSeedDryRunStatus =
  (typeof CATALOG_SEED_DRY_RUN_STATUSES)[number];
export type CatalogSeedWriteOutcome =
  (typeof CATALOG_SEED_WRITE_OUTCOMES)[number];
export type CatalogSeedWriteReceipt = z.infer<
  typeof catalogSeedWriteReceiptSchema
>;
export type CatalogSeedReadback = z.infer<typeof catalogSeedReadbackSchema>;
