import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getRoutineRequestContext } from "@/server/routines/get-routine-request-context";
import { routineErrorResponse, routineNoStoreHeaders } from "@/server/routines/routine-api-response";

export async function POST(request: Request) {
  const context = await getRoutineRequestContext();
  if (!context) return routineErrorResponse(401, "UNAUTHORIZED", "请先登录。");

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return routineErrorResponse(400, "INVALID_JSON", "请求内容不是有效的 JSON。");
  }

  try {
    const routine = await context.service.generate(context.user.id, input);
    return NextResponse.json({ data: routine }, { status: 201, headers: routineNoStoreHeaders });
  } catch (error) {
    if (error instanceof ZodError) {
      return routineErrorResponse(400, "VALIDATION_ERROR", "方案生成参数不符合要求。", error.flatten().fieldErrors);
    }
    return routineErrorResponse(500, "ROUTINE_GENERATE_FAILED", "无法生成今日方案。");
  }
}

