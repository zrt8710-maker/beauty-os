import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  AdminRequiredError,
  UnauthorizedError,
} from "@/server/auth/require-admin";
import { InvalidDiscoveryBarcodeError } from "@/server/domain/product-discovery";
import { CriticalProductDiscoveryProviderError } from "@/server/services/product-discovery-service";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export class ProductDiscoveryRequestJsonError extends Error {
  readonly code = "PRODUCT_DISCOVERY_INVALID_JSON";

  constructor() {
    super("PRODUCT_DISCOVERY_INVALID_JSON");
    this.name = "ProductDiscoveryRequestJsonError";
  }
}

export async function readProductDiscoveryRequest(request: Request) {
  try {
    return await request.json() as unknown;
  } catch {
    throw new ProductDiscoveryRequestJsonError();
  }
}

export function adminProductDiscoveryDataResponse(data: unknown) {
  return NextResponse.json({ data }, { headers: noStoreHeaders });
}

export function adminProductDiscoveryErrorResponse(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return errorResponse(401, error.code, "请先登录。");
  }
  if (error instanceof AdminRequiredError) {
    return errorResponse(403, error.code, "需要管理员权限。");
  }
  if (error instanceof ProductDiscoveryRequestJsonError) {
    return errorResponse(400, error.code, "Product Discovery 输入不是有效的 JSON。");
  }
  if (error instanceof InvalidDiscoveryBarcodeError) {
    return errorResponse(400, error.code, "商品条码格式或校验位无效。");
  }
  if (error instanceof ZodError) {
    return errorResponse(
      400,
      "PRODUCT_DISCOVERY_INVALID",
      "Product Discovery 输入未通过校验。",
      { fields: error.flatten().fieldErrors },
    );
  }
  if (error instanceof CriticalProductDiscoveryProviderError) {
    return errorResponse(
      500,
      error.code,
      "内部产品目录暂时无法查询。",
    );
  }
  return errorResponse(
    500,
    "PRODUCT_DISCOVERY_FAILED",
    "无法完成产品发现查询。",
  );
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status, headers: noStoreHeaders },
  );
}

