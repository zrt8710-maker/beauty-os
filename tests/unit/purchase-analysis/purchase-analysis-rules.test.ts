import { describe, expect, it } from "vitest";

import { purchaseAnalysisCreateSchema } from "@/schemas/purchase-analysis";
import type { PurchaseRuleContext } from "@/server/services/purchase-analysis-service";
import {
  calculatePurchaseAnalysis,
  purchaseDecisionForScore,
} from "@/server/services/purchase-analysis-service";

const catalogId = "10000000-0000-4000-8000-000000000001";

describe("purchase analysis rules", () => {
  it("已有完全相同 catalog 资产时返回 do_not_buy", () => {
    const result = calculatePurchaseAnalysis(context({ inventory: [owned("owned-a", "serum", { catalogProductId: catalogId, remaining: 80 })] }));
    expect(result.decision).toBe("do_not_buy");
    expect(result.duplicate_score).toBe(0);
    expect(result.evidence.alternatives[0].match).toBe("exact_catalog");
    expect(result.reason_codes).toContain("EXACT_CATALOG_ALREADY_OWNED");
  });

  it("没有同角色产品时提高 gap_score", () => {
    const result = calculatePurchaseAnalysis(context({ inventory: [] }));
    expect(result.gap_score).toBe(100);
    expect(result.reason_codes).toContain("REAL_ROLE_GAP");
    expect(result.decision).toBe("consider_buy");
  });

  it("高反应历史降低最终评分和使用概率", () => {
    const inventory = [owned("owned-a", "serum", { catalogProductId: catalogId, remaining: 50 })];
    const baseline = calculatePurchaseAnalysis(context({ inventory }));
    const risky = calculatePurchaseAnalysis(context({ inventory, feedbackStats: new Map([["owned-a", { usageCount: 4, averageRating: 2, highReactionCount: 3 }]]) }));
    expect(risky.risk_score).toBeGreaterThan(baseline.risk_score);
    expect(risky.final_score).toBeLessThan(baseline.final_score);
    expect(risky.reason_codes).toContain("HIGH_REACTION_HISTORY");
  });

  it("普通同角色产品反馈不会传播到整个 role", () => {
    const inventory = [owned("owned-mask", "mask", { remaining: 50 })];
    const result = calculatePurchaseAnalysis(context({
      inventory,
      feedbackStats: new Map([["owned-mask", { usageCount: 4, averageRating: 1, highReactionCount: 4 }]]),
    }));
    expect(result.risk_score).toBe(0);
    expect(result.reason_codes).not.toContain("HIGH_REACTION_HISTORY");
  });

  it("已验证共享成分可以建立高反应关联", () => {
    const inventory = [owned("owned-a", "moisturizer")];
    const result = calculatePurchaseAnalysis(context({
      inventory,
      feedbackStats: new Map([["owned-a", { usageCount: 3, averageRating: 2, highReactionCount: 2 }]]),
      verifiedIngredientNamesByOwnedProduct: new Map([["owned-a", ["NIACINAMIDE"]]]),
    }));
    expect(result.risk_score).toBeGreaterThan(0);
    expect(result.reason_codes).toContain("HIGH_REACTION_HISTORY");
  });

  it("避用成分命中时触发最高风险并降低为 do_not_buy", () => {
    const result = calculatePurchaseAnalysis(context({ candidate: candidate({ ingredients: [{ inciName: "Fragrance", displayName: null, aliases: ["Parfum"], kind: null, confidence: 90 }] }), profile: profile({ avoid_ingredients: ["parfum"] }) }));
    expect(result.risk_score).toBe(100);
    expect(result.compatibility_score).toBe(0);
    expect(result.decision).toBe("do_not_buy");
    expect(result.reason_codes).toContain("AVOID_INGREDIENT_MATCH");
  });

  it("关键数据不足时不伪造确定结论", () => {
    const missingProfile = calculatePurchaseAnalysis(context({ profile: null }));
    const missingIngredients = calculatePurchaseAnalysis(context({ profile: profile({ avoid_ingredients: ["fragrance"] }), candidate: candidate({ ingredients: [] }) }));
    expect(missingProfile.decision).toBe("insufficient_data");
    expect(missingIngredients.decision).toBe("insufficient_data");
  });

  it("59/60/89/90 分严格落在冻结的决策边界", () => {
    expect(purchaseDecisionForScore(59)).toBe("do_not_buy");
    expect(purchaseDecisionForScore(60)).toBe("wait");
    expect(purchaseDecisionForScore(89)).toBe("wait");
    expect(purchaseDecisionForScore(90)).toBe("consider_buy");
  });

  it("低余量同类型库存形成明确 wait 场景", () => {
    const result = calculatePurchaseAnalysis(context({
      inventory: [owned("owned-a", "serum", { remaining: 10 })],
    }));
    expect(result.final_score).toBeGreaterThanOrEqual(60);
    expect(result.final_score).toBeLessThan(90);
    expect(result.decision).toBe("wait");
  });

  it("historical unopened 与 active 不产生购买分数差异", () => {
    const active = calculatePurchaseAnalysis(context({
      inventory: [owned("owned-a", "serum", { remaining: 80, status: "active" })],
    }));
    const legacyUnopened = calculatePurchaseAnalysis(context({
      inventory: [owned("owned-a", "serum", { remaining: 80, status: "unopened" })],
    }));

    expect(legacyUnopened.final_score).toBe(active.final_score);
    expect(legacyUnopened.usage_probability_score).toBe(active.usage_probability_score);
    expect(legacyUnopened.decision).toBe(active.decision);
    expect(legacyUnopened.reason_codes).toEqual(active.reason_codes);
    expect(legacyUnopened.reason_codes).not.toContain("UNUSED_INVENTORY_PRESSURE");
  });

  it("同角色不同功能不被认定为替代品", () => {
    const result = calculatePurchaseAnalysis(context({
      inventory: [owned("owned-mask", "mask")],
    }));
    expect(result.duplicate_score).toBe(100);
    expect(result.gap_score).toBe(100);
    expect(result.reason_codes).toContain("ROLE_FUNCTION_UNKNOWN");
    expect(result.reason_codes).not.toContain("SIMILAR_ROLE_SUBSTITUTE_AVAILABLE");
  });

  it("非护肤产品不因用户护肤目标被扣分", () => {
    const result = calculatePurchaseAnalysis(context({
      candidate: candidate({
        catalogProductId: null,
        category: "makeup",
        productType: "lip_color",
        source: "manual",
        ingredients: [],
      }),
    }));
    expect(result.compatibility_score).toBe(80);
    expect(result.reason_codes).not.toContain("MISSING_GOAL_EVIDENCE");
    expect(result.reason_codes).not.toContain("NO_GOAL_ROLE_MATCH");
  });

  it("无已验证功效证据时只输出 unknown，不推断亮白目标", () => {
    const result = calculatePurchaseAnalysis(context());
    expect(result.evidence.compatibility.matched_goals).toEqual([]);
    expect(result.reason_codes).toContain("MISSING_GOAL_EVIDENCE");
    expect(result.unknowns).toContain("当前知识层没有已验证的产品功效声明，无法判断它是否匹配护肤目标。");
  });

  it("分析输入不接受客户端提交 score、decision 或 evidence", () => {
    expect(() => purchaseAnalysisCreateSchema.parse({
      candidate_snapshot: {
        brand_name: null,
        product_name: "Serum",
        category: "skincare",
        product_type: "serum",
        ingredients: [],
      },
      final_score: 100,
      decision: "consider_buy",
      evidence: {},
    })).toThrow();
  });
});

function context(override: Partial<PurchaseRuleContext> = {}): PurchaseRuleContext { return { candidate: candidate(), profile: profile(), inventory: [], feedbackStats: new Map(), ...override }; }
function candidate(override: Partial<PurchaseRuleContext["candidate"]> = {}): PurchaseRuleContext["candidate"] { return { catalogProductId: catalogId, brandName: "Beauty", productName: "Serum", category: "skincare", productType: "serum", confidence: 95, source: "catalog", ingredients: [{ inciName: "NIACINAMIDE", displayName: "Niacinamide", aliases: [], kind: "active", confidence: 90 }], ...override }; }
function profile(override: Partial<NonNullable<PurchaseRuleContext["profile"]>> = {}): NonNullable<PurchaseRuleContext["profile"]> { return { user_id: "user-a", display_name: null, timezone: "Asia/Shanghai", locale: "zh-CN", location_name: null, latitude: null, longitude: null, skin_type: "combination", sensitivity_level: 1, goals: ["brightening"], allergies: [], avoid_ingredients: [], max_am_steps: 4, max_pm_steps: 5, preferences: {}, onboarding_completed_at: null, created_at: "2026-08-18T00:00:00.000Z", updated_at: "2026-08-18T00:00:00.000Z", ...override }; }
function owned(id: string, productType: string, options: { catalogProductId?: string | null; remaining?: number; status?: "active" | "unopened" } = {}): PurchaseRuleContext["inventory"][number] { return { id, user_id: "user-a", product_id: `product-${id}`, status: options.status ?? "active", purchase_date: null, opened_at: "2026-08-01", expires_on: null, quantity_remaining_percent: options.remaining ?? 80, notes: null, archived_at: null, created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z", product: { id: `product-${id}`, brand_name: "Owned", product_name: id, variant_name: null, barcode: null, identity_status: options.catalogProductId ? "matched" : "unknown", category: "skincare", subcategory: "face_care", product_type: productType, catalog_product_id: options.catalogProductId ?? null, created_by_user_id: "user-a", created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z" } }; }
