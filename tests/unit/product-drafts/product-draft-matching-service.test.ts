import { describe, expect, it, vi } from "vitest";

import type { KnowledgeRepository } from "@/server/repositories/knowledge-repository";
import type { ProductDraftRepository } from "@/server/repositories/product-draft-repository";
import { createProductDraftMatchingService } from "@/server/services/product-draft-matching-service";

const draftId = "10000000-0000-4000-8000-000000000001";
const catalogId = "20000000-0000-4000-8000-000000000001";
const source = { id: "30000000-0000-4000-8000-000000000001", source_type: "official_brand", name: "Brand", source_url: "https://example.com", license_note: null, retrieved_at: "2026-08-18T00:00:00.000Z", created_at: "2026-08-18T00:00:00.000Z" };
const catalog = { id: catalogId, brand_name: "CeraVe", product_name: "Daily SPF", variant_name: null, barcode: "12345678", category: "skincare", subcategory: "sun_care", product_type: "sunscreen", primary_source_id: source.id, confidence: 95, status: "verified", created_at: source.created_at, updated_at: source.created_at, source };
const draft = (override: Record<string, unknown> = {}) => ({ id: draftId, user_id: "user-a", upload_asset_id: "40000000-0000-4000-8000-000000000001", brand_name: "CeraVe", product_name: "Daily SPF", barcode: null, category: "skincare", subcategory: "sun_care", product_type: "sunscreen", notes: null, source: "manual", status: "pending", candidate_catalog_product_id: null, match_source: null, match_confidence: null, match_evidence: null, knowledge_confirmed_at: null, created_at: source.created_at, updated_at: source.created_at, ...override });

describe("ProductDraftMatchingService", () => {
  function setup(row = draft()) {
    const drafts: ProductDraftRepository = { listByUserId: vi.fn(), findById: vi.fn().mockResolvedValue(row), create: vi.fn(), update: vi.fn(), reject: vi.fn(), confirmTransaction: vi.fn(), saveCandidate: vi.fn().mockImplementation(async (_id, candidateId, matchSource) => ({ ...row, candidate_catalog_product_id: candidateId, match_source: matchSource, match_confidence: matchSource === "barcode_exact" ? 100 : matchSource ? 90 : null, match_evidence: matchSource ? "匹配证据" : null })) };
    const knowledge: KnowledgeRepository = { listVerifiedProducts: vi.fn(), findVerifiedProduct: vi.fn(), listVerifiedProductIngredients: vi.fn(), findVerifiedByBarcode: vi.fn(), listVerifiedProductsForMatching: vi.fn() };
    return { drafts, knowledge, service: createProductDraftMatchingService(drafts, knowledge) };
  }
  it("优先使用 verified catalog 的条码精确匹配", async () => {
    const { knowledge, service, drafts } = setup(draft({ barcode: "12345678" })); vi.mocked(knowledge.findVerifiedByBarcode).mockResolvedValue(catalog);
    const result = await service.matchDraft("user-a", draftId);
    expect(knowledge.findVerifiedByBarcode).toHaveBeenCalledWith("12345678");
    expect(result.status).toBe("candidate"); expect(result.draft.match_source).toBe("barcode_exact"); expect(result.draft.candidate_catalog_product_id).toBe(catalogId); expect(drafts.saveCandidate).toHaveBeenCalledWith(draftId, catalogId, "barcode_exact");
  });
  it("品牌和名称标准化后精确匹配", async () => {
    const { knowledge, service } = setup(draft({ brand_name: " CeraVe ", product_name: "Daily-SPF" })); vi.mocked(knowledge.listVerifiedProductsForMatching).mockResolvedValue([catalog]);
    const result = await service.matchDraft("user-a", draftId);
    expect(result.status).toBe("candidate"); expect(result.draft.match_source).toBe("normalized_name_exact"); expect(result.draft.candidate_catalog_product_id).toBe(catalogId);
  });
  it("找不到候选时清空候选字段，非 verified 候选不会进入 repository 结果", async () => {
    const { knowledge, service } = setup(); vi.mocked(knowledge.listVerifiedProductsForMatching).mockResolvedValue([]);
    const result = await service.matchDraft("user-a", draftId);
    expect(result.status).toBe("no_match"); expect(result.draft.candidate_catalog_product_id).toBeNull(); expect(result.draft.match_source).toBeNull();
  });
  it("同一标准化名称出现多个候选时返回 match_conflict，不自动选择第一条", async () => {
    const duplicate = { ...catalog, id: "20000000-0000-4000-8000-000000000002", variant_name: "Rich" };
    const { knowledge, service, drafts } = setup();
    vi.mocked(knowledge.listVerifiedProductsForMatching).mockResolvedValue([catalog, duplicate]);
    const result = await service.matchDraft("user-a", draftId);
    expect(result.status).toBe("match_conflict");
    expect(result.draft.candidate_catalog_product_id).toBeNull();
    expect(drafts.saveCandidate).toHaveBeenCalledWith(draftId, null, null);
  });
  it("其他用户草稿不会进入匹配流程", async () => {
    const { drafts, service } = setup(); vi.mocked(drafts.findById).mockResolvedValue(null);
    await expect(service.matchDraft("user-a", draftId)).rejects.toThrow("DRAFT_NOT_FOUND"); expect(drafts.saveCandidate).not.toHaveBeenCalled();
  });
});
