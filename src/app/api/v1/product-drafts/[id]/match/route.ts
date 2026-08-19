import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { createProductDraftRepository } from "@/server/repositories/product-draft-repository";
import { ProductDraftNotFoundError, ProductDraftStateError } from "@/server/services/product-draft-service";
import { createProductDraftMatchingService } from "@/server/services/product-draft-matching-service";

const headers = { "Cache-Control": "private, no-store" };
const error = (status: number, code: string, message: string, fields?: Record<string, string[] | undefined>) => NextResponse.json({ error: { code, message, ...(fields ? { fields } : {}) } }, { status, headers });

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return error(401, "UNAUTHORIZED", "请先登录。");
  try {
    const { id } = await context.params;
    const supabase = await createClient();
    const service = createProductDraftMatchingService(createProductDraftRepository(supabase), createKnowledgeRepository(supabase));
    return NextResponse.json({ data: await service.matchDraft(user.id, id) }, { headers });
  } catch (cause) {
    if (cause instanceof ZodError) return error(400, "VALIDATION_ERROR", "产品草稿 ID 不符合要求。", cause.flatten().fieldErrors);
    if (cause instanceof ProductDraftNotFoundError) return error(404, cause.code, "找不到当前用户的产品草稿。");
    if (cause instanceof ProductDraftStateError) return error(409, cause.code, "只有待确认草稿可以匹配。");
    return error(500, "PRODUCT_DRAFT_MATCH_FAILED", "无法查询目录候选。");
  }
}
