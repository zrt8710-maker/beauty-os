import { describe, expect, it } from "vitest";

import {
  deriveDailyCareNeeds,
  type DailyCareNeedsInput,
} from "@/server/domain/daily-care-needs";
import {
  resolveProductDecisionProfile,
  type ProductDecisionProduct,
} from "@/server/domain/product-decision";
import type { ProductSafetyContext } from "@/server/domain/product-safety";
import type { RuleContext } from "@/server/services/rule-engine-service";
import {
  buildRoutinePlan,
  buildRoutineSteps,
  materializeValidatedPlannerPlan,
} from "@/server/services/rule-engine-service";
import type { CarePlannerDecision } from "@/server/services/today-care-planner-service";

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
  it("DailyCareNeeds high sensitivity removes treatment without a check-in", () => {
    const plan = buildRoutinePlan({
      ...baseContext,
      dailyCareNeeds: needs({
        profile: profile({ sensitivityLevel: 4 }),
        checkin: null,
      }),
      products: [
        owned("treatment", "treatment"),
        owned("cream", "moisturizer"),
      ],
    });

    expect(plan.steps).toEqual([]);
    expect(plan.excludedProducts).toContainEqual(expect.objectContaining({
      owned_product_id: "treatment",
      reason_code: "HIGH_SENSITIVITY_REDUCE_ACTIVE",
    }));
  });

  it("DailyCareNeeds high dryness raises hydration and moisturizer scores", () => {
    const steps = buildRoutineSteps({
      ...baseContext,
      dailyCareNeeds: needs({
        checkin: dailyCheckin({ drynessLevel: 4 }),
      }),
      products: [owned("toner", "toner"), owned("cream", "moisturizer")],
    });

    expect(steps).toEqual([]);
  });

  it("DailyCareNeeds high morning UV directs sunscreen without a second weather score", () => {
    const steps = buildRoutineSteps({
      ...baseContext,
      dailyCareNeeds: needs({ weather: dailyWeather({ uvIndex: 8 }) }),
      products: [owned("spf", "sunscreen")],
    });

    expect(steps[0]).toEqual(expect.objectContaining({
      reason_code: "BASE_ROUTINE_SELECTED",
      score_breakdown: expect.objectContaining({ weather_fit: 0 }),
    }));
  });

  it("DailyCareNeeds required roles survive the step limit", () => {
    const plan = buildRoutinePlan({
      ...baseContext,
      dailyCareNeeds: needs(),
      maxSteps: 1,
      products: [
        owned("cream", "moisturizer", {
          opened_at: "2026-08-01",
          quantity_remaining_percent: 20,
        }),
        owned("spf", "sunscreen"),
      ],
    });

    expect(plan.steps.map((step) => step.role)).toEqual(["sunscreen"]);
  });

  it("filters an avoid-ingredient match before product scoring", () => {
    const unsafe = catalogOwned("unsafe", "moisturizer", "catalog-unsafe");
    const plan = buildRoutinePlan({
      ...baseContext,
      productSafety: safetyContext({
        avoidIngredients: ["Parfum"],
        ingredientDataByCatalogProductId: new Map([[
          "catalog-unsafe",
          {
            reliable: true,
            ingredients: [{
              inciName: "Fragrance",
              displayName: null,
              aliases: ["Parfum"],
            }],
          },
        ]]),
      }),
      products: [unsafe],
    });

    expect(plan.steps).toEqual([]);
    expect(plan.excludedProducts).toEqual([expect.objectContaining({
      owned_product_id: "unsafe",
      reason_code: "AVOID_INGREDIENT_MATCH",
    })]);
  });

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

    expect(steps.map((step) => step.role)).toEqual(["sunscreen"]);
    expect(steps.map((step) => step.step_order)).toEqual([1]);
  });

  it("PM 基础步骤不因拥有 treatment 而自动加入 treatment", () => {
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
      "cleanser",
      "moisturizer",
    ]);
    expect(plan.excludedProducts.filter((item) => item.reason_code === "PERIOD_NOT_APPLICABLE")).toHaveLength(1);
  });

  it("materializes a validated planner decision without deterministic re-ranking", () => {
    const defaultCleanserId = "11111111-1111-4111-8111-111111111111";
    const openedCleanserId = "22222222-2222-4222-8222-222222222222";
    const creamId = "33333333-3333-4333-8333-333333333333";
    const products = [
      owned(defaultCleanserId, "cleanser"),
      owned(openedCleanserId, "cleanser", { opened_at: "2026-08-01" }),
      owned(creamId, "moisturizer"),
    ];
    const deterministic = buildRoutinePlan({
      ...baseContext,
      period: "pm",
      products,
    });
    const decision: CarePlannerDecision = {
      strategy_summary: "今晚保持基础清洁和保湿。",
      selected_steps: [
        {
          ownedProductId: defaultCleanserId,
          purpose: "cleansing",
          why_today: "今晚需要完成清洁。",
          why_this_product: "该产品有可信的清洁使用依据。",
          evidence_refs: ["cleanser-evidence"],
        },
        {
          ownedProductId: creamId,
          purpose: "basic_moisturization",
          why_today: "今晚需要完成基础保湿。",
          why_this_product: "该产品有可信的保湿收尾依据。",
          evidence_refs: ["moisturizer-evidence"],
        },
      ],
      unresolved_needs: ["额外补水证据不足"],
      strategy: "maintain",
      usedGuidanceIds: [],
      productFitAssessments: {
        selected: [
          {
            ownedProductId: defaultCleanserId,
            relevantSkinSignals: [],
            relevantWeatherSignals: [],
            supportedPurposes: ["cleansing"],
            positiveFitReasons: ["有清洁使用依据"],
            negativeFitReasons: [],
            uncertainty: ["无法证明比另一款更温和"],
            relevantEvidenceRefs: ["cleanser-evidence"],
            fitLevel: "reasonable",
            fitSummary: "可以承担今晚的基础清洁。",
          },
          {
            ownedProductId: creamId,
            relevantSkinSignals: [],
            relevantWeatherSignals: [],
            supportedPurposes: ["basic_moisturization"],
            positiveFitReasons: ["有保湿收尾依据"],
            negativeFitReasons: [],
            uncertainty: [],
            relevantEvidenceRefs: ["moisturizer-evidence"],
            fitLevel: "strong",
            fitSummary: "可以承担今晚的基础保湿。",
          },
        ],
        topAlternatives: [],
      },
    };
    const plannerSelected = materializeValidatedPlannerPlan({
      period: "pm",
      routineDate: baseContext.routineDate,
      decision,
      products,
      feedbackStats: baseContext.feedbackStats,
    });

    expect(deterministic.steps.map((step) => step.owned_product_id)).toEqual([defaultCleanserId, creamId]);
    expect(plannerSelected.steps.map((step) => step.owned_product_id)).toEqual([defaultCleanserId, creamId]);
    expect(plannerSelected.steps.map((step) => step.score)).toEqual([0, 0]);
    expect(plannerSelected.steps[0]?.reason).toContain("今晚需要完成清洁");
    expect(plannerSelected.capabilityGaps).toEqual([]);
    expect(deterministic.excludedProducts).toContainEqual(expect.objectContaining({
      owned_product_id: openedCleanserId,
      reason_code: "DUPLICATE_ROLE_REMOVED",
    }));
    expect(plannerSelected.excludedProducts).toEqual([]);
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

    expect(plan.steps).toEqual([]);
    expect(plan.excludedProducts.map((item) => item.reason_code)).toEqual([
      "PRODUCT_ARCHIVED",
      "PRODUCT_EMPTY",
      "PRODUCT_EXPIRED",
      "PRODUCT_FINISHED",
    ]);
  });

  it("将有资产但已过期的必需角色归为今天不可用", () => {
    const plan = buildRoutinePlan({
      ...baseContext,
      dailyCareNeeds: needs(),
      products: [
        owned("cream", "moisturizer"),
        owned("expired-spf", "sunscreen", { expires_on: "2026-08-17" }),
      ],
    });

    expect(plan.capabilityGaps).toEqual([expect.objectContaining({
      role: "sunscreen",
      reason: "ALL_PRODUCTS_UNAVAILABLE",
      ownedProductIds: ["expired-spf"],
    })]);
  });

  it("高敏感状态移除功效步骤并输出 reason_code", () => {
    const plan = buildRoutinePlan({
      ...baseContext,
      checkin: checkin({
        sensitivity_level: 4,
        known_fields: ["sensitivity_level"],
      }),
      products: [
        owned("cleanser", "cleanser"),
        owned("treatment", "treatment"),
        owned("mask", "mask"),
        owned("moisturizer", "moisturizer"),
      ],
    });

    expect(plan.steps).toEqual([]);
    expect(plan.excludedProducts.filter(
      (item) => item.reason_code === "HIGH_SENSITIVITY_REDUCE_ACTIVE",
    )).toHaveLength(2);
  });

  it("没有明确 treatment direction 时，已验证 treatment role 也不会进入候选", () => {
    const item = owned("verified-treatment", "treatment");
    const plan = buildRoutinePlan({
      ...baseContext,
      period: "pm",
      products: [
        owned("cleanser", "cleanser"),
        item,
        owned("cream", "moisturizer"),
      ],
      decisionProfilesByProductId: new Map([[item.product_id, {
        product_id: item.product_id,
        catalog_product_id: "catalog-verified-treatment",
        primary_role: "treatment",
        primary_role_source: "verified_knowledge",
        secondary_roles: [],
        capabilities: [],
        period_eligibility: ["am", "pm"],
        caution_codes: [],
        knowledge_status: "verified",
        confidence: 95,
      }]]),
    });

    expect(plan.steps.map((step) => step.role)).toEqual([
      "cleanser",
      "moisturizer",
    ]);
  });

  it("canonical acne 高等级不再使 treatment 获得资格或评分", () => {
    const plan = buildRoutinePlan({
      ...baseContext,
      period: "pm",
      checkin: checkin({
        acne_level: 4,
        known_fields: ["acne_level"],
      }),
      products: [
        owned("cleanser", "cleanser"),
        owned("treatment", "treatment"),
        owned("cream", "moisturizer"),
      ],
    });

    expect(plan.steps.map((step) => step.role)).toEqual([
      "cleanser",
      "moisturizer",
    ]);
  });

  it("opened 与低余量不能让没有 treatment direction 的产品进入候选", () => {
    const plan = buildRoutinePlan({
      ...baseContext,
      period: "pm",
      products: [
        owned("cleanser", "cleanser"),
        owned("opened-low-treatment", "treatment", {
          opened_at: "2026-08-01",
          quantity_remaining_percent: 10,
        }),
        owned("cream", "moisturizer"),
      ],
    });

    expect(plan.steps.map((step) => step.role)).toEqual([
      "cleanser",
      "moisturizer",
    ]);
  });

  it("同一角色只保留一个产品并记录重复排除", () => {
    const plan = buildRoutinePlan({
      ...baseContext,
      products: [
        owned("plain", "moisturizer"),
        owned("opened", "moisturizer", { opened_at: "2026-08-01" }),
      ],
    });

    expect(plan.steps).toEqual([]);
    expect(plan.excludedProducts).toEqual([]);
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

    expect(plan.steps.map((step) => step.role)).toEqual(["sunscreen"]);
    expect(plan.excludedProducts.filter((item) => item.reason_code === "STEP_LIMIT_REMOVED")).toHaveLength(0);
  });

  it("早间高 UV 时由 DailyCareNeeds 指向用户已有防晒，不重复写入天气评分", () => {
    const steps = buildRoutineSteps({
      ...baseContext,
      dailyCareNeeds: needs({ weather: dailyWeather({ uvIndex: 8 }) }),
      weather: weather({ uv_index: 8 }),
      products: [owned("cleanser", "cleanser"), owned("spf", "sunscreen")],
    });
    const sunscreen = steps.find((step) => step.role === "sunscreen");

    expect(sunscreen?.owned_product_id).toBe("spf");
    expect(sunscreen?.reason_code).toBe("BASE_ROUTINE_SELECTED");
    expect(sunscreen?.score_breakdown.weather_fit).toBe(0);
  });

  it("高湿度不会直接降低 face oil 的资格或评分", () => {
    const steps = buildRoutineSteps({
      ...baseContext,
      period: "pm",
      weather: weather({ humidity: 80 }),
      products: [owned("oil", "face_oil")],
    });

    expect(steps).toEqual([expect.objectContaining({
      owned_product_id: "oil",
      role: "moisturizer",
      score_breakdown: expect.objectContaining({ weather_fit: 0 }),
    })]);
  });

  it("低温不会把 AM moisturizer 加入最小充分方案", () => {
    const steps = buildRoutineSteps({
      ...baseContext,
      weather: weather({ temperature: 5 }),
      products: [owned("cream", "moisturizer"), owned("spf", "sunscreen")],
    });

    expect(steps.map((step) => step.role)).toEqual(["sunscreen"]);
    expect(steps[0].score_breakdown.weather_fit).toBe(0);
  });

  it("皮肤、反馈和低余量进入 score_breakdown，低温不直接加分", () => {
    const steps = buildRoutineSteps({
      ...baseContext,
      period: "pm",
      checkin: checkin({
        dryness_level: 4,
        known_fields: ["dryness_level"],
      }),
      weather: weather({ temperature: 5 }),
      products: [owned("cream", "moisturizer", {
        quantity_remaining_percent: 20,
      })],
      feedbackStats: new Map([["cream", { usageCount: 2, averageRating: 5, highReactionCount: 0 }]]),
    });

    expect(steps[0].score_breakdown).toEqual({
      base: 40,
      skin_fit: 15,
      weather_fit: 0,
      feedback_score: 10,
      inventory_priority: 15,
    });
    expect(steps[0].score).toBe(80);
  });

  it("开封日期不再改变同一产品的规则评分", () => {
    const unopened = buildRoutineSteps({
      ...baseContext,
      period: "pm",
      products: [owned("cream", "moisturizer", { quantity_remaining_percent: 80 })],
    });
    const opened = buildRoutineSteps({
      ...baseContext,
      period: "pm",
      products: [owned("cream", "moisturizer", { opened_at: "2026-08-01", quantity_remaining_percent: 80 })],
    });

    expect(opened[0]?.score).toBe(unopened[0]?.score);
    expect(opened[0]?.score_breakdown).toEqual(unopened[0]?.score_breakdown);
    expect(opened[0]?.reason).toBe(unopened[0]?.reason);
  });

  it("历史 unopened 状态与 active 不产生推荐差异", () => {
    const active = buildRoutinePlan({
      ...baseContext,
      period: "pm",
      products: [owned("cream", "moisturizer", { status: "active" })],
    });
    const legacyUnopened = buildRoutinePlan({
      ...baseContext,
      period: "pm",
      products: [owned("cream", "moisturizer", { status: "unopened" })],
    });

    expect(legacyUnopened.steps).toEqual(active.steps);
    expect(legacyUnopened.excludedProducts).toEqual(active.excludedProducts);
  });

  it("30 天内 3 次高等级反应会阻止产品进入方案", () => {
    const plan = buildRoutinePlan({
      ...baseContext,
      period: "pm",
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
      period: "pm",
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

  it("无产品时返回空方案并标记必需角色的资产缺口", () => {
    expect(buildRoutinePlan(baseContext)).toEqual({
      steps: [],
      excludedProducts: [],
      decisionFacts: expect.any(Object),
      capabilityGaps: [
        expect.objectContaining({
          role: "moisturizer",
          reason: "NO_OWNED_PRODUCT",
        }),
        expect.objectContaining({
          role: "sunscreen",
          reason: "NO_OWNED_PRODUCT",
        }),
      ],
    });
  });

  it("没有 DailyCareNeeds 时仍保留 check-in 评分，但不保留天气直连评分", () => {
    const steps = buildRoutineSteps({
      ...baseContext,
      period: "pm",
      checkin: checkin({
        dryness_level: 4,
        known_fields: ["dryness_level"],
      }),
      weather: weather({ temperature: 5 }),
      products: [owned("cream", "moisturizer")],
    });

    expect(steps[0].score_breakdown).toMatchObject({
      skin_fit: 15,
      weather_fit: 0,
    });
  });

  it("无 Catalog 产品经过 Resolver 后保持原有方案行为", () => {
    const item = owned("no-catalog", "serum");
    const profile = resolveProductDecisionProfile({
      product: {
        id: item.product.id,
        product_type: item.product.product_type as ProductDecisionProduct["product_type"],
        catalog_product_id: null,
      },
      knowledge: null,
    });
    const legacy = buildRoutinePlan({ ...baseContext, products: [item] });
    const resolved = buildRoutinePlan({
      ...baseContext,
      products: [item],
      decisionProfilesByProductId: new Map([[item.product_id, profile]]),
    });

    expect(resolved).toEqual(legacy);
  });

  it("verified role 同时覆盖 eligibility、scoring 和角色覆盖判断", () => {
    const item = owned("verified-role", "serum");
    const baseline = resolveProductDecisionProfile({
      product: {
        id: item.product.id,
        product_type: item.product.product_type as ProductDecisionProduct["product_type"],
        catalog_product_id: "catalog-verified-role",
      },
      knowledge: null,
    });
    const plan = buildRoutinePlan({
      ...baseContext,
      period: "pm",
      checkin: checkin({
        dryness_level: 4,
        known_fields: ["dryness_level"],
      }),
      products: [item],
      decisionProfilesByProductId: new Map([[item.product_id, {
        ...baseline,
        primary_role: "moisturizer",
        primary_role_source: "verified_knowledge",
        period_eligibility: ["am", "pm"],
        knowledge_status: "verified",
        confidence: 95,
      }]]),
    });

    expect(plan.steps).toEqual([expect.objectContaining({
      owned_product_id: "verified-role",
      role: "moisturizer",
      score_breakdown: expect.objectContaining({ skin_fit: 15 }),
    })]);
    expect(plan.capabilityGaps.some((gap) => gap.role === "moisturizer")).toBe(false);
  });

  it("candidate profile 保持 product_type fallback 的结果", () => {
    const item = owned("candidate-role", "serum");
    const baseline = resolveProductDecisionProfile({
      product: {
        id: item.product.id,
        product_type: item.product.product_type as ProductDecisionProduct["product_type"],
        catalog_product_id: "catalog-candidate-role",
      },
      knowledge: null,
    });
    const legacy = buildRoutinePlan({ ...baseContext, products: [item] });
    const resolved = buildRoutinePlan({
      ...baseContext,
      products: [item],
      decisionProfilesByProductId: new Map([[item.product_id, {
        ...baseline,
        knowledge_status: "candidate",
      }]]),
    });

    expect(resolved).toEqual(legacy);
  });

  it("verified capability 匹配 DailyCareNeeds 并产生受限加分", () => {
    const item = owned("capability-fit", "moisturizer");
    const baseProfile = resolveProductDecisionProfile({
      product: {
        id: item.product.id,
        product_type: "moisturizer",
        catalog_product_id: "catalog-capability-fit",
      },
      knowledge: null,
    });
    const plan = buildRoutinePlan({
      ...baseContext,
      period: "pm",
      dailyCareNeeds: needs({
        checkin: dailyCheckin({ drynessLevel: 4 }),
      }),
      products: [item],
      decisionProfilesByProductId: new Map([[item.product_id, {
        ...baseProfile,
        capabilities: [{ code: "hydration", confidence: 90 }],
        knowledge_status: "verified",
        confidence: 90,
      }]]),
    });

    expect(plan.steps[0].score_breakdown.skin_fit).toBe(30);
    expect(plan.steps[0].reason).toContain("已验证产品能力匹配 +15");
  });

  it("candidate capability 不影响 DailyCareNeeds 评分", () => {
    const item = owned("candidate-capability", "moisturizer");
    const baseProfile = resolveProductDecisionProfile({
      product: {
        id: item.product.id,
        product_type: "moisturizer",
        catalog_product_id: "catalog-candidate-capability",
      },
      knowledge: null,
    });
    const plan = buildRoutinePlan({
      ...baseContext,
      period: "pm",
      dailyCareNeeds: needs({
        checkin: dailyCheckin({ drynessLevel: 4 }),
      }),
      products: [item],
      decisionProfilesByProductId: new Map([[item.product_id, {
        ...baseProfile,
        capabilities: [{ code: "hydration", confidence: 70 }],
        knowledge_status: "candidate",
      }]]),
    });

    expect(plan.steps[0].score_breakdown.skin_fit).toBe(15);
    expect(plan.steps[0].reason).not.toContain("已验证产品能力匹配");
  });
});

function needs(
  override: Partial<DailyCareNeedsInput> = {},
) {
  return deriveDailyCareNeeds({
    routineDate: "2026-08-18",
    period: "am",
    profile: profile(),
    checkin: dailyCheckin(),
    weather: dailyWeather(),
    history: {
      recentHighReactionCount: 0,
      repeatedDrynessDays: 0,
      repeatedRednessDays: 0,
    },
    ...override,
  });
}

function profile(
  override: Partial<NonNullable<DailyCareNeedsInput["profile"]>> = {},
): NonNullable<DailyCareNeedsInput["profile"]> {
  return {
    skinType: "combination",
    sensitivityLevel: 0,
    goals: [],
    avoidIngredients: [],
    maxSteps: 4,
    ...override,
  };
}

function dailyCheckin(
  override: Partial<NonNullable<DailyCareNeedsInput["checkin"]>> = {},
): NonNullable<DailyCareNeedsInput["checkin"]> {
  return {
    drynessLevel: 0,
    oilinessLevel: 0,
    sensitivityLevel: 0,
    rednessLevel: 0,
    acneLevel: 0,
    ...override,
  };
}

function dailyWeather(
  override: Partial<NonNullable<DailyCareNeedsInput["weather"]>> = {},
): NonNullable<DailyCareNeedsInput["weather"]> {
  return {
    temperature: 28,
    humidity: 50,
    uvIndex: 2,
    ...override,
  };
}

function safetyContext(
  override: Partial<ProductSafetyContext> = {},
): ProductSafetyContext {
  return {
    assessIngredients: true,
    avoidIngredients: [],
    ingredientDataByCatalogProductId: new Map(),
    ...override,
  };
}

function catalogOwned(
  id: string,
  productType: string,
  catalogProductId: string,
) {
  const value = owned(id, productType);
  return {
    ...value,
    product: {
      ...value.product,
      catalog_product_id: catalogProductId,
    },
  };
}

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
      catalog_product_id: null,
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
