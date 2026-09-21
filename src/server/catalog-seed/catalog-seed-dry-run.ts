import "server-only";

import {
  CATALOG_SEED_DRY_RUN_REPORT_VERSION,
  catalogSeedDryRunReportSchema,
  type CatalogSeedDryRunIssue,
  type CatalogSeedDryRunReport,
  type CatalogSeedInput,
  type CatalogSeedProductSummary,
  type CatalogSeedSourceInput,
} from "@/schemas/catalog-seed";
import { validateCatalogSeed } from "@/server/domain/catalog-seed";
import type {
  CatalogSeedCatalogProductRow,
  CatalogSeedKnowledgeSourceRow,
  CatalogSeedLookupRepository,
  CatalogSeedLookupResult,
} from "@/server/repositories/catalog-seed-lookup-repository";

export type CatalogSeedDryRunChecker = {
  run(input: unknown): Promise<CatalogSeedDryRunReport>;
};

/**
 * Builds a read-only catalog seed preflight checker.
 *
 * Invalid input never reaches the repository. Valid input is compared with the
 * current catalog and source records; this boundary never writes or infers
 * product roles/capabilities.
 */
export function createCatalogSeedDryRunChecker(
  lookup: CatalogSeedLookupRepository,
): CatalogSeedDryRunChecker {
  return {
    async run(rawInput) {
      const validation = validateCatalogSeed(rawInput);
      const catalogProductId = validation.input?.catalog_product_id ?? null;
      const warnings = validation.warnings.map((warning) =>
        issue(
          warning.code,
          warning.message,
          catalogProductId,
          null,
          warning.path,
        ));

      if (!validation.valid || validation.input === null) {
        return parseReport({
          report_version: CATALOG_SEED_DRY_RUN_REPORT_VERSION,
          status: "invalid",
          new_products: [],
          existing_products: [],
          conflicts: [],
          warnings,
          errors: validation.errors.map((error) =>
            issue(
              error.code,
              error.message,
              catalogProductId,
              null,
              error.path,
            )),
        });
      }

      const input = validation.input;
      const current = await lookup.inspect(input);
      const comparison = compareWithCatalog(input, current);
      const summary = productSummary(input);

      return parseReport({
        report_version: CATALOG_SEED_DRY_RUN_REPORT_VERSION,
        status: comparison.conflicts.length > 0
          ? "conflict"
          : comparison.existing
            ? "existing"
            : "new",
        new_products: comparison.conflicts.length === 0 && !comparison.existing
          ? [summary]
          : [],
        existing_products:
          comparison.conflicts.length === 0 && comparison.existing
            ? [summary]
            : [],
        conflicts: comparison.conflicts,
        warnings: deduplicateIssues([...warnings, ...comparison.warnings]),
        errors: [],
      });
    },
  };
}

function compareWithCatalog(
  input: CatalogSeedInput,
  current: CatalogSeedLookupResult,
): {
  existing: boolean;
  conflicts: CatalogSeedDryRunIssue[];
  warnings: CatalogSeedDryRunIssue[];
} {
  const conflicts: CatalogSeedDryRunIssue[] = [];
  const warnings: CatalogSeedDryRunIssue[] = [];
  const inputId = input.catalog_product_id;

  if (
    current.source_by_id !== null
    && !sameSource(current.source_by_id, input.source)
  ) {
    conflicts.push(issue(
      "CATALOG_SEED_SOURCE_ID_CONFLICT",
      "source_id 已存在，但来源内容与 seed 不一致。",
      inputId,
      null,
      ["source", "source_id"],
    ));
  }

  const catalogByIdMatches = current.catalog_by_id !== null
    && sameCatalogProduct(current.catalog_by_id, input);

  const sameIdObservedAfterIdRead = [
    current.barcode_match,
    ...current.raw_identity_matches,
    ...current.normalized_verified_matches,
  ].find((row) => row?.id === inputId);

  if (current.catalog_by_id === null && sameIdObservedAfterIdRead) {
    conflicts.push(issue(
      "CATALOG_SEED_LOOKUP_SNAPSHOT_CONFLICT",
      "catalog_product_id 在预检期间出现；只读结果不是同一事务快照，请重新执行 dry-run。",
      inputId,
      sameIdObservedAfterIdRead.id,
      ["catalog_product_id"],
    ));
  }

  if (current.catalog_by_id !== null && !catalogByIdMatches) {
    conflicts.push(issue(
      "CATALOG_SEED_CATALOG_PRODUCT_ID_CONFLICT",
      "catalog_product_id 已存在，但标准产品身份或来源内容与 seed 不一致。",
      inputId,
      current.catalog_by_id.id,
      ["catalog_product_id"],
    ));
  }

  if (
    catalogByIdMatches
    && current.source_by_id === null
  ) {
    conflicts.push(issue(
      "CATALOG_SEED_SOURCE_NOT_FOUND",
      "已有 catalog product 引用的 source_id 无法读取。",
      inputId,
      null,
      ["source", "source_id"],
    ));
  }

  if (
    current.barcode_match !== null
    && current.barcode_match.id !== inputId
  ) {
    conflicts.push(issue(
      "CATALOG_SEED_BARCODE_CONFLICT",
      "barcode 已关联到另一个 catalog product。",
      inputId,
      current.barcode_match.id,
      ["identity", "barcode"],
    ));
  }

  const rawConflictIds = new Set<string>();
  current.raw_identity_matches.forEach((row) => {
    if (row.id === inputId) return;
    rawConflictIds.add(row.id);
    conflicts.push(issue(
      "CATALOG_SEED_IDENTITY_CONFLICT",
      "brand_name、product_name 与 variant_name 已属于另一个 catalog product。",
      inputId,
      row.id,
      ["identity"],
    ));
  });

  current.normalized_verified_matches.forEach((row) => {
    if (row.id === inputId || rawConflictIds.has(row.id)) return;

    conflicts.push(issue(
      "CATALOG_SEED_NORMALIZED_IDENTITY_CONFLICT",
      "存在规范化品牌和产品名相同的另一个 verified catalog product；当前 Identity Matcher 不区分 variant。",
      inputId,
      row.id,
      ["identity"],
    ));
  });

  return {
    existing: catalogByIdMatches
      && current.source_by_id !== null
      && sameSource(current.source_by_id, input.source),
    conflicts: deduplicateIssues(conflicts),
    warnings: deduplicateIssues(warnings),
  };
}

function sameSource(
  row: CatalogSeedKnowledgeSourceRow,
  source: CatalogSeedSourceInput,
): boolean {
  return row.id === source.source_id
    && row.source_type === source.source_type
    && row.name === source.name
    && row.source_url === source.source_url
    && row.license_note === source.license_note
    && sameInstant(row.retrieved_at, source.retrieved_at);
}

function sameCatalogProduct(
  row: CatalogSeedCatalogProductRow,
  input: CatalogSeedInput,
): boolean {
  const identity = input.identity;
  return row.id === input.catalog_product_id
    && row.brand_name === identity.brand_name
    && row.product_name === identity.product_name
    && row.variant_name === identity.variant_name
    && row.barcode === identity.barcode
    && row.category === identity.category
    && row.subcategory === identity.subcategory
    && row.product_type === identity.product_type
    && row.primary_source_id === input.source.source_id
    && row.confidence === identity.confidence
    && row.status === identity.status;
}

function sameInstant(left: string, right: string): boolean {
  return Date.parse(left) === Date.parse(right);
}

function productSummary(input: CatalogSeedInput): CatalogSeedProductSummary {
  return {
    catalog_product_id: input.catalog_product_id,
    brand_name: input.identity.brand_name,
    product_name: input.identity.product_name,
    variant_name: input.identity.variant_name,
    barcode: input.identity.barcode,
    category: input.identity.category,
    subcategory: input.identity.subcategory,
    product_type: input.identity.product_type,
  };
}

function issue(
  code: string,
  message: string,
  catalogProductId: string | null,
  conflictingCatalogProductId: string | null,
  path: Array<string | number>,
): CatalogSeedDryRunIssue {
  return {
    code,
    message,
    catalog_product_id: catalogProductId,
    conflicting_catalog_product_id: conflictingCatalogProductId,
    path,
  };
}

function deduplicateIssues(
  issues: CatalogSeedDryRunIssue[],
): CatalogSeedDryRunIssue[] {
  const unique = new Map<string, CatalogSeedDryRunIssue>();
  issues.forEach((entry) => {
    unique.set(JSON.stringify([
      entry.code,
      entry.catalog_product_id,
      entry.conflicting_catalog_product_id,
      entry.path,
    ]), entry);
  });
  return [...unique.values()].sort((left, right) =>
    issueKey(left).localeCompare(issueKey(right)));
}

function issueKey(value: CatalogSeedDryRunIssue): string {
  return JSON.stringify([
    value.code,
    value.conflicting_catalog_product_id,
    value.path,
  ]);
}

function parseReport(report: CatalogSeedDryRunReport): CatalogSeedDryRunReport {
  return catalogSeedDryRunReportSchema.parse(report);
}
