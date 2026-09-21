import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createSkinCheckinRepository } from "@/server/repositories/skin-checkin-repository";
import { createSkinCheckinService } from "@/server/services/skin-checkin-service";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

function errorResponse(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string[] | undefined>,
) {
  return NextResponse.json(
    { error: { code, message, ...(fields ? { fields } : {}) } },
    { status, headers: noStoreHeaders },
  );
}

async function getRequestContext() {
  const user = await getCurrentUser();

  if (!user) return null;

  const supabase = await createClient();
  return {
    user,
    service: createSkinCheckinService(
      createSkinCheckinRepository(supabase),
    ),
  };
}

export async function GET(request: Request) {
  const context = await getRequestContext();

  if (!context) {
    return errorResponse(401, "UNAUTHORIZED", "请先登录。");
  }

  const url = new URL(request.url);

  try {
    const checkins = await context.service.listCheckins(context.user.id, {
      limit: url.searchParams.get("limit") ?? undefined,
    });
    return NextResponse.json({ data: checkins }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "记录查询条件不符合要求。",
        error.flatten().fieldErrors,
      );
    }

    return errorResponse(500, "SKIN_CHECKIN_READ_FAILED", "无法读取皮肤记录。");
  }
}

export async function POST(request: Request) {
  const context = await getRequestContext();

  if (!context) {
    return errorResponse(401, "UNAUTHORIZED", "请先登录。");
  }

  let input: unknown;

  try {
    input = await request.json();
  } catch {
    return errorResponse(400, "INVALID_JSON", "请求内容不是有效的 JSON。");
  }

  try {
    const checkin = await context.service.createOrUpdateCheckin(
      context.user.id,
      input,
    );
    return NextResponse.json({ data: checkin }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "皮肤状态数据不符合要求。",
        error.flatten().fieldErrors,
      );
    }

    console.error("[skin-checkin-save] write failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      ...(process.env.NODE_ENV === "development"
        ? {
            message: error instanceof Error ? error.message : String(error),
            cause: error instanceof Error && error.cause && typeof error.cause === "object"
              ? {
                  code: "code" in error.cause ? error.cause.code : undefined,
                  message: "message" in error.cause ? error.cause.message : undefined,
                  details: "details" in error.cause ? error.cause.details : undefined,
                }
              : undefined,
          }
        : {}),
    });
    return errorResponse(500, "SKIN_CHECKIN_WRITE_FAILED", "无法保存皮肤记录。");
  }
}
