import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { KnowledgeProductNotFoundError, createKnowledgeService } from "@/server/services/knowledge-service";

const headers = { "Cache-Control": "private, no-store" };
const error = (status: number, code: string, message: string, fields?: Record<string, string[] | undefined>) => NextResponse.json({ error: { code, message, ...(fields ? { fields } : {}) } }, { status, headers });

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!await getCurrentUser()) return error(401, "UNAUTHORIZED", "请先登录。");
  try {
    const { id } = await context.params;
    const service = createKnowledgeService(createKnowledgeRepository(await createClient()));
    return NextResponse.json({ data: await service.getProductIngredients(id) }, { headers });
  } catch (cause) {
    if (cause instanceof ZodError) return error(400, "VALIDATION_ERROR", "产品知识标识不正确。", cause.flatten().fieldErrors);
    if (cause instanceof KnowledgeProductNotFoundError) return error(404, "KNOWLEDGE_PRODUCT_NOT_FOUND", "找不到已验证产品知识。");
    return error(500, "KNOWLEDGE_INGREDIENT_READ_FAILED", "无法读取产品成分知识。");
  }
}
