import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createOwnedProductRepository } from "@/server/repositories/owned-product-repository";
import { createProductRepository } from "@/server/repositories/product-repository";
import { createUploadRepository } from "@/server/repositories/upload-repository";
import { createProductImageStorage } from "@/server/integrations/storage/product-images";
import {
  InventoryNotFoundError,
  createInventoryService,
} from "@/server/services/inventory-service";
import { createUploadService, resolveOwnedProductImage } from "@/server/services/upload-service";

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
  const productRepository = createProductRepository(supabase);
  return {
    user,
    service: createInventoryService(
      productRepository,
      createOwnedProductRepository(supabase),
    ),
    uploadService: createUploadService(
      createUploadRepository(supabase), productRepository,
      createProductImageStorage(supabase), createOwnedProductRepository(supabase),
    ),
  };
}

export async function GET(request: Request) {
  const context = await getRequestContext();

  if (!context) {
    return errorResponse(401, "UNAUTHORIZED", "请先登录。");
  }

  const url = new URL(request.url);
  const query = { status: url.searchParams.get("status") ?? undefined };

  try {
    const inventory = await context.service.listOwnedProductsWithCatalogImage(
      context.user.id,
      query,
    );
    const uploads = await context.uploadService.listUploads(context.user.id, {});
    return NextResponse.json({ data: inventory.map((ownedProduct) => resolveOwnedProductImage(ownedProduct, uploads)) }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "库存查询条件不符合要求。",
        error.flatten().fieldErrors,
      );
    }

    return errorResponse(500, "OWNED_PRODUCT_READ_FAILED", "无法读取库存。");
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
    const ownedProduct = await context.service.createOwnedProduct(
      context.user.id,
      input,
    );
    return NextResponse.json(
      { data: ownedProduct },
      { status: 201, headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "库存信息不符合要求。",
        error.flatten().fieldErrors,
      );
    }

    if (error instanceof InventoryNotFoundError) {
      return errorResponse(404, error.code, "找不到当前用户的产品记录。");
    }

    return errorResponse(500, "OWNED_PRODUCT_CREATE_FAILED", "无法添加库存。");
  }
}
