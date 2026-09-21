import { describe, expect, it, vi } from "vitest";

import type { KnowledgeRepository } from "@/server/repositories/knowledge-repository";
import type { OwnedProductRepository } from "@/server/repositories/owned-product-repository";
import type { ProfileRepository } from "@/server/repositories/profile-repository";
import type { PurchaseAnalysisRepository } from "@/server/repositories/purchase-analysis-repository";
import type { UsageService } from "@/server/services/usage-service";
import { createPurchaseAnalysisService } from "@/server/services/purchase-analysis-service";

const catalogId = "10000000-0000-4000-8000-000000000001";
const sourceId = "20000000-0000-4000-8000-000000000001";
const timestamp = "2026-08-18T00:00:00.000Z";

describe("PurchaseAnalysisService", () => {
  it("用 verified catalog 候选关联用户资产并保存可追溯快照", async () => {
    const source = { id: sourceId, source_type: "official_brand", name: "Official", source_url: "https://example.com", license_note: null, retrieved_at: timestamp, created_at: timestamp };
    const catalog = { id: catalogId, brand_name: "Beauty", product_name: "Serum", variant_name: null, barcode: null, category: "skincare", subcategory: "face_care", product_type: "serum", primary_source_id: sourceId, confidence: 95, status: "verified", created_at: timestamp, updated_at: timestamp, source };
    const owned = { id: "30000000-0000-4000-8000-000000000001", user_id: "user-a", product_id: "40000000-0000-4000-8000-000000000001", status: "active", purchase_date: null, opened_at: null, expires_on: null, quantity_remaining_percent: 80, notes: null, archived_at: null, created_at: timestamp, updated_at: timestamp, product: { id: "40000000-0000-4000-8000-000000000001", brand_name: "Beauty", product_name: "Owned Serum", category: "skincare", subcategory: "face_care", product_type: "serum", catalog_product_id: catalogId, created_by_user_id: "user-a", created_at: timestamp, updated_at: timestamp } };
    const analyses = { create: vi.fn(async (userId, input) => ({ ...input, id: "50000000-0000-4000-8000-000000000001", user_id: userId, created_at: timestamp })), listByUserId: vi.fn(), findById: vi.fn() } as unknown as PurchaseAnalysisRepository;
    const profiles = { findByUserId: vi.fn().mockResolvedValue({ user_id: "user-a", display_name: null, timezone: "Asia/Shanghai", locale: "zh-CN", location_name: null, latitude: null, longitude: null, skin_type: "normal", sensitivity_level: 0, goals: ["brightening"], allergies: [], avoid_ingredients: [], max_am_steps: 4, max_pm_steps: 5, preferences: {}, onboarding_completed_at: null, created_at: timestamp, updated_at: timestamp }), upsertByUserId: vi.fn() } as ProfileRepository;
    const ownedProducts = { listByUserId: vi.fn().mockResolvedValue([owned]) } as unknown as OwnedProductRepository;
    let finishIngredients!: (rows: []) => void;
    const pendingIngredients = new Promise<[]>((resolve) => { finishIngredients = resolve; });
    const knowledge = { findVerifiedProduct: vi.fn().mockResolvedValue(catalog), listVerifiedProductIngredients: vi.fn().mockResolvedValueOnce([]).mockReturnValueOnce(pendingIngredients) } as unknown as KnowledgeRepository;
    const usage = { getRecentProductStats: vi.fn().mockResolvedValue(new Map()) } as unknown as UsageService;
    const service = createPurchaseAnalysisService({ analyses, profiles, ownedProducts, knowledge, usage, now: () => new Date(timestamp) });

    const pending = service.analyze("user-a", { catalog_product_id: catalogId });
    // Usage must start while inventory ingredient evidence is still pending,
    // but no analysis may be saved until both inputs are complete.
    await vi.waitFor(() => expect(usage.getRecentProductStats).toHaveBeenCalled());
    expect(analyses.create).not.toHaveBeenCalled();
    finishIngredients([]);
    const result = await pending;

    expect(knowledge.findVerifiedProduct).toHaveBeenCalledWith(catalogId);
    expect(ownedProducts.listByUserId).toHaveBeenCalledWith("user-a", {});
    expect(result.candidate_product_id).toBe(catalogId);
    expect(result.evidence.alternatives[0].match).toBe("exact_catalog");
    expect(analyses.create).toHaveBeenCalledWith("user-a", expect.objectContaining({ candidate_product_id: catalogId, decision: "do_not_buy" }));
  });

  it("normalizes incomplete historical evidence without changing the stored row", async () => {
    const legacyRow = {
      id: "50000000-0000-4000-8000-000000000002",
      user_id: "user-a",
      candidate_product_id: null,
      candidate_snapshot: { source: "manual", product_name: "Legacy Serum" },
      inventory_snapshot: {},
      goal_snapshot: {},
      duplicate_score: 50,
      gap_score: 50,
      compatibility_score: 50,
      usage_probability_score: 50,
      risk_score: 0,
      final_score: 50,
      decision: "insufficient_data",
      evidence: {},
      unknowns: [],
      reason_codes: [],
      created_at: "2026-08-18 00:00:00",
    };
    const analyses = {
      create: vi.fn(),
      listByUserId: vi.fn().mockResolvedValue([legacyRow]),
      findById: vi.fn(),
    } as unknown as PurchaseAnalysisRepository;
    const service = createPurchaseAnalysisService({
      analyses,
      profiles: {} as ProfileRepository,
      ownedProducts: {} as OwnedProductRepository,
      knowledge: {} as KnowledgeRepository,
      usage: {} as UsageService,
    });

    const [analysis] = await service.list("user-a", { limit: 10 });

    expect(analysis.created_at).toBe("2026-08-18T00:00:00.000Z");
    expect(analysis.evidence).toEqual({
      alternatives: [],
      gap: {
        role: "unknown",
        active_role_count: 0,
        message: "历史分析未记录现有缺口证据。",
      },
      compatibility: { matched_goals: [], avoid_ingredient_matches: [] },
      usage: { recent_usage_count: 0, average_rating: null, high_reaction_count: 0 },
      risks: [],
    });
    expect(analysis.unknowns).toEqual(expect.arrayContaining([
      "历史分析未记录与已有资产的关系。",
      "历史分析未记录现有缺口证据。",
      "历史分析未记录个人匹配证据。",
      "历史分析未记录使用概率证据。",
      "历史分析未记录风险证据。",
    ]));
    expect(legacyRow).toEqual(expect.objectContaining({ evidence: {}, unknowns: [] }));
  });
});
