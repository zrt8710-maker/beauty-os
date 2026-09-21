import "server-only";

import { NextResponse } from "next/server";

import { SupabaseAdminConfigurationError } from "@/server/config/supabase-admin-env";
import {
  AdminRequiredError,
  UnauthorizedError,
} from "@/server/auth/require-admin";
import {
  CatalogSeedReadbackError,
  CatalogSeedServiceConflictError,
  CatalogSeedServiceValidationError,
} from "@/server/services/catalog-seed-service";

export type AdminCatalogSeedOperation = "dry-run" | "apply";

const noStoreHeaders = { "Cache-Control": "private, no-store" };

export class CatalogSeedRequestJsonError extends Error {
  readonly code = "CATALOG_SEED_INVALID";

  constructor() {
    super("CATALOG_SEED_INVALID");
    this.name = "CatalogSeedRequestJsonError";
  }
}

export async function readCatalogSeedRequest(request: Request) {
  try {
    return await request.json() as unknown;
  } catch {
    throw new CatalogSeedRequestJsonError();
  }
}

export function adminCatalogSeedDataResponse(data: unknown) {
  return NextResponse.json({ data }, { headers: noStoreHeaders });
}

export function adminCatalogSeedErrorResponse(
  error: unknown,
  operation: AdminCatalogSeedOperation,
) {
  if (error instanceof UnauthorizedError) {
    return errorResponse(401, error.code, "请先登录。");
  }

  if (error instanceof AdminRequiredError) {
    return errorResponse(403, error.code, "需要管理员权限。");
  }

  if (error instanceof CatalogSeedRequestJsonError) {
    return errorResponse(400, error.code, "Catalog Seed 输入不是有效的 JSON。");
  }

  if (error instanceof CatalogSeedServiceValidationError) {
    return errorResponse(
      400,
      "CATALOG_SEED_INVALID",
      "Catalog Seed 输入未通过校验。",
      { errors: error.errors, warnings: error.warnings },
    );
  }

  if (error instanceof CatalogSeedServiceConflictError) {
    return errorResponse(
      409,
      "CATALOG_SEED_CONFLICT",
      "Catalog Seed 与现有标准产品目录冲突。",
      { conflicts: error.conflicts, warnings: error.warnings },
    );
  }

  if (error instanceof SupabaseAdminConfigurationError) {
    return errorResponse(
      500,
      error.code,
      "管理员数据库连接配置不可用。",
    );
  }

  if (
    error instanceof Error
    && error.message === "CATALOG_SEED_WRITE_FAILED"
  ) {
    return errorResponse(
      500,
      "CATALOG_SEED_WRITE_FAILED",
      "标准产品写入失败。",
    );
  }

  if (error instanceof CatalogSeedReadbackError) {
    return errorResponse(
      500,
      "CATALOG_SEED_READBACK_FAILED",
      "标准产品写入后的回读确认失败。",
    );
  }

  return operation === "dry-run"
    ? errorResponse(
      500,
      "CATALOG_SEED_DRY_RUN_FAILED",
      "无法完成 Catalog Seed 预检。",
    )
    : errorResponse(
      500,
      "CATALOG_SEED_APPLY_FAILED",
      "无法应用 Catalog Seed。",
    );
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    { status, headers: noStoreHeaders },
  );
}
