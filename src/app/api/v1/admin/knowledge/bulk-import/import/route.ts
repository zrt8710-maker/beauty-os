import { createAdminProductKnowledgeBulkImportDependencies } from "@/server/admin/product-knowledge-bulk-import-composition";
import {
  BulkImportRequestError,
  presentBulkImportResults,
  readBulkImportJsonlRequest,
} from "@/server/admin/product-knowledge-bulk-import-http";
import { requireAdmin } from "@/server/auth/require-admin";
import { importBulkRecords } from "@/server/services/product-knowledge-bulk-importer";

import { bulkImportErrorResponse } from "../validate/route";

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const parsed = await readBulkImportJsonlRequest(request);
    if (parsed.invalid > 0) {
      return Response.json({
        error: { code: "BULK_IMPORT_INVALID", message: "请先修正所有无效行后再导入。" },
        data: { total: parsed.total, valid: parsed.valid, invalid: parsed.invalid, results: parsed.results },
      }, { status: 400 });
    }
    const report = await importBulkRecords(parsed.records, createAdminProductKnowledgeBulkImportDependencies());
    const results = presentBulkImportResults(report.results, parsed.records);
    return Response.json({ data: {
      success_count: report.success_count,
      failed_count: report.failed_count,
      results,
    } });
  } catch (error) {
    if (error instanceof BulkImportRequestError) return bulkImportErrorResponse(error);
    return bulkImportErrorResponse(error);
  }
}
