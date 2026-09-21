import { describe, expect, it } from "vitest";

import { filterProductsForSafety } from "@/server/domain/product-safety";
import { plannerUsageHistory } from "@/server/services/rule-engine-service";
import { aggregateRecentProductStats } from "@/server/repositories/usage-repository";

const candidate = {
  id: "10000000-0000-4000-8000-000000000001",
  product_id: "20000000-0000-4000-8000-000000000001",
  status: "active",
  archived_at: null,
  expires_on: null,
  quantity_remaining_percent: 80,
  product: { catalog_product_id: null },
};

const safetyInput = (highReactionCount: number) => ({
  products: [candidate],
  routineDate: "2026-09-11",
  feedbackStats: new Map([[candidate.id, { highReactionCount }]]),
  assessIngredients: false,
  avoidIngredients: [],
  ingredientDataByCatalogProductId: new Map(),
});

describe("Usage feedback personalization", () => {
  it("projects three stable positive experiences into the normal Planner candidate context", () => {
    expect(plannerUsageHistory({
      usageCount: 3,
      averageRating: 5,
      positiveCount: 3,
      preferenceIssueTags: [],
      highReactionCount: 0,
      recentRelevantFeedbackSummary: "近几次体验较稳定",
    })).toEqual({
      usageCount: 3,
      averageRating: 5,
      positiveSignals: ["多次体验较稳定"],
      preferenceIssues: [],
      highReactionCount: 0,
      recentRelevantFeedbackSummary: "近几次体验较稳定",
    });
  });

  it("keeps repeated oily-feel feedback as soft candidate context without excluding the product", () => {
    expect(plannerUsageHistory({
      usageCount: 2,
      averageRating: 2,
      positiveCount: 0,
      preferenceIssueTags: ["too_oily"],
      highReactionCount: 0,
      recentRelevantFeedbackSummary: "多次反馈偏油",
    })).toMatchObject({ preferenceIssues: ["too_oily"], highReactionCount: 0 });
    expect(filterProductsForSafety(safetyInput(0)).eligibleProducts).toEqual([candidate]);
  });

  it("hard-blocks three recent high-level reactions before a candidate reaches the Planner", () => {
    const result = filterProductsForSafety(safetyInput(3));
    expect(result.eligibleProducts).toEqual([]);
    expect(result.excludedProducts).toContainEqual(expect.objectContaining({
      ownedProductId: candidate.id,
      reason: "RECENT_HIGH_REACTION_HARD_BLOCK",
    }));
  });

  it("isolates product preference by AM/PM while preserving cross-period reaction safety", () => {
    const rows = [
      { owned_product_id: candidate.id, rating: 2, reaction_level: null, reaction_tags: [], texture_feedback: null, usage: { period: "am" } },
      { owned_product_id: candidate.id, rating: 5, reaction_level: 3, reaction_tags: ["stinging"], texture_feedback: null, usage: { period: "pm" } },
    ];

    expect(aggregateRecentProductStats(rows, "am").get(candidate.id)).toMatchObject({ averageRating: 2, usageCount: 1, highReactionCount: 1 });
    expect(aggregateRecentProductStats(rows, "pm").get(candidate.id)).toMatchObject({ averageRating: 5, usageCount: 1, highReactionCount: 1 });
  });
});
