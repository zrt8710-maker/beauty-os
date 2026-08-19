import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createSkinCheckinRepository } from "@/server/repositories/skin-checkin-repository";
import {
  SkinCheckinNotFoundError,
  createSkinCheckinService,
} from "@/server/services/skin-checkin-service";

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

export async function PATCH(
  request: Request,
  routeContext: { params: Promise<{ id: string }> },
) {
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
    const { id } = await routeContext.params;
    const checkin = await context.service.updateCheckin(
      context.user.id,
      id,
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

    if (error instanceof SkinCheckinNotFoundError) {
      return errorResponse(404, "SKIN_CHECKIN_NOT_FOUND", "找不到当前用户的记录。");
    }

    return errorResponse(500, "SKIN_CHECKIN_WRITE_FAILED", "无法更新皮肤记录。");
  }
}
