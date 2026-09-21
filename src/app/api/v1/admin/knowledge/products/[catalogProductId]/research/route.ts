import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/server/auth/require-admin";
import { createCatalogIdentityRepository } from "@/server/repositories/catalog-identity-repository";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { createProductResearchDraftRepository } from "@/server/repositories/product-research-draft-repository";
import { createConfiguredVolcengineAgentPlanProductResearchProvider } from "@/server/product-research/volcengine-agent-plan-provider";
import { createConfiguredVolcengineSearchInfinityProvider } from "@/server/product-search/volcengine-search-infinity-provider";
import { createProductResearchTriggerService } from "@/server/services/product-research-trigger-service";

const headers = { "Cache-Control": "private, no-store" };

/** Explicit Admin maintenance action; normal automatic discovery dedup remains unchanged. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ catalogProductId: string }> },
) {
  try {
    await requireAdmin();
    const { catalogProductId } = await params;
    const supabase = createAdminClient();
    const catalogProduct = await createCatalogIdentityRepository(supabase).findById(catalogProductId);
    if (!catalogProduct) return errorResponse(404, "CATALOG_PRODUCT_NOT_FOUND", "未找到可重新研究的 Catalog Product。");

    const result = await createProductResearchTriggerService({
      provider: createConfiguredVolcengineAgentPlanProductResearchProvider(),
      drafts: createProductResearchDraftRepository(supabase),
      knowledge: createKnowledgeRepository(supabase),
      model: process.env.VOLCENGINE_AGENT_PLAN_MODEL?.trim() ?? null,
      searchProvider: createConfiguredVolcengineSearchInfinityProvider(),
    }).rerun({
      catalog_product_id: catalogProduct.id,
      brand_name: catalogProduct.brand_name,
      product_name: catalogProduct.product_name,
      variant_name: catalogProduct.variant_name,
      barcode: catalogProduct.barcode,
      aliases: [],
      identity_sources: [],
      search_results: [],
    });

    if (result === "started") return NextResponse.json({ status: "triggered" }, { headers });
    if (result === "partial") return NextResponse.json({ status: "partial" }, { headers });
    if (result === "failed") return errorResponse(502, "PRODUCT_RESEARCH_RERUN_FAILED", "Agent3 research 未能完成；当前研究版本已保留。");
    return NextResponse.json({ status: "skipped", reason: result }, { headers });
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number(error.status) : 500;
    return errorResponse(status, status === 403 ? "ADMIN_REQUIRED" : "PRODUCT_RESEARCH_RERUN_ERROR", "无法重新研究产品。");
  }
}

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}
