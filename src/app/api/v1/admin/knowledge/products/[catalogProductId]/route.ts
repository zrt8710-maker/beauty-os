import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/server/auth/require-admin";
import { createProductResearchDraftRepository } from "@/server/repositories/product-research-draft-repository";
import {
  AdminProductKnowledgeNotFoundError,
  createAdminProductKnowledgeMaintenanceService,
} from "@/server/services/admin-product-knowledge-maintenance-service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ catalogProductId: string }> },
) {
  try {
    await requireAdmin();
    const body = await request.json();
    const service = createAdminProductKnowledgeMaintenanceService(
      createProductResearchDraftRepository(createAdminClient()),
    );
    const draft = await service.save((await params).catalogProductId, body);
    return NextResponse.json({ data: draft }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AdminProductKnowledgeNotFoundError) {
      return errorResponse(404, error.code, "此产品尚无可维护的研究结果。");
    }
    if (error instanceof ZodError) {
      return errorResponse(400, "VALIDATION_ERROR", "产品知识编辑内容不符合要求。", error.flatten().fieldErrors);
    }
    const status = error instanceof Error && "status" in error ? Number(error.status) : 500;
    return errorResponse(status, status === 403 ? "ADMIN_REQUIRED" : "PRODUCT_KNOWLEDGE_SAVE_FAILED", "无法保存产品知识。");
  }
}

function errorResponse(status: number, code: string, message: string, fields?: Record<string, string[] | undefined>) {
  return NextResponse.json(
    { error: { code, message, ...(fields ? { fields } : {}) } },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );
}
