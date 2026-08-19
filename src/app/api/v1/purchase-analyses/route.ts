import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { purchaseErrorResponse, purchaseNoStoreHeaders } from "@/server/purchase-analysis/purchase-analysis-api-response";
import { getPurchaseAnalysisRequestContext } from "@/server/purchase-analysis/get-purchase-analysis-request-context";
import { PurchaseAnalysisNotFoundError } from "@/server/services/purchase-analysis-service";

export async function GET(request: Request) {
  const context = await getPurchaseAnalysisRequestContext();
  if (!context) return purchaseErrorResponse(401, "UNAUTHORIZED", "请先登录。");
  try { const limit = new URL(request.url).searchParams.get("limit") ?? undefined; return NextResponse.json({ data: await context.service.list(context.user.id, { limit }) }, { headers: purchaseNoStoreHeaders }); }
  catch (error) { if (error instanceof ZodError) return purchaseErrorResponse(400, "VALIDATION_ERROR", "查询参数不符合要求。", error.flatten().fieldErrors); return purchaseErrorResponse(500, "PURCHASE_ANALYSIS_READ_FAILED", "无法读取购买分析。"); }
}

export async function POST(request: Request) {
  const context = await getPurchaseAnalysisRequestContext();
  if (!context) return purchaseErrorResponse(401, "UNAUTHORIZED", "请先登录。");
  let input: unknown; try { input = await request.json(); } catch { return purchaseErrorResponse(400, "INVALID_JSON", "请求内容不是有效的 JSON。"); }
  try { return NextResponse.json({ data: await context.service.analyze(context.user.id, input) }, { status: 201, headers: purchaseNoStoreHeaders }); }
  catch (error) {
    if (error instanceof ZodError) return purchaseErrorResponse(400, "VALIDATION_ERROR", "候选产品信息不符合要求。", error.flatten().fieldErrors);
    if (error instanceof PurchaseAnalysisNotFoundError) return purchaseErrorResponse(404, error.code, "找不到已验证的目录产品。");
    return purchaseErrorResponse(500, "PURCHASE_ANALYSIS_CREATE_FAILED", "无法生成购买分析。");
  }
}
