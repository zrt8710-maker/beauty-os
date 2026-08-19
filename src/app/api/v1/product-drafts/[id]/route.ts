import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createProductDraftRepository } from "@/server/repositories/product-draft-repository";
import { createUploadRepository } from "@/server/repositories/upload-repository";
import {
  ProductDraftNotFoundError,
  ProductDraftStateError,
  createProductDraftService,
} from "@/server/services/product-draft-service";

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

  if (!user) {
    return null;
  }

  const supabase = await createClient();
  return {
    user,
    service: createProductDraftService(
      createProductDraftRepository(supabase),
      createUploadRepository(supabase),
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
    const draft = await context.service.updateDraft(
      context.user.id,
      id,
      input,
    );
    return NextResponse.json({ data: draft }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "产品草稿内容不符合要求。",
        error.flatten().fieldErrors,
      );
    }

    if (error instanceof ProductDraftNotFoundError) {
      return errorResponse(404, error.code, "找不到当前用户的产品草稿。");
    }

    if (error instanceof ProductDraftStateError) {
      return errorResponse(409, error.code, "只有待确认草稿可以修改。");
    }

    return errorResponse(500, "PRODUCT_DRAFT_UPDATE_FAILED", "无法更新产品草稿。");
  }
}

export async function DELETE(
  _request: Request,
  routeContext: { params: Promise<{ id: string }> },
) {
  const context = await getRequestContext();

  if (!context) {
    return errorResponse(401, "UNAUTHORIZED", "请先登录。");
  }

  try {
    const { id } = await routeContext.params;
    await context.service.rejectDraft(context.user.id, id);
    return new NextResponse(null, { status: 204, headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "VALIDATION_ERROR", "产品草稿 ID 不符合要求。");
    }

    if (error instanceof ProductDraftNotFoundError) {
      return errorResponse(404, error.code, "找不到当前用户的产品草稿。");
    }

    if (error instanceof ProductDraftStateError) {
      return errorResponse(409, error.code, "已确认草稿不能删除。");
    }

    return errorResponse(500, "PRODUCT_DRAFT_DELETE_FAILED", "无法删除产品草稿。");
  }
}
