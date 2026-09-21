import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createProductImageStorage } from "@/server/integrations/storage/product-images";
import { createProductRepository } from "@/server/repositories/product-repository";
import { createOwnedProductRepository } from "@/server/repositories/owned-product-repository";
import { createUploadRepository } from "@/server/repositories/upload-repository";
import {
  UploadNotFoundError,
  createUploadService,
} from "@/server/services/upload-service";

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
    service: createUploadService(
      createUploadRepository(supabase),
      createProductRepository(supabase),
      createProductImageStorage(supabase),
      createOwnedProductRepository(supabase),
    ),
  };
}

export async function GET(request: Request) {
  const context = await getRequestContext();

  if (!context) {
    return errorResponse(401, "UNAUTHORIZED", "请先登录。");
  }

  const url = new URL(request.url);
  const query = {
    product_id: url.searchParams.get("product_id") ?? undefined,
  };

  try {
    const uploads = await context.service.listUploads(context.user.id, query);
    return NextResponse.json({ data: uploads }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "图片资产查询条件不符合要求。",
        error.flatten().fieldErrors,
      );
    }

    return errorResponse(500, "UPLOAD_READ_FAILED", "无法读取图片资产。");
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
    const task = await context.service.createUploadTask(context.user.id, input);
    return NextResponse.json(
      { data: task },
      { status: 201, headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "图片文件不符合上传要求。",
        error.flatten().fieldErrors,
      );
    }

    if (error instanceof UploadNotFoundError) {
      return errorResponse(404, error.code, "找不到当前用户的产品记录。");
    }

    return errorResponse(500, "UPLOAD_CREATE_FAILED", "无法创建图片上传任务。");
  }
}
