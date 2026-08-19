import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { createKnowledgeService } from "@/server/services/knowledge-service";

const headers = { "Cache-Control": "private, no-store" };
const error = (status: number, code: string, message: string, fields?: Record<string, string[] | undefined>) => NextResponse.json({ error: { code, message, ...(fields ? { fields } : {}) } }, { status, headers });

export async function GET(request: Request) {
  if (!await getCurrentUser()) return error(401, "UNAUTHORIZED", "请先登录。");
  try {
    const url = new URL(request.url);
    const service = createKnowledgeService(createKnowledgeRepository(await createClient()));
    const data = await service.listProducts({ search: url.searchParams.get("search") ?? undefined, limit: url.searchParams.get("limit") ?? undefined });
    return NextResponse.json({ data }, { headers });
  } catch (cause) {
    if (cause instanceof ZodError) return error(400, "VALIDATION_ERROR", "知识库查询条件不符合要求。", cause.flatten().fieldErrors);
    return error(500, "KNOWLEDGE_PRODUCT_READ_FAILED", "无法读取产品知识。");
  }
}
