import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { getRoutineRequestContext } from "@/server/routines/get-routine-request-context";
import { routineErrorResponse, routineNoStoreHeaders } from "@/server/routines/routine-api-response";

export async function GET(request: Request) {
  const context = await getRoutineRequestContext();
  if (!context) return routineErrorResponse(401, "UNAUTHORIZED", "请先登录。");

  const period = new URL(request.url).searchParams.get("period") ?? undefined;
  try {
    const routine = await context.service.getToday(context.user.id, { period });
    return NextResponse.json({ data: routine }, { headers: routineNoStoreHeaders });
  } catch (error) {
    if (error instanceof ZodError) {
      return routineErrorResponse(400, "VALIDATION_ERROR", "方案时段不符合要求。", error.flatten().fieldErrors);
    }
    return routineErrorResponse(500, "ROUTINE_READ_FAILED", "无法读取今日方案。");
  }
}

