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
    const knowledge = { findVerifiedProduct: vi.fn().mockResolvedValue(catalog), listVerifiedProductIngredients: vi.fn().mockResolvedValue([]) } as unknown as KnowledgeRepository;
    const usage = { getRecentProductStats: vi.fn().mockResolvedValue(new Map()) } as unknown as UsageService;
    const service = createPurchaseAnalysisService({ analyses, profiles, ownedProducts, knowledge, usage, now: () => new Date(timestamp) });

    const result = await service.analyze("user-a", { catalog_product_id: catalogId });

    expect(knowledge.findVerifiedProduct).toHaveBeenCalledWith(catalogId);
    expect(ownedProducts.listByUserId).toHaveBeenCalledWith("user-a", {});
    expect(result.candidate_product_id).toBe(catalogId);
    expect(result.evidence.alternatives[0].match).toBe("exact_catalog");
    expect(analyses.create).toHaveBeenCalledWith("user-a", expect.objectContaining({ candidate_product_id: catalogId, decision: "do_not_buy" }));
  });
});
