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
  UploadStateError,
  createUploadService,
} from "@/server/services/upload-service";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
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

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestContext = await getRequestContext();

  if (!requestContext) {
    return errorResponse(401, "UNAUTHORIZED", "请先登录。");
  }

  try {
    const { id } = await context.params;
    const upload = await requestContext.service.completeUpload(
      requestContext.user.id,
      id,
    );
    return NextResponse.json({ data: upload }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "VALIDATION_ERROR", "图片资产 ID 不符合要求。");
    }

    if (error instanceof UploadNotFoundError) {
      return errorResponse(404, error.code, "找不到当前用户的图片资产。");
    }

    if (error instanceof UploadStateError) {
      const message =
        error.code === "UPLOAD_INCOMPLETE"
          ? "Storage 中尚未找到上传文件。"
          : "上传文件状态或元数据不符合要求。";
      return errorResponse(409, error.code, message);
    }

    return errorResponse(500, "UPLOAD_COMPLETE_FAILED", "无法确认图片上传。");
  }
}
