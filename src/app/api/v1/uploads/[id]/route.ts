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

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestContext = await getRequestContext();

  if (!requestContext) {
    return errorResponse(401, "UNAUTHORIZED", "请先登录。");
  }

  try {
    const { id } = await context.params;
    await requestContext.service.deleteUpload(requestContext.user.id, id);
    return new NextResponse(null, { status: 204, headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "VALIDATION_ERROR", "图片资产 ID 不符合要求。");
    }

    if (error instanceof UploadNotFoundError) {
      return errorResponse(404, error.code, "找不到当前用户的图片资产。");
    }

    return errorResponse(500, "UPLOAD_DELETE_FAILED", "无法删除图片资产。");
  }
}
