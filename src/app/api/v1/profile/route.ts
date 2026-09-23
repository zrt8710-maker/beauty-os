import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createProfileRepository } from "@/server/repositories/profile-repository";
import { createProfileService } from "@/server/services/profile-service";

const noStoreHeaders = {
  "Cache-Control": "private, no-store",
};

function errorResponse(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string[] | undefined>,
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(fields ? { fields } : {}),
      },
    },
    { status, headers: noStoreHeaders },
  );
}

async function getRequestContext() {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  const supabase = await createClient();
  const repository = createProfileRepository(supabase);
  const service = createProfileService(repository);

  return { user, service };
}

export async function GET() {
  const context = await getRequestContext();

  if (!context) {
    return errorResponse(401, "UNAUTHORIZED", "请先登录。");
  }

  try {
    const profile = await context.service.getProfile(context.user.id);
    return NextResponse.json(
      { data: profile },
      { headers: noStoreHeaders },
    );
  } catch {
    return errorResponse(500, "PROFILE_READ_FAILED", "无法读取皮肤档案。");
  }
}

export async function PUT(request: Request) {
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
    const profile = await context.service.updateProfile(context.user.id, input, {
      markCarePreferencesSaved: new URL(request.url).searchParams.get("section") === "care-preferences",
    });
    return NextResponse.json(
      { data: profile },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "皮肤档案数据不符合要求。",
        error.flatten().fieldErrors,
      );
    }

    return errorResponse(500, "PROFILE_WRITE_FAILED", "无法保存皮肤档案。");
  }
}
