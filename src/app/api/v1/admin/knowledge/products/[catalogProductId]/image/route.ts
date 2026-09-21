import { NextResponse } from "next/server";
import { ZodError, z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { catalogProductImageUpdateSchema } from "@/schemas/catalog-product-image";
import { requireAdmin } from "@/server/auth/require-admin";

const headers = { "Cache-Control": "private, no-store" };

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ catalogProductId: string }> },
) {
  try {
    await requireAdmin();
    const catalogProductId = z.uuid().parse((await params).catalogProductId);
    const update = catalogProductImageUpdateSchema.parse(await request.json());
    const { data, error } = await createAdminClient()
      .from("catalog_products")
      .update({ catalog_image_url: update.catalog_image_url, catalog_image_source_url: null, updated_at: new Date().toISOString() })
      .eq("id", catalogProductId)
      .select("catalog_image_url")
      .maybeSingle();
    if (error) throw error;
    if (!data) return errorResponse(404, "CATALOG_PRODUCT_NOT_FOUND", "未找到 Catalog 产品。");
    return NextResponse.json({ data }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return errorResponse(400, "VALIDATION_ERROR", "产品图片 URL 不符合要求。");
    const status = error instanceof Error && "status" in error ? Number(error.status) : 500;
    return errorResponse(status, status === 403 ? "ADMIN_REQUIRED" : "CATALOG_IMAGE_UPDATE_FAILED", "无法保存产品图片。");
  }
}

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}
