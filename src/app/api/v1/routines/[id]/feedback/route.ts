import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { routineErrorResponse, routineNoStoreHeaders } from "@/server/routines/routine-api-response";
import { UsageRoutineNotFoundError } from "@/server/services/usage-service";
import { getUsageRequestContext } from "@/server/usage/get-usage-request-context";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestContext = await getUsageRequestContext();
  if (!requestContext) return routineErrorResponse(401, "UNAUTHORIZED", "请先登录。");

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return routineErrorResponse(400, "INVALID_JSON", "请求内容不是有效的 JSON。");
  }

  try {
    const { id } = await context.params;
    const usage = await requestContext.service.recordRoutineUsage(requestContext.user.id, id, input);
    return NextResponse.json({ data: usage }, { status: 201, headers: routineNoStoreHeaders });
  } catch (error) {
    if (error instanceof ZodError) {
      return routineErrorResponse(400, "VALIDATION_ERROR", "使用反馈不符合要求。", error.flatten().fieldErrors);
    }
    if (error instanceof UsageRoutineNotFoundError) {
      return routineErrorResponse(404, "ROUTINE_NOT_FOUND", "找不到当前用户的方案。");
    }
    return routineErrorResponse(500, "USAGE_HISTORY_WRITE_FAILED", "无法保存使用反馈。");
  }
}
