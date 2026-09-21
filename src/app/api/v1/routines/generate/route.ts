import { NextResponse } from "next/server";

import { routineGenerateSchema } from "@/schemas/routine";
import { getRoutineRequestContext } from "@/server/routines/get-routine-request-context";
import { routineErrorResponse, routineNoStoreHeaders } from "@/server/routines/routine-api-response";
import {
  RoutineRegenerationFailedError,
  type RoutineGenerationResult,
} from "@/server/services/rule-engine-service";

export const runtime = "nodejs";
// EdgeOne enforces the 120s Cloud Functions limit in root edgeone.json.
// Keep provider budgets unchanged; Next's maxDuration is not the host setting.

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
    const parsedInput = routineGenerateSchema.safeParse(input);
    if (!parsedInput.success) {
      return routineErrorResponse(
        400,
        "VALIDATION_ERROR",
        "方案生成参数不符合要求。",
        parsedInput.error.flatten().fieldErrors,
      );
    }


    let generationResult: RoutineGenerationResult = "generated";
    let generationExplanation: string | undefined;
    const routine = await context.service.generate(
      context.user.id,
      parsedInput.data,
      (result, explanation) => {
        generationResult = result;
        generationExplanation = explanation;
      },
    );
    return NextResponse.json({
      data: routine,
      generationResult,
      ...(generationExplanation ? { generationExplanation } : {}),
    }, { status: 201, headers: routineNoStoreHeaders });
  } catch (error) {
    if (error instanceof RoutineRegenerationFailedError) {
      return routineErrorResponse(
        409,
        "CARE_PLANNER_REGENERATION_FAILED",
        "这次生成没有成功，请再试一次。原方案已保留。",
      );
    }
    if (process.env.NODE_ENV === "development") {
      console.error("[routines/generate] generation failed", error);
    }
    return routineErrorResponse(500, "ROUTINE_GENERATE_FAILED", "无法生成今日方案。");
  }
}
