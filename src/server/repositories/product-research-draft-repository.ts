import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/db/database.types";
import {
  productResearchDraftSchema,
  type ProductResearchDraft,
  type ProductResearchDraftCreate,
  type ProductResearchDraftReviewUpdate,
} from "@/schemas/product-research-draft";
import { effectiveProductResearchDraft } from "@/server/services/effective-product-research-draft";

type ResearchDraftRow = Database["public"]["Tables"]["catalog_product_research_drafts"]["Row"];

export type ProductResearchDraftRepository = {
  createDraft(input: ProductResearchDraftCreate): Promise<ProductResearchDraft>;
  getDraft(id: string): Promise<ProductResearchDraft | null>;
  getLatestDraft(catalogProductId: string): Promise<ProductResearchDraft | null>;
  getLatestUsableDraft(catalogProductId: string, timing?: { requestId: string }): Promise<ProductResearchDraft | null>;
  getLatestUsableDrafts?(catalogProductIds: string[], timing?: { requestId: string }): Promise<ReadonlyMap<string, ProductResearchDraft>>;
  listDrafts(catalogProductId: string): Promise<ProductResearchDraft[]>;
  listUsableDrafts(): Promise<ProductResearchDraft[]>;
  listRecentDrafts(): Promise<ProductResearchDraft[]>;
  updatePayload(id: string, payload: ProductResearchDraft["research_payload"]): Promise<ProductResearchDraft | null>;
  updateReviewStatus(
    id: string,
    update: ProductResearchDraftReviewUpdate,
  ): Promise<ProductResearchDraft | null>;
};

export function createProductResearchDraftRepository(
  supabase: SupabaseClient<Database>,
): ProductResearchDraftRepository {
  async function getLatestUsableDrafts(
    catalogProductIds: string[],
    timing?: { requestId: string },
  ) {
    const ids = [...new Set(catalogProductIds)];
    if (ids.length === 0) return new Map<string, ProductResearchDraft>();
    const startedAt = Date.now();
    const { data, error } = await supabase
      .from("catalog_product_research_drafts")
      .select("*")
      .in("catalog_product_id", ids)
      .in("status", ["draft", "review_pending", "approved"])
      .order("research_version", { ascending: false });
    logTodayBatchQueryTiming(timing, "research_draft_batch", ids.length, startedAt, !error);
    if (error) throw new Error("PRODUCT_RESEARCH_DRAFT_READ_FAILED", { cause: error });

    const rowsByCatalogId = new Map<string, ProductResearchDraft[]>();
    for (const row of (data ?? []).map(parseRow)) {
      const rows = rowsByCatalogId.get(row.catalog_product_id) ?? [];
      rows.push(row);
      rowsByCatalogId.set(row.catalog_product_id, rows);
    }
    const result = new Map<string, ProductResearchDraft>();
    for (const [catalogProductId, rows] of rowsByCatalogId) {
      const effective = effectiveProductResearchDraft(rows);
      if (effective) result.set(catalogProductId, effective);
    }
    return result;
  }

  return {
    async createDraft(input) {
      const { data, error } = await supabase
        .from("catalog_product_research_drafts")
        .insert({
          ...input,
          research_payload: input.research_payload as Json,
        })
        .select("*")
        .single();
      if (error) throw new Error("PRODUCT_RESEARCH_DRAFT_CREATE_FAILED", { cause: error });
      return parseRow(data);
    },

    async getDraft(id) {
      const { data, error } = await supabase
        .from("catalog_product_research_drafts")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error("PRODUCT_RESEARCH_DRAFT_READ_FAILED", { cause: error });
      return data ? parseRow(data) : null;
    },

    async getLatestDraft(catalogProductId) {
      const { data, error } = await supabase
        .from("catalog_product_research_drafts")
        .select("*")
        .eq("catalog_product_id", catalogProductId)
        .order("research_version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error("PRODUCT_RESEARCH_DRAFT_READ_FAILED", { cause: error });
      return data ? parseRow(data) : null;
    },

    async getLatestUsableDraft(catalogProductId, timing) {
      const startedAt = Date.now();
      const { data, error } = await supabase
        .from("catalog_product_research_drafts")
        .select("*")
        .eq("catalog_product_id", catalogProductId)
        .in("status", ["draft", "review_pending", "approved"])
        .order("research_version", { ascending: false });
      logTodayQueryTiming(timing, "research_draft", catalogProductId, startedAt, !error);
      if (error) throw new Error("PRODUCT_RESEARCH_DRAFT_READ_FAILED", { cause: error });
      // This is a read-only effective snapshot: a newer sparse enrichment
      // result may never erase a prior source-backed section at runtime.
      return effectiveProductResearchDraft((data ?? []).map(parseRow));
    },
    getLatestUsableDrafts,

    async listDrafts(catalogProductId) {
      const { data, error } = await supabase
        .from("catalog_product_research_drafts")
        .select("*")
        .eq("catalog_product_id", catalogProductId)
        .order("research_version", { ascending: false });
      if (error) throw new Error("PRODUCT_RESEARCH_DRAFT_READ_FAILED", { cause: error });
      return (data ?? []).map(parseRow);
    },
    async listUsableDrafts() {
      const { data, error } = await supabase
        .from("catalog_product_research_drafts")
        .select("*")
        .in("status", ["draft", "review_pending", "approved"])
        .order("research_version", { ascending: false });
      if (error) throw new Error("PRODUCT_RESEARCH_DRAFT_READ_FAILED", { cause: error });
      return (data ?? []).map(parseRow);
    },
    async listRecentDrafts() {
      const { data, error } = await supabase.from("catalog_product_research_drafts")
        .select("*").order("created_at", { ascending: false }).limit(100);
      if (error) throw new Error("PRODUCT_RESEARCH_DRAFT_READ_FAILED", { cause: error });
      return (data ?? []).map(parseRow);
    },
    async updatePayload(id, research_payload) {
      const { data, error } = await supabase.from("catalog_product_research_drafts")
        .update({ research_payload: research_payload as Json, updated_at: new Date().toISOString() })
        .eq("id", id).select("*").maybeSingle();
      if (error) throw new Error("PRODUCT_RESEARCH_DRAFT_UPDATE_FAILED", { cause: error });
      return data ? parseRow(data) : null;
    },

    async updateReviewStatus(id, update) {
      const { data, error } = await supabase
        .from("catalog_product_research_drafts")
        .update({
          status: update.status,
          reviewed_by: update.reviewed_by,
          reviewed_at: update.reviewed_at,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (error) throw new Error("PRODUCT_RESEARCH_DRAFT_UPDATE_FAILED", { cause: error });
      return data ? parseRow(data) : null;
    },
  };
}

function logTodayBatchQueryTiming(timing: { requestId: string } | undefined, queryKind: string, catalogProductCount: number, startedAt: number, success: boolean) {
  if (process.env.NODE_ENV !== "development" || !timing) return;
  console.info("[today-supabase]", { requestId: timing.requestId, queryKind, catalogProductCount, durationMs: Date.now() - startedAt, success });
}

function logTodayQueryTiming(timing: { requestId: string } | undefined, queryKind: string, catalogProductId: string, startedAt: number, success: boolean) {
  if (process.env.NODE_ENV !== "development" || !timing) return;
  console.info("[today-supabase]", { requestId: timing.requestId, queryKind, catalogProductId: catalogProductId.slice(0, 8), durationMs: Date.now() - startedAt, success });
}

function parseRow(row: ResearchDraftRow): ProductResearchDraft {
  return productResearchDraftSchema.parse({
    ...row,
    // Historical immutable snapshots may still contain the retired Product
    // Knowledge shelf-life payload. Ignore it at the read boundary rather
    // than rewriting past research records or keeping it in the active DTO.
    research_payload: stripLegacyShelfLife(row.research_payload),
  });
}

export function stripLegacyShelfLife(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const payload = { ...(value as Record<string, unknown>) };
  delete payload.shelf_life;
  if (payload.field_confidence && typeof payload.field_confidence === "object" && !Array.isArray(payload.field_confidence)) {
    const fieldConfidence = { ...(payload.field_confidence as Record<string, unknown>) };
    delete fieldConfidence.shelf_life;
    payload.field_confidence = fieldConfidence;
  }
  return payload;
}
