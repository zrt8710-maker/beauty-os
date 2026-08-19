import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createOwnedProductRepository } from "@/server/repositories/owned-product-repository";
import { createProductRepository } from "@/server/repositories/product-repository";
import {
  InventoryNotFoundError,
  createInventoryService,
} from "@/server/services/inventory-service";

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
    service: createInventoryService(
      createProductRepository(supabase),
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
  const query = { status: url.searchParams.get("status") ?? undefined };

  try {
    const inventory = await context.service.listOwnedProducts(
      context.user.id,
      query,
    );
    return NextResponse.json({ data: inventory }, { headers: noStoreHeaders });
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
