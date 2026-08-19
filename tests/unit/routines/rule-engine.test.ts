import { describe, expect, it } from "vitest";

import type { RuleContext } from "@/server/services/rule-engine-service";
import {
  buildRoutinePlan,
  buildRoutineSteps,
} from "@/server/services/rule-engine-service";

const baseContext: RuleContext = {
  routineDate: "2026-08-18",
  period: "am",
  checkin: null,
  weather: null,
  products: [],
  feedbackStats: new Map(),
  maxSteps: 5,
};

describe("routine rule engine", () => {
  it("AM 步骤严格遵循 cleanser → hydration/treatment → moisturizer → sunscreen", () => {
    const steps = buildRoutineSteps({
      ...baseContext,
      products: [
        owned("spf", "sunscreen"),
        owned("cream", "moisturizer"),
        owned("toner", "toner"),
        owned("cleanser", "cleanser"),
      ],
    });

    expect(steps.map((step) => step.role)).toEqual([
      "cleanser",
      "hydration",
      "moisturizer",
      "sunscreen",
    ]);
    expect(steps.map((step) => step.step_order)).toEqual([1, 2, 3, 4]);
  });

  it("PM 步骤严格遵循 remover → cleanser → treatment → moisturizer", () => {
    const plan = buildRoutinePlan({
      ...baseContext,
      period: "pm",
      products: [
        owned("cream", "moisturizer"),
        owned("serum", "serum"),
        owned("cleanser", "cleanser"),
        owned("remover", "makeup_remover"),
        owned("spf", "sunscreen"),
        owned("toner", "toner"),
      ],
    });

    expect(plan.steps.map((step) => step.role)).toEqual([
      "remover",
      "cleanser",
      "treatment",
      "moisturizer",
    ]);
    expect(plan.excludedProducts.filter((item) => item.reason_code === "PERIOD_NOT_APPLICABLE")).toHaveLength(2);
  });

  it("明确过期、已归档和已用完产品不会进入方案并有排除原因", () => {
    const plan = buildRoutinePlan({
      ...baseContext,
      products: [
        owned("expired", "moisturizer", { expires_on: "2026-08-17" }),
        owned("finished", "cleanser", { status: "finished" }),
        owned("archived", "toner", {
          archived_at: "2026-08-18T00:00:00.000Z",
          status: "archived",
        }),
        owned("empty", "serum", { quantity_remaining_percent: 0 }),
        owned("valid", "cleanser"),
      ],
    });

    expect(plan.steps.map((step) => step.owned_product_id)).toEqual(["valid"]);
    expect(plan.excludedProducts.map((item) => item.reason_code)).toEqual([
      "PRODUCT_ARCHIVED",
      "PRODUCT_EMPTY",
      "PRODUCT_EXPIRED",
      "PRODUCT_FINISHED",
    ]);
  });

  it("高敏感状态移除功效步骤并输出 reason_code", () => {
    const plan = buildRoutinePlan({
      ...baseContext,
      checkin: checkin({ sensitivity_level: 4 }),
      products: [
        owned("cleanser", "cleanser"),
        owned("treatment", "treatment"),
        owned("mask", "mask"),
        owned("moisturizer", "moisturizer"),
      ],
    });

    expect(plan.steps.map((step) => step.role)).toEqual(["cleanser", "moisturizer"]);
    expect(plan.excludedProducts.filter(
      (item) => item.reason_code === "HIGH_SENSITIVITY_REDUCE_ACTIVE",
    )).toHaveLength(2);
    expect(plan.steps.find((step) => step.role === "moisturizer")?.reason_code).toBe(
      "HIGH_SENSITIVITY_BASIC_CARE",
    );
  });

  it("同一角色只保留一个产品并记录重复排除", () => {
    const plan = buildRoutinePlan({
      ...baseContext,
      products: [
        owned("plain", "moisturizer"),
        owned("opened", "moisturizer", { opened_at: "2026-08-01" }),
      ],
    });

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].owned_product_id).toBe("opened");
    expect(plan.excludedProducts).toEqual([
      expect.objectContaining({
        owned_product_id: "plain",
        reason_code: "DUPLICATE_ROLE_REMOVED",
      }),
    ]);
  });

  it("步骤上限移除产品并记录排除原因", () => {
    const plan = buildRoutinePlan({
      ...baseContext,
      maxSteps: 2,
      products: [
        owned("cleanser", "cleanser"),
        owned("toner", "toner"),
        owned("cream", "moisturizer"),
        owned("spf", "sunscreen"),
      ],
    });

    expect(plan.steps.map((step) => step.role)).toEqual(["moisturizer", "sunscreen"]);
    expect(plan.excludedProducts.filter((item) => item.reason_code === "STEP_LIMIT_REMOVED")).toHaveLength(2);
  });

  it("早间高 UV 时包含用户已有防晒并输出可解释评分", () => {
    const steps = buildRoutineSteps({
      ...baseContext,
      weather: weather({ uv_index: 8 }),
      products: [owned("cleanser", "cleanser"), owned("spf", "sunscreen")],
    });
    const sunscreen = steps.find((step) => step.role === "sunscreen");

    expect(sunscreen?.owned_product_id).toBe("spf");
    expect(sunscreen?.reason_code).toBe("HIGH_UV_SUNSCREEN_PRIORITY");
    expect(sunscreen?.score_breakdown.weather_fit).toBe(25);
  });

  it("皮肤、天气、反馈和库存优先级分别进入 score_breakdown", () => {
    const steps = buildRoutineSteps({
      ...baseContext,
      checkin: checkin({ dryness_level: 4 }),
      weather: weather({ temperature: 5 }),
      products: [owned("cream", "moisturizer", {
        opened_at: "2026-08-01",
        quantity_remaining_percent: 20,
      })],
      feedbackStats: new Map([["cream", { usageCount: 2, averageRating: 5, highReactionCount: 0 }]]),
    });

    expect(steps[0].score_breakdown).toEqual({
      base: 40,
      skin_fit: 15,
      weather_fit: 8,
      feedback_score: 10,
      inventory_priority: 23,
    });
    expect(steps[0].score).toBe(96);
  });

  it("30 天内 3 次高等级反应会阻止产品进入方案", () => {
    const plan = buildRoutinePlan({
      ...baseContext,
      products: [owned("cream", "moisturizer")],
      feedbackStats: new Map([["cream", { usageCount: 3, averageRating: 2, highReactionCount: 3 }]]),
    });

    expect(plan.steps).toHaveLength(0);
    expect(plan.excludedProducts).toEqual([expect.objectContaining({
      owned_product_id: "cream",
      reason_code: "RECENT_HIGH_REACTION_HARD_BLOCK",
    })]);
  });

  it("单次高反应仅降分，不会永久禁用产品", () => {
    const plan = buildRoutinePlan({
      ...baseContext,
      products: [owned("cream", "moisturizer")],
      feedbackStats: new Map([["cream", { usageCount: 1, averageRating: 2, highReactionCount: 1 }]]),
    });

    expect(plan.steps[0]).toEqual(expect.objectContaining({
      owned_product_id: "cream",
      reason_code: "RECENT_HIGH_REACTION_PENALTY",
    }));
    expect(plan.steps[0].score_breakdown.feedback_score).toBe(-15);
  });

  it("相同输入不受库存查询顺序影响，结果完全一致", () => {
    const products = [
      owned("cleanser", "cleanser"),
      owned("toner", "toner"),
      owned("cream", "moisturizer"),
      owned("spf", "sunscreen"),
    ];
    const first = buildRoutinePlan({ ...baseContext, products });
    const second = buildRoutinePlan({ ...baseContext, products: [...products].reverse() });

    expect(second).toEqual(first);
  });

  it("方案中的每一步都来自传入的用户库存", () => {
    const products = [owned("mine-a", "cleanser"), owned("mine-b", "moisturizer")];
    const steps = buildRoutineSteps({ ...baseContext, products });
    const ownedIds = new Set(products.map((product) => product.id));

    expect(steps.every((step) => ownedIds.has(step.owned_product_id))).toBe(true);
  });

  it("无产品时返回空方案和空排除列表", () => {
    expect(buildRoutinePlan(baseContext)).toEqual({ steps: [], excludedProducts: [] });
  });
});

function owned(
  id: string,
  productType: string,
  override: Record<string, unknown> = {},
) {
  return {
    id,
    user_id: "user-a",
    product_id: `product-${id}`,
    status: "active",
    purchase_date: null,
    opened_at: null,
    expires_on: null,
    quantity_remaining_percent: 80,
    notes: null,
    archived_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    product: {
      id: `product-${id}`,
      brand_name: null,
      product_name: id,
      category: "skincare",
      subcategory: productType === "sunscreen" ? "sun_care" : "face_care",
      product_type: productType,
      created_by_user_id: "user-a",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    },
    ...override,
  } as RuleContext["products"][number];
}

function checkin(override: Record<string, unknown>) {
  return {
    id: "checkin",
    user_id: "user-a",
    dryness_level: 0,
    oiliness_level: 0,
    redness_level: 0,
    sensitivity_level: 0,
    acne_level: 0,
    notes: null,
    recorded_date: "2026-08-18",
    created_at: "2026-08-18T00:00:00.000Z",
    ...override,
  } as RuleContext["checkin"];
}

function weather(override: Record<string, unknown>) {
  return {
    id: "weather",
    user_id: "user-a",
    recorded_date: "2026-08-18",
    temperature: 28,
    humidity: 50,
    uv_index: 2,
    weather_code: "0",
    source: "open_meteo",
    raw_payload: {},
    created_at: "2026-08-18T00:00:00.000Z",
    ...override,
  } as RuleContext["weather"];
}
