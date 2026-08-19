import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createOwnedProductRepository } from "@/server/repositories/owned-product-repository";
import { createProductRepository } from "@/server/repositories/product-repository";
import { createInventoryService } from "@/server/services/inventory-service";

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
  const query = {
    category: url.searchParams.get("category") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
  };

  try {
    const products = await context.service.listProducts(context.user.id, query);
    return NextResponse.json({ data: products }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "产品查询条件不符合要求。",
        error.flatten().fieldErrors,
      );
    }

    return errorResponse(500, "PRODUCT_READ_FAILED", "无法读取产品记录。");
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
    const product = await context.service.createProduct(context.user.id, input);
    return NextResponse.json(
      { data: product },
      { status: 201, headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "产品信息不符合要求。",
        error.flatten().fieldErrors,
      );
    }

    return errorResponse(500, "PRODUCT_CREATE_FAILED", "无法创建产品记录。");
  }
}
