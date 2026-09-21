import "server-only";

import { z } from "zod";

import {
  validateBulkImportRecord,
  type BulkImportResult,
} from "@/server/services/product-knowledge-bulk-importer";

const requestSchema = z.object({ jsonl: z.string().min(1).max(5_000_000) }).strict();

export type BulkImportValidationLine = {
  line: number;
  product_name: string | null;
  status: "valid" | "invalid";
  reason?: string;
};

export async function readBulkImportJsonlRequest(request: Request) {
  const body = requestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) throw new BulkImportRequestError("导入请求格式不正确。");
  return parseAndValidateJsonl(body.data.jsonl);
}

export function parseAndValidateJsonl(jsonl: string) {
  const lines = jsonl.split(/\r?\n/);
  const records: Array<{ line: number; value: unknown }> = [];
  const results: BulkImportValidationLine[] = [];
  lines.forEach((text, index) => {
    if (!text.trim()) return;
    const line = index + 1;
    try {
      const value = JSON.parse(text) as unknown;
      const parsed = validateBulkImportRecord(value);
      if (!parsed.success) {
        results.push({ line, product_name: productName(value), status: "invalid", reason: humanizeValidationIssues(parsed.error.issues) });
        return;
      }
      records.push({ line, value: parsed.data });
      results.push({ line, product_name: parsed.data.research_payload.identity.product_name, status: "valid" });
    } catch {
      results.push({ line, product_name: null, status: "invalid", reason: "无效 JSONL 记录。" });
    }
  });
  return {
    total: results.length,
    valid: results.filter((result) => result.status === "valid").length,
    invalid: results.filter((result) => result.status === "invalid").length,
    results,
    records,
  };
}

export function presentBulkImportResults(
  results: BulkImportResult[],
  records: Array<{ line: number; value: unknown }>,
) {
  const names = new Map(records.map((record) => [record.line, productName(record.value)]));
  return results.map((result) => ({
    ...result,
    product_name: names.get(result.line) ?? null,
    reason: result.reason ? humanizeImportReason(result.reason) : undefined,
  }));
}

export class BulkImportRequestError extends Error {}

function productName(value: unknown) {
  if (typeof value !== "object" || value === null) return null;
  const payload = (value as { research_payload?: { identity?: { product_name?: unknown } } }).research_payload;
  return typeof payload?.identity?.product_name === "string" ? payload.identity.product_name : null;
}

function humanizeValidationIssues(issues: z.core.$ZodIssue[]) {
  return issues.map((issue) => `${issue.path.join(".") || "record"}：${issue.message}`).join("；");
}

function humanizeImportReason(reason: string) {
  if (reason === "ambiguous_catalog_identity") return "catalog identity 存在多个匹配。";
  if (reason === "catalog_primary_source_not_found") return "identity evidence_refs 未找到对应来源。";
  if (reason === "catalog_bootstrap_required_fields_missing") return "新 Catalog 产品缺少必要的身份或产品类型资料。";
  if (reason.includes("CATALOG_BOOTSTRAP")) return "Catalog 产品创建失败，请检查资料后重试。";
  if (reason.includes("CATALOG_IMAGE")) return "Catalog 图片更新失败。";
  if (reason.includes("read-back")) return "导入后的研究资料验证未通过。";
  return "该产品导入失败，请检查该行资料后重试。";
}
