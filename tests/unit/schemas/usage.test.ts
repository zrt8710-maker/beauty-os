import { describe, expect, it } from "vitest";

import { usageRecordInputSchema } from "@/schemas/usage";

const productId = "71000000-0000-4000-8000-000000000001";

describe("usageRecordInputSchema", () => {
  it("接受产品评分与不适反馈", () => {
    expect(usageRecordInputSchema.parse({
      completion_status: "partial",
      overall_rating: 4,
      skin_reaction_level: 1,
      notes: null,
      products: [{
        owned_product_id: productId,
        rating: 5,
        reaction_level: 0,
        reaction_tags: [],
        texture_feedback: "清爽",
        notes: null,
      }],
    }).products).toHaveLength(1);
  });

  it("拒绝重复产品、越界评分和无原因跳过", () => {
    expect(() => usageRecordInputSchema.parse({
      completion_status: "skipped", overall_rating: null, skin_reaction_level: null, notes: null, products: [],
    })).toThrow();
    expect(() => usageRecordInputSchema.parse({
      completion_status: "completed", overall_rating: 6, skin_reaction_level: null, notes: null, products: [],
    })).toThrow();
    const product = { owned_product_id: productId, rating: 4, reaction_level: null, reaction_tags: [], texture_feedback: null, notes: null };
    expect(() => usageRecordInputSchema.parse({
      completion_status: "completed", overall_rating: null, skin_reaction_level: null, notes: null, products: [product, product],
    })).toThrow();
  });
});
