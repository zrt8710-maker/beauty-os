import {
  BulkImportRequestError,
  readBulkImportJsonlRequest,
} from "@/server/admin/product-knowledge-bulk-import-http";
import { AdminRequiredError, UnauthorizedError, requireAdmin } from "@/server/auth/require-admin";

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const report = await readBulkImportJsonlRequest(request);
    return Response.json({ data: {
      total: report.total,
      valid: report.valid,
      invalid: report.invalid,
      results: report.results,
    } });
  } catch (error) {
    return bulkImportErrorResponse(error);
  }
}

export function bulkImportErrorResponse(error: unknown) {
  if (error instanceof UnauthorizedError) return Response.json({ error: { code: error.code, message: "请先登录。" } }, { status: error.status });
  if (error instanceof AdminRequiredError) return Response.json({ error: { code: error.code, message: "需要管理员权限。" } }, { status: error.status });
  if (error instanceof BulkImportRequestError) return Response.json({ error: { code: "BULK_IMPORT_INVALID", message: error.message } }, { status: 400 });
  return Response.json({ error: { code: "BULK_IMPORT_FAILED", message: "批量导入请求未能完成，请稍后重试。" } }, { status: 500 });
}
