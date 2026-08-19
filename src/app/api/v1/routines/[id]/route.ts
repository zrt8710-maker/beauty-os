import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getRoutineRequestContext } from "@/server/routines/get-routine-request-context";
import { routineErrorResponse, routineNoStoreHeaders } from "@/server/routines/routine-api-response";
import { RoutineNotFoundError } from "@/server/services/rule-engine-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestContext = await getRoutineRequestContext();
  if (!requestContext) return routineErrorResponse(401, "UNAUTHORIZED", "请先登录。");

  try {
    const { id } = await context.params;
    const routine = await requestContext.service.getRoutine(requestContext.user.id, id);
    return NextResponse.json({ data: routine }, { headers: routineNoStoreHeaders });
  } catch (error) {
    if (error instanceof ZodError) return routineErrorResponse(400, "VALIDATION_ERROR", "方案 ID 不符合要求。");
    if (error instanceof RoutineNotFoundError) return routineErrorResponse(404, "ROUTINE_NOT_FOUND", "找不到方案。");
    return routineErrorResponse(500, "ROUTINE_READ_FAILED", "无法读取方案。");
  }
}

