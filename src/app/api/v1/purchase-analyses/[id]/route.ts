import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { purchaseErrorResponse, purchaseNoStoreHeaders } from "@/server/purchase-analysis/purchase-analysis-api-response";
import { getPurchaseAnalysisRequestContext } from "@/server/purchase-analysis/get-purchase-analysis-request-context";
import { PurchaseAnalysisNotFoundError } from "@/server/services/purchase-analysis-service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const requestContext = await getPurchaseAnalysisRequestContext();
  if (!requestContext) return purchaseErrorResponse(401, "UNAUTHORIZED", "请先登录。");
  try { const { id } = await context.params; return NextResponse.json({ data: await requestContext.service.get(requestContext.user.id, id) }, { headers: purchaseNoStoreHeaders }); }
  catch (error) { if (error instanceof ZodError) return purchaseErrorResponse(400, "VALIDATION_ERROR", "分析 ID 不符合要求。", error.flatten().fieldErrors); if (error instanceof PurchaseAnalysisNotFoundError) return purchaseErrorResponse(404, error.code, "找不到当前用户的购买分析。"); return purchaseErrorResponse(500, "PURCHASE_ANALYSIS_READ_FAILED", "无法读取购买分析。"); }
}
