import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createProductDraftRepository } from "@/server/repositories/product-draft-repository";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
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
  const knowledge = createKnowledgeRepository(supabase);
  return {
    user,
    service: createProductDraftService(
      createProductDraftRepository(supabase),
      createUploadRepository(supabase),
    ),
    knowledge,
  };
}

export async function GET(request: Request) {
  const context = await getRequestContext();

  if (!context) {
    return errorResponse(401, "UNAUTHORIZED", "请先登录。");
  }

  const url = new URL(request.url);

  try {
    const drafts = await context.service.listDrafts(context.user.id, {
      status: url.searchParams.get("status") ?? undefined,
    });
    const data = await Promise.all(drafts.map(async (draft) => ({
      ...draft,
      candidate_catalog_product: draft.candidate_catalog_product_id
        ? await context.knowledge.findVerifiedProduct(draft.candidate_catalog_product_id)
        : null,
    })));
    return NextResponse.json({ data }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "草稿查询条件不符合要求。",
        error.flatten().fieldErrors,
      );
    }

    return errorResponse(500, "PRODUCT_DRAFT_READ_FAILED", "无法读取产品草稿。");
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
    const draft = await context.service.createDraft(context.user.id, input);
    return NextResponse.json(
      { data: draft },
      { status: 201, headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "创建草稿所需的图片资产不符合要求。",
        error.flatten().fieldErrors,
      );
    }

    if (error instanceof ProductDraftNotFoundError) {
      return errorResponse(404, error.code, "找不到当前用户的图片资产。");
    }

    if (error instanceof ProductDraftStateError) {
      return errorResponse(409, error.code, "图片尚未就绪或已经关联产品。");
    }

    return errorResponse(500, "PRODUCT_DRAFT_CREATE_FAILED", "无法创建产品草稿。");
  }
}
