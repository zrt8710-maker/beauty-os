import { readFile } from "node:fs/promises";

import { createAdminProductKnowledgeBulkImportDependencies } from "@/server/admin/product-knowledge-bulk-import-composition";
import {
  importBulkRecords,
  validateBulkImportRecord,
} from "@/server/services/product-knowledge-bulk-importer";

const [mode, file] = process.argv.slice(2);
type JsonlRecord = { line: number; value: unknown; parseError?: string };

async function main() {
  if ((mode !== "validate" && mode !== "import") || !file) {
    throw new Error("Usage: product-knowledge-import <validate|import> <file.jsonl>");
  }
  const records = await readJsonl(file);
  if (mode === "validate") {
    const results = records.map(({ line, value, parseError }) => {
      if (parseError) return { line, status: "failed", reason: parseError };
      const parsed = validateBulkImportRecord(value);
      return parsed.success
        ? { line, status: "success" }
        : { line, status: "failed", reason: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
    });
    printReport(results);
    process.exitCode = results.some((result) => result.status === "failed") ? 1 : 0;
    return;
  }

  const invalid = records.filter((record) => record.parseError);
  const validRecords = records.filter((record): record is { line: number; value: unknown } => !record.parseError);
  const report = await importBulkRecords(validRecords, createAdminProductKnowledgeBulkImportDependencies());
  printReport([
    ...invalid.map((record) => ({ line: record.line, status: "failed" as const, reason: record.parseError! })),
    ...report.results,
  ]);
}

async function readJsonl(filePath: string): Promise<JsonlRecord[]> {
  const content = await readFile(filePath, "utf8");
  return content.split(/\r?\n/).flatMap((text, index) => {
    if (!text.trim()) return [];
    try { return [{ line: index + 1, value: JSON.parse(text) as unknown }]; }
    catch { return [{ line: index + 1, value: null, parseError: "无效 JSONL 记录。" }]; }
  });
}

function printReport(results: Array<{ line: number; status: string; reason?: string }>) {
  const failures = results.filter((result) => result.status === "failed");
  console.log(JSON.stringify({
    success_count: results.length - failures.length,
    failed_count: failures.length,
    failures,
    results,
  }, null, 2));
}

process.loadEnvFile?.(".env.local");
main().catch((error) => { console.error(error); process.exitCode = 1; });
