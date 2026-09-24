import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { productResearchInputSchema } from "@/schemas/product-research";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCatalogIdentityRepository } from "@/server/repositories/catalog-identity-repository";
import { createCatalogProductResearchJobRepository } from "@/server/repositories/catalog-product-research-job-repository";
import { createKnowledgeRepository } from "@/server/repositories/knowledge-repository";
import { createProductResearchDraftRepository } from "@/server/repositories/product-research-draft-repository";
import { createConfiguredVolcengineAgentPlanProductResearchProvider } from "@/server/product-research/volcengine-agent-plan-provider";
import { createConfiguredVolcengineSearchInfinityProvider } from "@/server/product-search/volcengine-search-infinity-provider";
import { hasCompleteEnoughProductResearch } from "@/server/services/effective-product-research-draft";
import { createProductResearchTriggerService } from "@/server/services/product-research-trigger-service";

export const runtime = "nodejs";
export const maxDuration = 120;

const headers = { "Cache-Control": "private, no-store" };

function authorized(request: Request) {
  const expected = process.env.PRODUCT_RESEARCH_WORKER_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!expected) return false;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

/** Invoked by Supabase Cron. Asset requests only enqueue; they never run Agent3. */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers });

  const supabase = createAdminClient();
  const jobs = createCatalogProductResearchJobRepository(supabase);
  try {
    await jobs.backfill();
    const job = await jobs.claim();
    if (!job) return NextResponse.json({ status: "idle" }, { headers });

    let outcome: "completed" | "retry" = "retry";
    let reason: string | null = null;
    try {
      const product = await createCatalogIdentityRepository(supabase).findById(job.catalogProductId);
      const drafts = createProductResearchDraftRepository(supabase);
      const existing = await drafts.getLatestUsableDraft(job.catalogProductId);
      if (!product || product.status !== "candidate" || (job.attempts === 1 && existing)
        || hasCompleteEnoughProductResearch(existing)) {
        outcome = "completed";
      } else {
        const trigger = createProductResearchTriggerService({
          provider: createConfiguredVolcengineAgentPlanProductResearchProvider({ overallTimeoutMs: 90_000 }),
          drafts,
          knowledge: createKnowledgeRepository(supabase),
          model: process.env.VOLCENGINE_AGENT_PLAN_MODEL?.trim() ?? null,
          // Search leads remain enabled; a short search timeout leaves time for
          // Agent3's own web_search and draft persistence within EdgeOne's 120s.
          searchProvider: createConfiguredVolcengineSearchInfinityProvider({
            fetchImpl: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(3_000) }),
          }),
          automaticRunLimit: 1,
          transientProviderAttempts: 1,
        });
        const savedInput = productResearchInputSchema.safeParse(job.researchInput);
        const result = await trigger.trigger({
          ...(savedInput.success ? savedInput.data : {}),
          catalog_product_id: product.id,
          brand_name: product.brand_name,
          product_name: product.product_name,
          variant_name: product.variant_name,
          barcode: product.barcode,
          aliases: savedInput.success ? savedInput.data.aliases : [],
          identity_sources: savedInput.success ? savedInput.data.identity_sources : [],
          search_results: [],
        });
        outcome = result === "started" || result === "existing_draft" || result === "verified_knowledge"
          ? "completed" : "retry";
        reason = outcome === "retry" ? result : null;
      }
    } catch (error) {
      reason = error instanceof Error ? error.name : "unknown";
      console.error("PRODUCT_RESEARCH_WORKER_FAILED", { reason });
    }

    const finished = await jobs.finish(job, outcome, reason);
    return NextResponse.json({ status: finished ? outcome : "lease_lost" }, { headers });
  } catch (error) {
    console.error("PRODUCT_RESEARCH_WORKER_ERROR", { name: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "WORKER_FAILED" }, { status: 500, headers });
  }
}
