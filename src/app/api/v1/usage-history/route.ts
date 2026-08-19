import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { routineErrorResponse, routineNoStoreHeaders } from "@/server/routines/routine-api-response";
import { getUsageRequestContext } from "@/server/usage/get-usage-request-context";

export async function GET(request: Request) {
  const context = await getUsageRequestContext();
  if (!context) return routineErrorResponse(401, "UNAUTHORIZED", "请先登录。");

  try {
    const limit = new URL(request.url).searchParams.get("limit") ?? undefined;
    const history = await context.service.listUsageHistory(context.user.id, { limit });
    return NextResponse.json({ data: history }, { headers: routineNoStoreHeaders });
  } catch (error) {
    if (error instanceof ZodError) {
      return routineErrorResponse(400, "VALIDATION_ERROR", "历史查询参数不符合要求。", error.flatten().fieldErrors);
    }
    return routineErrorResponse(500, "USAGE_HISTORY_READ_FAILED", "无法读取使用历史。");
  }
}

