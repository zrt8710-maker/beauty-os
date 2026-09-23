import { describe, expect, it, vi } from "vitest";

import { deriveDailyCareNeeds } from "@/server/domain/daily-care-needs";
import { resolveProductDecisionProfile } from "@/server/domain/product-decision";
import type {
  CatalogProductIngredientWithRelationsRow,
  CatalogProductWithSourceRow,
  KnowledgeRepository,
} from "@/server/repositories/knowledge-repository";
import type {
  OwnedProductRepository,
  OwnedProductWithProductRow,
} from "@/server/repositories/owned-product-repository";
import type {
  ProfileRepository,
  ProfileRow,
} from "@/server/repositories/profile-repository";
import type {
  RoutineRepository,
  RoutineWithStepsRow,
} from "@/server/repositories/routine-repository";
import type { SkinCheckinRepository, SkinCheckinRow } from "@/server/repositories/skin-checkin-repository";
import type { WeatherRepository, WeatherRow } from "@/server/repositories/weather-repository";
import type { UsageService } from "@/server/services/usage-service";
import type { ProductDecisionResolverService } from "@/server/services/product-decision-resolver-service";
import type { CarePlannerDecision } from "@/server/services/today-care-planner-service";
import { emptyPlannerProductEvidence } from "@/server/services/planner-product-evidence-service";
import {
  buildRoutinePlan,
  createRuleEngineService,
  type RuleEngineDependencies,
  RoutineRegenerationFailedError,
} from "@/server/services/rule-engine-service";

const userId = "user-a";
const routineId = "70000000-0000-4000-8000-000000000001";
const ownedId = "71000000-0000-4000-8000-000000000001";
const productId = "72000000-0000-4000-8000-000000000001";
const stepId = "73000000-0000-4000-8000-000000000001";
const checkinId = "74000000-0000-4000-8000-000000000001";
const treatmentOwnedId = "71000000-0000-4000-8000-000000000002";
const treatmentProductId = "72000000-0000-4000-8000-000000000002";
const catalogProductId = "75000000-0000-4000-8000-000000000001";
const timestamp = "2026-08-18T08:00:00+00:00";

const product: OwnedProductWithProductRow["product"] = {
  id: productId,
  brand_name: "Test",
  catalog_product_id: null,
  product_name: "Moisturizer",
  variant_name: null,
  barcode: null,
  identity_status: "unknown",
  category: "skincare",
  subcategory: "face_care",
  product_type: "moisturizer",
  created_by_user_id: userId,
  created_at: timestamp,
  updated_at: timestamp,
};

const ownedProduct: OwnedProductWithProductRow = {
  id: ownedId,
  user_id: userId,
  product_id: productId,
  status: "active",
  purchase_date: null,
  opened_at: null,
  expires_on: null,
  quantity_remaining_percent: 80,
  notes: null,
  archived_at: null,
  created_at: timestamp,
  updated_at: timestamp,
  product,
};

const treatmentOwnedProduct = {
  ...ownedProduct,
  id: treatmentOwnedId,
  product_id: treatmentProductId,
  product: {
    ...product,
    id: treatmentProductId,
    product_name: "Treatment",
    product_type: "treatment",
  },
};

const checkin: SkinCheckinRow = {
  id: checkinId,
  user_id: userId,
  dryness_level: 0,
  oiliness_level: 0,
  redness_level: 0,
  sensitivity_level: 0,
  acne_level: 0,
  notes: null,
  recorded_date: "2026-08-18",
  created_at: timestamp,
};

describe("RuleEngineService stability", () => {
  it("overlaps inventory with profile and date-bound reads with the existing-routine lookup", async () => {
    const profiles = profileRepository();
    const profile = await profiles.findByUserId(userId);
    let finishProfile!: (value: ProfileRow | null) => void;
    profiles.findByUserId = vi.fn(() => new Promise<ProfileRow | null>((resolve) => { finishProfile = resolve; }));
    const routines = generatedRoutineRepository([ownedProduct]);
    let finishExisting!: (value: null) => void;
    routines.findByDate = vi.fn(() => new Promise<null>((resolve) => { finishExisting = resolve; }));
    const checkins = checkinRepository();
    const weather = weatherRepository();
    const ownedProducts = ownedProductRepository();
    const service = createRuleEngineService({ profiles, checkins, weather, ownedProducts, routines, usage: usageService(), now: () => new Date(timestamp) });
    const pending = service.generate(userId, { period: "pm" });
    expect(ownedProducts.listByUserId).toHaveBeenCalledTimes(1);
    expect(checkins.findByDate).not.toHaveBeenCalled();
    finishProfile(profile);
    await vi.waitFor(() => expect(routines.findByDate).toHaveBeenCalled());
    expect(checkins.findByDate).toHaveBeenCalledWith(userId, "2026-08-18");
    expect(weather.findByDate).toHaveBeenCalledWith(userId, "2026-08-18");
    expect(routines.replace).not.toHaveBeenCalled();
    finishExisting(null);
    await pending;
    expect(ownedProducts.listByUserId).toHaveBeenCalledTimes(1);
    expect(checkins.findByDate).toHaveBeenCalledTimes(1);
    expect(weather.findByDate).toHaveBeenCalledTimes(1);
  });

  it("persists a valid Planner decision directly with its purpose-level facts", async () => {
    const diagnostics = vi.spyOn(console, "info").mockImplementation(() => {});
    const sunscreen = {
      ...ownedWithType("71000000-0000-4000-8000-000000000009", "sunscreen"),
      opened_at: timestamp,
      product: {
        ...ownedWithType("71000000-0000-4000-8000-000000000009", "sunscreen").product,
        catalog_product_id: catalogProductId,
      },
    };
    const alternativeSunscreen = {
      ...ownedWithType("71000000-0000-4000-8000-000000000008", "sunscreen"),
      product: {
        ...ownedWithType("71000000-0000-4000-8000-000000000008", "sunscreen").product,
        product_name: "Alternative Sunscreen",
        catalog_product_id: catalogProductId,
      },
    };
    const decision: CarePlannerDecision = {
      strategy_summary: "早间保持简洁，并完成防晒。",
      selected_steps: [{
        ownedProductId: sunscreen.id,
        purpose: "sun_protection",
        why_today: "早间需要防晒。",
        why_this_product: "该产品有可信的防晒产品类型依据。",
        evidence_refs: ["source-sunscreen"],
        preference_refs: ["routine_role:am:sunscreen"],
        selection_rationale: {
          candidateIds: [sunscreen.id, alternativeSunscreen.id],
          selectedProductId: sunscreen.id,
          relevantDifferences: [
            "当前这瓶的防晒用途和轻薄质地有更明确的官方说明；Alternative Sunscreen 的资料不完整",
            "至本、芙清缺少产品类型/使用等关键信息",
          ],
          whySelectedToday: "今天需要完成防晒，并更偏向轻薄乳液质地。",
          certainty: "clear",
        },
      }],
      unresolved_needs: ["没有额外护理需要"],
      strategy: "maintain",
      usedGuidanceIds: [],
      productFitAssessments: {
        selected: [{
          ownedProductId: sunscreen.id,
          relevantSkinSignals: [],
          relevantWeatherSignals: ["weather:uv_index"],
          supportedPurposes: ["sun_protection"],
          positiveFitReasons: ["有防晒产品类型依据"],
          negativeFitReasons: [],
          uncertainty: ["未比较肤感偏好"],
          relevantEvidenceRefs: ["source-sunscreen"],
          fitLevel: "strong",
          fitSummary: "适合承担早间防晒。",
        }],
        topAlternatives: [],
      },
      candidateComparisons: [{
        purpose: "sun_protection",
        candidateIds: [sunscreen.id, alternativeSunscreen.id],
        selectedProductIds: [sunscreen.id],
        selectionMode: "single",
        comparisonReason: "两瓶都可承担防晒，今天选择轻薄乳液质地的这一瓶。",
        multipleSelectionReason: null,
        uncertainty: ["没有头对头测试。"],
      }],
    };
    const availableProducts: OwnedProductWithProductRow[] = [sunscreen, alternativeSunscreen];
    const routines = generatedRoutineRepository(availableProducts);
    let currentProfile = profileRow();
    let currentCheckin: typeof checkin | null = checkin;
    let currentTime = timestamp;
    const fallbackResolver: ProductDecisionResolverService = {
      resolve: vi.fn(),
      resolveMany: vi.fn(),
    };
    const planWithTrace = vi.fn().mockResolvedValue({ decision, failureReason: null });
    const narrate = vi.fn().mockResolvedValue({
      entries: [{
        ownedProductId: sunscreen.id,
        reason: "今天需要防晒，这瓶可以完成这一步。",
        comparison_note: "Alternative Sunscreen 也可承担防晒；今天更偏向当前这瓶的轻薄乳液质地。",
        usage: "均匀涂抹于面部。",
      }],
    });
    const service = createRuleEngineService({
      profiles: profileRepositoryDynamic(() => currentProfile),
      checkins: checkinRepositoryDynamic(() => currentCheckin),
      weather: weatherRepository(weatherRow({ uv_index: 8 })),
      ownedProducts: ownedProductRepository(availableProducts),
      routines,
      usage: usageService([{ scope: "routine_role", period: "am", routine_role: "sunscreen", polarity: "prefer" }]),
      plannerEvidence: {
        findByCatalogProductId: vi.fn().mockResolvedValue({
          productType: "sunscreen",
          claims: [
            { text: "广谱防晒", evidenceRefs: ["source-sunscreen"] },
            { text: "不属于本次选择的主张", evidenceRefs: ["other-source"] },
          ],
          usage: { instructions: ["出门前使用"], cautions: ["避开眼周"], evidenceRefs: ["source-sunscreen"] },
          texture: { description: "轻薄乳液质地", evidenceRefs: ["source-sunscreen"] },
          ingredients: [],
          sourceRefs: [{ id: "source-sunscreen", sourceType: "official_brand", title: "产品页" }],
          supportedPurposes: ["sun_protection"],
          evidenceRefs: ["source-sunscreen"],
          usableSkincareEvidence: true,
          provenance: "draft_derived",
          knownFacts: ["productType", "claims", "texture", "usage", "cautions"],
          unknownFields: ["ingredients"],
          limitations: ["ingredients_unknown"],
        }),
      },
      productDecisions: fallbackResolver,
      carePlanner: {
        plan: vi.fn().mockResolvedValue(decision),
        planWithTrace,
      },
      careNarrative: { narrate },
      now: () => new Date(currentTime),
    });

    const result = await service.generate(userId, { period: "am" });

    expect(narrate).toHaveBeenCalledOnce();
    expect(narrate).toHaveBeenCalledWith(expect.objectContaining({
      softPersonalization: { texturePreferences: [], skinGoals: [] },
      steps: [expect.objectContaining({
        ownedProductId: sunscreen.id,
        whyThisProduct: "该产品有防晒产品类型依据",
        relevantSkinContext: [],
        relevantWeatherContext: [{ metric: "紫外线指数", value: 8 }],
        relevantMemoryContext: [],
        relevantRoutineRolePreferences: [{ scope: "routine_role", period: "am", routine_role: "sunscreen", polarity: "prefer" }],
        productFacts: expect.objectContaining({
          productType: "防晒",
          capabilities: ["防晒"],
          claims: ["广谱防晒"],
          texture: ["轻薄乳液质地"],
          usage: ["出门前使用"],
        }),
        selectionRationale: expect.objectContaining({
          relevantDifferences: ["当前这瓶的防晒用途和轻薄质地"],
          whySelectedToday: "今天需要完成防晒；并更偏向轻薄乳液质地",
          validatedComparisonReason: "两瓶都可承担防晒；今天选择轻薄乳液质地的这一瓶",
          comparableProducts: [expect.objectContaining({
            ownedProductId: alternativeSunscreen.id,
            productName: "Test · Alternative Sunscreen",
            productFacts: expect.objectContaining({
              productType: "防晒",
              capabilities: ["防晒"],
              claims: ["广谱防晒"],
              texture: ["轻薄乳液质地"],
            }),
          })],
        }),
      })],
    }));
    expect(JSON.stringify(narrate.mock.calls[0]?.[0])).not.toMatch(/资料不完整|信息更完整|官方信息齐全|信息可追溯|可靠性/u);
    expect(result.decision_snapshot?.planner?.structuredDecision).toEqual(
      expect.objectContaining({ consumerNarrative: expect.objectContaining({ entries: expect.any(Array) }) }),
    );

    expect(result.steps).toEqual([expect.objectContaining({
      owned_product_id: sunscreen.id,
      role: "sunscreen",
      score: 0,
      reason: "早间需要防晒。；该产品有可信的防晒产品类型依据。",
    })]);
    expect(result.decision_snapshot?.planner).toEqual(expect.objectContaining({
      generationSource: "llm",
      strategySummary: decision.strategy_summary,
      structuredDecision: expect.objectContaining({
        selected_steps: expect.arrayContaining(decision.selected_steps.map((step) => expect.objectContaining({
          ...step,
          ...(step.selection_rationale ? { selection_rationale: expect.objectContaining(step.selection_rationale) } : {}),
        }))),
        productFitAssessments: decision.productFitAssessments,
        unresolved_needs: decision.unresolved_needs,
        selectedProductEvidence: [expect.objectContaining({
          ownedProductId: sunscreen.id,
          purpose: "sun_protection",
          productType: "sunscreen",
          relevantClaims: ["广谱防晒"],
          relevantTextureFacts: ["轻薄乳液质地"],
          relevantUsageFacts: ["出门前使用"],
          relevantCautions: ["避开眼周"],
          relevantConsumerIngredients: [],
        })],
      }),
    }));
    expect(result.decision_snapshot?.capabilityGaps).toEqual([]);
    expect(fallbackResolver.resolveMany).not.toHaveBeenCalled();
    expect(planWithTrace).toHaveBeenCalledWith(expect.objectContaining({
      softPersonalization: { texturePreferences: [], skinGoals: [] },
      routineRolePreferences: [{ scope: "routine_role", period: "am", routine_role: "sunscreen", polarity: "prefer", preferenceRef: "routine_role:am:sunscreen" }],
      eligibleProducts: expect.arrayContaining([expect.objectContaining({
        knownFacts: ["productType", "claims", "texture", "usage", "cautions"],
        unknownFields: ["ingredients"],
        limitations: ["ingredients_unknown"],
        supportedPurposes: ["sun_protection"],
      })]),
    }));
    const onReuse = vi.fn();
    const repeated = await service.generate(userId, { period: "am" }, onReuse);
    expect(repeated).toEqual(result);
    expect(onReuse).toHaveBeenCalledWith("reused", expect.any(String));
    expect(planWithTrace).toHaveBeenCalledOnce();
    expect(narrate).toHaveBeenCalledOnce();
    expect(routines.replace).toHaveBeenCalledOnce();
    expect(diagnostics).toHaveBeenCalledWith("[today-care-planner]", expect.objectContaining({ stage: "reuse_decision", action: "reuse" }));

    let forcedGenerationResult: "generated" | "reused" | "retained_after_failure" | "deterministic_fallback" | null = null;
    const forced = await service.generate(
      userId,
      { period: "am", forceRegenerate: true },
      (result) => { forcedGenerationResult = result; },
    );
    expect(forced.id).toBe(result.id);
    expect(forcedGenerationResult).toBe("generated");
    expect(planWithTrace).toHaveBeenCalledTimes(2);
    expect(routines.replace).toHaveBeenCalledTimes(2);
    expect(narrate).toHaveBeenCalledTimes(2);
    expect(diagnostics).toHaveBeenCalledWith("[today-care-planner]", expect.objectContaining({ stage: "reuse_decision", action: "generate", reason_codes: ["EXPLICIT_FORCE_REGENERATION"] }));

    currentCheckin = { ...checkin, dryness_level: 4, known_fields: ["dryness_level"] };
    await service.generate(userId, { period: "am" });
    expect(planWithTrace).toHaveBeenCalledTimes(3);
    expect(routines.replace).toHaveBeenCalledTimes(3);

    currentProfile = { ...currentProfile, preferences: { texture_preferences: ["lightweight"] } };
    await service.generate(userId, { period: "am" });
    expect(planWithTrace).toHaveBeenCalledTimes(4);

    currentProfile = { ...currentProfile, goals: ["hydration"] };
    await service.generate(userId, { period: "am" });
    expect(planWithTrace).toHaveBeenCalledTimes(5);

    // On a new date, identical current inputs may reuse the selection, but it
    // must be persisted as a new daily routine rather than return yesterday's id.
    currentProfile = profileRow();
    currentCheckin = null;
    await service.generate(userId, { period: "am" });
    const previous = await routines.findByDate(userId, "2026-08-18", "am");
    if (!previous) throw new Error("Expected the previous daily routine");
    routines.findByDate = vi.fn(async (_userId, date) => date === "2026-08-18" ? previous : null);
    routines.findLatestBeforeDate = vi.fn().mockResolvedValue(previous);
    routines.replace = vi.fn(async (input) => ({
      ...previous,
      id: "20000000-0000-4000-8000-000000000019",
      routine_date: input.routineDate,
      skin_snapshot: input.skinSnapshot,
      weather_snapshot: input.weatherSnapshot,
      decision_snapshot: input.decisionSnapshot,
      excluded_products: input.excludedProducts,
      steps: previous.steps.map((step, index) => ({ ...step, ...input.steps[index] })),
    }));
    currentTime = "2026-08-19T08:00:00+00:00";
    const plannerCallsBeforeReuse = planWithTrace.mock.calls.length;
    const crossDayResult = vi.fn();
    const today = await service.generate(userId, { period: "am" }, crossDayResult);
    expect(today.routine_date).toBe("2026-08-19");
    expect(today.steps.map((step) => step.owned_product_id)).toEqual(previous.steps.map((step) => step.owned_product_id));
    expect(crossDayResult).toHaveBeenCalledWith("reused", expect.any(String));
    expect(planWithTrace).toHaveBeenCalledTimes(plannerCallsBeforeReuse);
    expect(routines.replace).toHaveBeenCalledWith(expect.objectContaining({ routineDate: "2026-08-19" }));

    availableProducts.push(ownedWithType("71000000-0000-4000-8000-000000000015", "moisturizer"));
    currentTime = "2026-08-20T08:00:00+00:00";
    await service.generate(userId, { period: "am" });
    expect(planWithTrace).toHaveBeenCalledTimes(plannerCallsBeforeReuse + 1);

    vi.mocked(routines.findLatestBeforeDate!).mockClear();
    currentTime = "2026-08-21T08:00:00+00:00";
    await service.generate(userId, { period: "am", forceRegenerate: true });
    expect(routines.findLatestBeforeDate).not.toHaveBeenCalled();
    expect(planWithTrace).toHaveBeenCalledTimes(plannerCallsBeforeReuse + 2);
  });

  it("persists a versioned decision snapshot from the same generation", async () => {
    const sunscreen = ownedWithType("71000000-0000-4000-8000-000000000010", "sunscreen");
    const routines = generatedRoutineRepository([sunscreen]);
    const service = createRuleEngineService({
      profiles: profileRepository(),
      checkins: checkinRepository(),
      weather: weatherRepository(),
      ownedProducts: ownedProductRepository([sunscreen]),
      routines,
      usage: usageService(),
      now: () => new Date(timestamp),
    });

    const result = await service.generate(userId, { period: "am" });

    expect(result.decision_snapshot).toEqual(expect.objectContaining({ version: 1 }));
    expect(result.decision_snapshot?.dailyCareNeeds.requiredRoles).toEqual(["sunscreen"]);
    expect(result.decision_snapshot?.routinePolicy.baselineRoles).toEqual(["sunscreen"]);
    expect(result.decision_snapshot?.selectedSteps).toEqual([expect.objectContaining({
      ownedProductId: sunscreen.id,
      decision: "baseline",
    })]);
    expect(result.decision_snapshot?.abstentions).toEqual(expect.arrayContaining([
      { role: "treatment", code: "NO_TREATMENT_DIRECTION" },
      { role: "cleanser", code: "AM_CLEANSER_ABSTAIN" },
    ]));
    expect(routines.replace).toHaveBeenCalledWith(expect.objectContaining({
      decisionSnapshot: result.decision_snapshot,
    }));
  });

  it("reads a generated routine's saved decision facts after Daily Skin, Profile, and weather change", async () => {
    const sunscreen = ownedWithType("71000000-0000-4000-8000-000000000011", "sunscreen");
    let currentProfile = profileRow();
    let currentCheckin: typeof checkin | null = checkin;
    let currentWeather: WeatherRow | null = null;
    const routines = generatedRoutineRepository([sunscreen]);
    const service = createRuleEngineService({
      profiles: profileRepositoryDynamic(() => currentProfile),
      checkins: checkinRepositoryDynamic(() => currentCheckin),
      weather: weatherRepositoryDynamic(() => currentWeather),
      ownedProducts: ownedProductRepository([sunscreen]),
      routines,
      usage: usageService(),
      now: () => new Date(timestamp),
    });

    const generated = await service.generate(userId, { period: "am" });
    currentProfile = { ...currentProfile, sensitivity_level: 4 };
    currentCheckin = { ...checkin, dryness_level: 4, known_fields: ["dryness_level"] };
    currentWeather = weatherRow({ uv_index: 8 });

    const read = await service.getToday(userId, { period: "am" });

    expect(read?.steps).toEqual(generated.steps);
    expect(read?.decision_snapshot).toEqual(generated.decision_snapshot);
    expect(read?.explanation).toEqual(generated.explanation);
    expect(read?.explanation?.reasons).not.toContainEqual(
      expect.objectContaining({ code: "TODAY_DRYNESS_HIGH" }),
    );
    expect(read?.explanation?.reasons).not.toContainEqual(
      expect.objectContaining({ code: "HIGH_UV_AM" }),
    );
  });

  it("does not fabricate explanation for a legacy routine without a decision snapshot", async () => {
    const plan = buildRoutinePlan({
      routineDate: "2026-08-18", period: "am", checkin, weather: null,
      products: [ownedProduct], feedbackStats: new Map(), maxSteps: 4,
    });
    const routines = routineRepository(routineRow(plan, checkin, [ownedProduct]));
    const checkins = checkinRepository();
    const weather = weatherRepository(weatherRow({ uv_index: 8 }));
    const service = createRuleEngineService({
      profiles: profileRepository({ ...profileRow(), sensitivity_level: 4 }),
      checkins, weather, ownedProducts: ownedProductRepository(), routines,
      usage: usageService(), now: () => new Date(timestamp),
    });

    const result = await service.getToday(userId, { period: "am" });

    expect(result?.decision_snapshot).toBeNull();
    expect(result).not.toHaveProperty("explanation");
    expect(checkins.findByDate).not.toHaveBeenCalled();
    expect(weather.findByDate).not.toHaveBeenCalled();
  });

  it("keeps an eligible saved routine when an explicit regeneration provider attempt fails", async () => {
    const sunscreen = ownedWithType("71000000-0000-4000-8000-000000000012", "sunscreen");
    const routines = generatedRoutineRepository([sunscreen]);
    const planWithTrace = vi.fn().mockResolvedValue({ decision: null, failureReason: "CARE_PLANNER_MALFORMED_OUTPUT" });
    let currentProfile = profileRow();
    const service = createRuleEngineService({
      profiles: profileRepositoryDynamic(() => currentProfile),
      checkins: checkinRepository(), weather: weatherRepository(),
      ownedProducts: ownedProductRepository([sunscreen]), routines,
      usage: usageService(),
      carePlanner: { plan: vi.fn(), planWithTrace },
      now: () => new Date(timestamp),
    });

    const first = await service.generate(userId, { period: "am" });
    // A failed explicit regeneration retains a still-safe asset even when a
    // current Planner preference (here, the step limit) would select anew.
    currentProfile = { ...currentProfile, max_am_steps: 0 };
    let generationResult: "generated" | "reused" | "retained_after_failure" | "deterministic_fallback" | null = null;
    await expect(service.generate(userId, { period: "am", forceRegenerate: true }, (result) => { generationResult = result; })).resolves.toMatchObject({
      id: first.id,
      decision_snapshot: first.decision_snapshot,
    });

    expect(generationResult).toBe("retained_after_failure");

    expect(planWithTrace).toHaveBeenCalledTimes(2);
    expect(routines.replace).toHaveBeenCalledOnce();
    await expect(service.getToday(userId, { period: "am" })).resolves.toMatchObject({
      id: first.id,
      decision_snapshot: first.decision_snapshot,
    });
  });

  it("does not replace an unsafe previous routine when explicit regeneration provider attempt fails", async () => {
    const sunscreen = ownedWithType("71000000-0000-4000-8000-000000000021", "sunscreen");
    const products = [sunscreen];
    const routines = generatedRoutineRepository(products);
    const planWithTrace = vi.fn().mockResolvedValue({ decision: null, failureReason: "CARE_PLANNER_UNAVAILABLE" });
    const service = createRuleEngineService({
      profiles: profileRepository(),
      checkins: checkinRepository(), weather: weatherRepository(),
      ownedProducts: ownedProductRepository(products), routines,
      usage: usageService(),
      carePlanner: { plan: vi.fn(), planWithTrace },
      now: () => new Date(timestamp),
    });

    const previous = await service.generate(userId, { period: "am" });
    products[0] = { ...sunscreen, status: "archived", archived_at: timestamp };

    await expect(service.generate(userId, { period: "am", forceRegenerate: true }))
      .rejects.toBeInstanceOf(RoutineRegenerationFailedError);
    expect(routines.replace).toHaveBeenCalledOnce();
    await expect(service.getToday(userId, { period: "am" })).resolves.toMatchObject({
      id: previous.id,
      steps: previous.steps,
      decision_snapshot: previous.decision_snapshot,
    });
  });

  it("marks first-generation provider failure as deterministic fallback without narration", async () => {
    const sunscreen = ownedWithType("71000000-0000-4000-8000-000000000022", "sunscreen");
    const routines = generatedRoutineRepository([sunscreen]);
    const narrate = vi.fn();
    const service = createRuleEngineService({
      profiles: profileRepository(),
      checkins: checkinRepository(), weather: weatherRepository(),
      ownedProducts: ownedProductRepository([sunscreen]), routines,
      usage: usageService(),
      carePlanner: {
        plan: vi.fn(),
        planWithTrace: vi.fn().mockResolvedValue({ decision: null, failureReason: "CARE_PLANNER_UNAVAILABLE" }),
      },
      careNarrative: { narrate },
      now: () => new Date(timestamp),
    });
    let generationResult: "generated" | "reused" | "retained_after_failure" | "deterministic_fallback" | null = null;

    const result = await service.generate(userId, { period: "am" }, (value) => { generationResult = value; });

    expect(generationResult).toBe("deterministic_fallback");
    expect(result.decision_snapshot?.planner).toMatchObject({
      generationSource: "deterministic_fallback",
      structuredDecision: expect.objectContaining({
        validatorResult: "not_run",
        fallbackReason: "CARE_PLANNER_UNAVAILABLE",
      }),
    });
    expect(narrate).not.toHaveBeenCalled();
    expect(routines.replace).toHaveBeenCalledOnce();
  });

  it("does not reuse a routine whose selected product became ineligible", async () => {
    const sunscreen = ownedWithType("71000000-0000-4000-8000-000000000017", "sunscreen");
    const products = [sunscreen];
    const routines = generatedRoutineRepository(products);
    const service = createRuleEngineService({
      profiles: profileRepository(), checkins: checkinRepository(), weather: weatherRepository(),
      ownedProducts: ownedProductRepository(products), routines, usage: usageService(), now: () => new Date(timestamp),
    });

    await service.generate(userId, { period: "am" });
    products[0] = { ...sunscreen, status: "archived", archived_at: timestamp };
    const refreshed = await service.generate(userId, { period: "am" });

    expect(refreshed.steps).toEqual([]);
    expect(refreshed.excluded_products).toContainEqual(expect.objectContaining({
      owned_product_id: sunscreen.id,
      reason_code: "PRODUCT_ARCHIVED",
    }));
    expect(routines.replace).toHaveBeenCalledTimes(2);
  });

  it("does not reuse a routine when a newly added avoid ingredient makes its product unsafe", async () => {
    const moisturizer = {
      ...ownedWithType("71000000-0000-4000-8000-000000000020", "moisturizer"),
      product: { ...ownedWithType("71000000-0000-4000-8000-000000000020", "moisturizer").product, catalog_product_id: catalogProductId },
    };
    const products = [moisturizer];
    let currentProfile = profileRow();
    const routines = generatedRoutineRepository(products);
    const service = createRuleEngineService({
      profiles: profileRepositoryDynamic(() => currentProfile), checkins: checkinRepository(), weather: weatherRepository(), knowledge: knowledgeRepository(),
      ownedProducts: ownedProductRepository(products), routines, usage: usageService(), now: () => new Date(timestamp),
    });

    await service.generate(userId, { period: "pm" });
    currentProfile = { ...currentProfile, avoid_ingredients: ["Parfum"] };
    const refreshed = await service.generate(userId, { period: "pm" });

    expect(refreshed.steps).toEqual([]);
    expect(refreshed.excluded_products).toContainEqual(expect.objectContaining({
      owned_product_id: moisturizer.id,
      reason_code: "AVOID_INGREDIENT_MATCH",
    }));
    expect(routines.replace).toHaveBeenCalledTimes(2);
  });

  it("reuses before full-inventory planning when only raw weather values move inside one decision bucket", async () => {
    const sunscreen = withCatalog(ownedWithType("71000000-0000-4000-8000-000000000041", "sunscreen"), "75000000-0000-4000-8000-000000000041");
    const moisturizer = withCatalog(ownedWithType("71000000-0000-4000-8000-000000000042", "moisturizer"), "75000000-0000-4000-8000-000000000042");
    const products = [sunscreen, moisturizer];
    let currentWeather = weatherRow({ humidity: 71, uv_index: 8 });
    const knowledge = todayKnowledgeService();
    const planWithTrace = vi.fn().mockResolvedValue({ decision: null, failureReason: "CARE_PLANNER_UNAVAILABLE" });
    const routines = generatedRoutineRepository(products);
    const service = createRuleEngineService({
      profiles: profileRepository(), checkins: checkinRepository(), weather: weatherRepositoryDynamic(() => currentWeather),
      ownedProducts: ownedProductRepository(products), routines, usage: usageService(), todayProductKnowledge: knowledge,
      carePlanner: { plan: vi.fn(), planWithTrace }, now: () => new Date(timestamp),
    });

    await service.generate(userId, { period: "am" });
    currentWeather = weatherRow({ humidity: 73, uv_index: 8 });
    let result: string | null = null;
    let explanation: string | undefined;
    await service.generate(userId, { period: "am" }, (value, message) => { result = value; explanation = message; });

    expect(result).toBe("reused");
    expect(explanation).toContain("环境数值有所变化");
    expect(planWithTrace).toHaveBeenCalledOnce();
    expect(routines.replace).toHaveBeenCalledOnce();
    expect(knowledge.load).toHaveBeenNthCalledWith(1, [sunscreen.product.catalog_product_id, moisturizer.product.catalog_product_id], expect.any(Object));
    expect(knowledge.load).toHaveBeenNthCalledWith(2, [sunscreen.product.catalog_product_id], expect.any(Object));
  });

  it("does not early-reuse when Daily Skin creates an uncovered care need", async () => {
    const sunscreen = withCatalog(ownedWithType("71000000-0000-4000-8000-000000000043", "sunscreen"), "75000000-0000-4000-8000-000000000043");
    let currentCheckin: typeof checkin = checkin;
    const planWithTrace = vi.fn().mockResolvedValue({ decision: null, failureReason: "CARE_PLANNER_UNAVAILABLE" });
    const routines = generatedRoutineRepository([sunscreen]);
    const service = createRuleEngineService({
      profiles: profileRepository(), checkins: checkinRepositoryDynamic(() => currentCheckin), weather: weatherRepository(),
      ownedProducts: ownedProductRepository([sunscreen]), routines, usage: usageService(), todayProductKnowledge: todayKnowledgeService(),
      carePlanner: { plan: vi.fn(), planWithTrace }, now: () => new Date(timestamp),
    });

    await service.generate(userId, { period: "am" });
    currentCheckin = { ...checkin, dryness_level: 4, known_fields: ["dryness_level"] };
    await service.generate(userId, { period: "am" });

    expect(planWithTrace).toHaveBeenCalledTimes(2);
    expect(routines.replace).toHaveBeenCalledTimes(2);
  });

  it("does not early-reuse or shortlist a selected product after its quantity reaches zero", async () => {
    const sunscreen = withCatalog(ownedWithType("71000000-0000-4000-8000-000000000044", "sunscreen"), "75000000-0000-4000-8000-000000000044");
    const products = [sunscreen];
    const plannerInputs: Array<Parameters<NonNullable<RuleEngineDependencies["carePlanner"]>["planWithTrace"]>[0]> = [];
    const planWithTrace = vi.fn().mockImplementation(async (input) => {
      plannerInputs.push(input);
      return { decision: null, failureReason: "CARE_PLANNER_UNAVAILABLE" };
    });
    const routines = generatedRoutineRepository(products);
    const service = createRuleEngineService({
      profiles: profileRepository(), checkins: checkinRepository(), weather: weatherRepository(),
      ownedProducts: ownedProductRepository(products), routines, usage: usageService(), todayProductKnowledge: todayKnowledgeService(),
      carePlanner: { plan: vi.fn(), planWithTrace }, now: () => new Date(timestamp),
    });

    await service.generate(userId, { period: "am" });
    products[0] = { ...sunscreen, quantity_remaining_percent: 0 };
    const refreshed = await service.generate(userId, { period: "am" });

    expect(planWithTrace).toHaveBeenCalledTimes(2);
    expect(plannerInputs[1]?.eligibleProducts).toEqual([]);
    expect(refreshed.steps).toEqual([]);
    expect(refreshed.excluded_products).toContainEqual(expect.objectContaining({
      owned_product_id: sunscreen.id,
      reason_code: "PRODUCT_EMPTY",
    }));
  });

  it("keeps the Planner shortlist bounded with 35 owned products", async () => {
    const products = Array.from({ length: 35 }, (_, index) => {
      const suffix = String(index + 101).padStart(12, "0");
      const type = index % 2 === 0 ? "cleanser" : "moisturizer";
      return withCatalog(
        ownedWithType(`71000000-0000-4000-8000-${suffix}`, type),
        `75000000-0000-4000-8000-${suffix}`,
      );
    });
    const plannerInputs: Array<Parameters<NonNullable<RuleEngineDependencies["carePlanner"]>["planWithTrace"]>[0]> = [];
    const service = createRuleEngineService({
      profiles: profileRepository(), checkins: checkinRepository(), weather: weatherRepository(),
      ownedProducts: ownedProductRepository(products), routines: generatedRoutineRepository(products),
      usage: usageService(), todayProductKnowledge: todayKnowledgeService(),
      carePlanner: {
        plan: vi.fn(),
        planWithTrace: vi.fn().mockImplementation(async (input) => {
          plannerInputs.push(input);
          return { decision: null, failureReason: "CARE_PLANNER_UNAVAILABLE" };
        }),
      },
      now: () => new Date(timestamp),
    });

    await service.generate(userId, { period: "pm" });

    expect(products).toHaveLength(35);
    expect(plannerInputs[0]?.eligibleProducts.length).toBeGreaterThan(0);
    expect(plannerInputs[0]?.eligibleProducts.length).toBeLessThanOrEqual(12);
  });

  it("excludes definitively invalid inventory before the full Product Knowledge batch", async () => {
    const active = withCatalog(ownedWithType("71000000-0000-4000-8000-000000000201", "moisturizer"), "75000000-0000-4000-8000-000000000201");
    const archived = { ...withCatalog(ownedWithType("71000000-0000-4000-8000-000000000202", "moisturizer"), "75000000-0000-4000-8000-000000000202"), status: "archived" as const, archived_at: timestamp };
    const finished = { ...withCatalog(ownedWithType("71000000-0000-4000-8000-000000000203", "moisturizer"), "75000000-0000-4000-8000-000000000203"), status: "finished" as const };
    const discarded = { ...withCatalog(ownedWithType("71000000-0000-4000-8000-000000000204", "moisturizer"), "75000000-0000-4000-8000-000000000204"), status: "discarded" as const };
    const empty = { ...withCatalog(ownedWithType("71000000-0000-4000-8000-000000000205", "moisturizer"), "75000000-0000-4000-8000-000000000205"), quantity_remaining_percent: 0 };
    const expired = { ...withCatalog(ownedWithType("71000000-0000-4000-8000-000000000206", "moisturizer"), "75000000-0000-4000-8000-000000000206"), expires_on: "2026-08-17" };
    const knowledge = todayKnowledgeService();
    const service = createRuleEngineService({
      profiles: profileRepository(), checkins: checkinRepository(), weather: weatherRepository(),
      ownedProducts: ownedProductRepository([active, archived, finished, discarded, empty, expired]),
      routines: generatedRoutineRepository([active, archived, finished, discarded, empty, expired]),
      usage: usageService(), todayProductKnowledge: knowledge,
      carePlanner: { plan: vi.fn(), planWithTrace: vi.fn().mockResolvedValue({ decision: null, failureReason: "CARE_PLANNER_UNAVAILABLE" }) },
      now: () => new Date(timestamp),
    });

    await service.generate(userId, { period: "pm" });

    expect(knowledge.load).toHaveBeenCalledWith([active.product.catalog_product_id], expect.any(Object));
  });

  it("re-evaluates a saved routine when the current profile step limit no longer permits it", async () => {
    const cleanser = ownedWithType("71000000-0000-4000-8000-000000000018", "cleanser");
    const moisturizer = ownedWithType("71000000-0000-4000-8000-000000000019", "moisturizer");
    const products = [cleanser, moisturizer];
    let currentProfile = profileRow();
    const routines = generatedRoutineRepository(products);
    const service = createRuleEngineService({
      profiles: profileRepositoryDynamic(() => currentProfile), checkins: checkinRepository(), weather: weatherRepository(),
      ownedProducts: ownedProductRepository(products), routines, usage: usageService(), now: () => new Date(timestamp),
    });

    const first = await service.generate(userId, { period: "pm" });
    expect(first.steps).toHaveLength(2);
    currentProfile = { ...currentProfile, max_pm_steps: 1 };
    const refreshed = await service.generate(userId, { period: "pm" });

    expect(refreshed.steps).toHaveLength(1);
    expect(routines.replace).toHaveBeenCalledTimes(2);
  });

  it("snapshots verified baseline coverage and treatment abstention for a minimum-sufficient PM routine", async () => {
    const cleanser = ownedWithType("71000000-0000-4000-8000-000000000013", "cleanser");
    const moisturizer = ownedWithType("71000000-0000-4000-8000-000000000014", "moisturizer");
    const hydration = ownedWithType("71000000-0000-4000-8000-000000000015", "toner");
    const treatment = ownedWithType("71000000-0000-4000-8000-000000000016", "treatment");
    const products = [cleanser, moisturizer, hydration, treatment];
    const routines = generatedRoutineRepository(products);
    const service = createRuleEngineService({
      profiles: profileRepository(),
      checkins: checkinRepository({ ...checkin, dryness_level: 4, known_fields: ["dryness_level"] }),
      weather: weatherRepository(),
      productDecisions: verifiedMoisturizerResolver(moisturizer.product_id),
      ownedProducts: ownedProductRepository(products), routines,
      usage: usageService(), now: () => new Date(timestamp),
    });

    const result = await service.generate(userId, { period: "pm" });

    expect(result.steps.map((step) => step.owned_product_id)).toEqual([
      cleanser.id,
      moisturizer.id,
    ]);
    expect(result.decision_snapshot?.routinePolicy.baselineCoverage).toEqual([
      "hydration", "barrier_support",
    ]);
    expect(result.decision_snapshot?.routinePolicy.residualPriorities).toEqual([]);
    expect(result.decision_snapshot?.selectedSteps).toContainEqual(expect.objectContaining({
      ownedProductId: moisturizer.id,
      decision: "baseline",
      coveredPriorities: ["hydration", "barrier_support"],
    }));
    expect(result.decision_snapshot?.abstentions).toEqual(expect.arrayContaining([
      { role: "treatment", code: "NO_TREATMENT_DIRECTION" },
      { role: "remover", code: "PM_REMOVER_ABSTAIN" },
    ]));
  });

  it("keeps the high-UV decision in DailyCareNeeds explanation without product weather points", async () => {
    const sunscreen = {
      ...ownedProduct,
      product: {
        ...product,
        product_type: "sunscreen",
      },
    };
    const routines = generatedRoutineRepository([sunscreen]);
    const service = createRuleEngineService({
      profiles: profileRepository(),
      checkins: checkinRepository(),
      weather: weatherRepository({
        id: "weather",
        user_id: userId,
        recorded_date: "2026-08-18",
        temperature: 30,
        humidity: 75,
        uv_index: 8,
        weather_code: "0",
        source: "open_meteo",
        raw_payload: {},
        created_at: timestamp,
      }),
      ownedProducts: ownedProductRepository([sunscreen]),
      routines,
      usage: usageService(),
      now: () => new Date(timestamp),
    });

    const result = await service.generate(userId, { period: "am" });

    expect(result.explanation?.priorities).toContainEqual(
      expect.objectContaining({ code: "sun_protection" }),
    );
    expect(result.explanation?.reasons).toContainEqual(
      expect.objectContaining({ code: "HIGH_UV_AM", source: "weather" }),
    );
    expect(result.steps).toEqual([expect.objectContaining({
      role: "sunscreen",
      score_breakdown: expect.objectContaining({ weather_fit: 0 }),
    })]);
  });

  it("相同输入命中已有方案，不重写步骤或更新时间", async () => {
    const plan = buildRoutinePlan({
      routineDate: "2026-08-18",
      period: "am",
      checkin,
      weather: null,
      products: [ownedProduct],
      feedbackStats: new Map(),
      maxSteps: 4,
    });
    const existing: RoutineWithStepsRow = {
      id: routineId,
      user_id: userId,
      routine_date: "2026-08-18",
      period: "am",
      skin_snapshot: checkin,
      weather_snapshot: {},
      decision_snapshot: null,
      excluded_products: plan.excludedProducts,
      status: "generated",
      created_at: timestamp,
      updated_at: timestamp,
      steps: plan.steps.map((step) => ({
        ...step,
        id: stepId,
        routine_id: routineId,
        feedback_rating: null,
        feedback_notes: null,
        feedback_at: null,
        created_at: timestamp,
        owned_product: ownedProduct,
      })),
    };
    const routines = routineRepository(existing);
    const service = createRuleEngineService({
      profiles: profileRepository(),
      checkins: checkinRepository(),
      weather: weatherRepository(),
      ownedProducts: ownedProductRepository(),
      routines,
      usage: usageService(),
      now: () => new Date(timestamp),
    });

    const first = await service.generate(userId, { period: "am" });
    const second = await service.generate(userId, { period: "am" });

    expect(second).toEqual(first);
    expect(first.id).toBe(routineId);
    expect(first.created_at).toBe("2026-08-18T08:00:00.000Z");
    expect(routines.replace).toHaveBeenCalledOnce();
  });

  it("resolver failure 时回退 product_type 且不改变输出结构", async () => {
    const plan = buildRoutinePlan({
      routineDate: "2026-08-18",
      period: "am",
      checkin,
      weather: null,
      products: [ownedProduct],
      feedbackStats: new Map(),
      maxSteps: 4,
    });
    const existing = routineRow(plan, checkin, [ownedProduct]);
    const routines = routineRepository(existing);
    const resolveMany = vi.fn().mockRejectedValue(
      new Error("PRODUCT_DECISION_RESOLVER_FAILED"),
    );
    const service = createRuleEngineService({
      profiles: profileRepository(),
      checkins: checkinRepository(),
      weather: weatherRepository(),
      productDecisions: {
        resolve: vi.fn(),
        resolveMany,
      },
      ownedProducts: ownedProductRepository(),
      routines,
      usage: usageService(),
      now: () => new Date(timestamp),
    });

    const result = await service.generate(userId, { period: "am" });

    expect(resolveMany).toHaveBeenCalledOnce();
    expect(result.steps).toEqual([]);
    expect(result).not.toHaveProperty("decisionProfilesByProductId");
    expect(routines.replace).toHaveBeenCalledOnce();
  });

  it("derives needs from a high-sensitivity profile when check-in is missing", async () => {
    const profile = {
      ...profileRow(),
      sensitivity_level: 4,
    };
    const products = [ownedProduct, treatmentOwnedProduct];
    const dailyCareNeeds = deriveDailyCareNeeds({
      routineDate: "2026-08-18",
      period: "am",
      profile: {
        skinType: null,
        sensitivityLevel: 4,
        goals: [],
        avoidIngredients: [],
        maxSteps: 4,
      },
      checkin: null,
      weather: null,
      history: null,
    });
    const plan = buildRoutinePlan({
      routineDate: "2026-08-18",
      period: "am",
      checkin: null,
      weather: null,
      dailyCareNeeds,
      products,
      feedbackStats: new Map(),
      maxSteps: 4,
    });
    const existing = routineRow(plan, {}, products);
    const routines = routineRepository(existing);
    const service = createRuleEngineService({
      profiles: profileRepository(profile),
      checkins: checkinRepository(null),
      weather: weatherRepository(),
      ownedProducts: ownedProductRepository(products),
      routines,
      usage: usageService(),
      now: () => new Date(timestamp),
    });

    const result = await service.generate(userId, { period: "am" });

    expect(result.steps).toEqual([]);
    expect(result.excluded_products).toContainEqual(expect.objectContaining({
      owned_product_id: treatmentOwnedId,
      reason_code: "HIGH_SENSITIVITY_REDUCE_ACTIVE",
    }));
    expect(routines.replace).toHaveBeenCalledOnce();
  });

  it("filters a verified avoid-ingredient match before scoring", async () => {
    const profile = {
      ...profileRow(),
      avoid_ingredients: ["Parfum"],
    };
    const unsafeProduct = {
      ...ownedProduct,
      product: {
        ...ownedProduct.product,
        catalog_product_id: catalogProductId,
      },
    };
    const products = [unsafeProduct];
    const dailyCareNeeds = deriveDailyCareNeeds({
      routineDate: "2026-08-18",
      period: "am",
      profile: {
        skinType: null,
        sensitivityLevel: 0,
        goals: [],
        avoidIngredients: ["Parfum"],
        maxSteps: 4,
      },
      checkin: {
        drynessLevel: 0,
        oilinessLevel: 0,
        sensitivityLevel: 0,
        rednessLevel: 0,
        acneLevel: 0,
      },
      weather: null,
      history: null,
    });
    const plan = buildRoutinePlan({
      routineDate: "2026-08-18",
      period: "am",
      checkin,
      weather: null,
      dailyCareNeeds,
      productSafety: {
        assessIngredients: true,
        avoidIngredients: ["Parfum"],
        ingredientDataByCatalogProductId: new Map([[
          catalogProductId,
          {
            reliable: true,
            ingredients: [{
              inciName: "Fragrance",
              displayName: null,
              aliases: ["Parfum"],
            }],
          },
        ]]),
      },
      products,
      feedbackStats: new Map(),
      maxSteps: 4,
    });
    const existing = routineRow(plan, checkin, products);
    const routines = routineRepository(existing);
    const service = createRuleEngineService({
      profiles: profileRepository(profile),
      checkins: checkinRepository(),
      weather: weatherRepository(),
      knowledge: knowledgeRepository(),
      ownedProducts: ownedProductRepository(products),
      routines,
      usage: usageService(),
      now: () => new Date(timestamp),
    });

    const result = await service.generate(userId, { period: "am" });

    expect(result.steps).toEqual([]);
    expect(result.excluded_products).toEqual([expect.objectContaining({
      owned_product_id: ownedId,
      reason_code: "AVOID_INGREDIENT_MATCH",
    })]);
    expect(routines.replace).toHaveBeenCalledOnce();
  });

  it("uses reliable rich dryness to change the generated Today routine exactly once", async () => {
    const richCheckin = {
      ...checkin,
      known_fields: [],
      field_provenance: {},
      daily_state: {
        version: 2 as const,
        summary: null,
        concerns: [{
          kind: "dryness" as const,
          status: "present" as const,
          areas: ["cheeks" as const],
          attributes: { severity: "marked" as const },
          user_wording: ["脸颊今天明显发干"],
          source: ["conversation" as const],
          interaction_origin: "user_raised" as const,
          area_origin: "user_confirmed" as const,
        }],
      },
    };
    const routines = generatedRoutineRepository([ownedProduct]);
    const service = createRuleEngineService({
      profiles: profileRepository(),
      checkins: checkinRepository(richCheckin),
      weather: weatherRepository(),
      ownedProducts: ownedProductRepository(),
      routines,
      usage: usageService(),
      now: () => new Date(timestamp),
    });

    const result = await service.generate(userId, { period: "am" });

    expect(result.explanation?.priorities.map((item) => item.code)).toEqual([
      "hydration",
      "barrier_support",
    ]);
    expect(result.steps).toEqual([]);
    expect(routines.replace).toHaveBeenCalledOnce();
  });

  it("uses qualifying rich reactive discomfort through the existing treatment restriction", async () => {
    const richCheckin = {
      ...checkin,
      known_fields: [],
      field_provenance: {},
      daily_state: {
        version: 2 as const,
        summary: null,
        concerns: [{
          kind: "stinging" as const,
          status: "present" as const,
          areas: ["cheeks" as const],
          attributes: { severity: "marked" as const },
          user_wording: ["今天脸颊持续刺痛"],
          source: ["conversation" as const],
          interaction_origin: "user_raised" as const,
          area_origin: "user_confirmed" as const,
        }],
      },
    };
    const products = [ownedProduct, treatmentOwnedProduct];
    const routines = generatedRoutineRepository(products);
    const service = createRuleEngineService({
      profiles: profileRepository(),
      checkins: checkinRepository(richCheckin),
      weather: weatherRepository(),
      ownedProducts: ownedProductRepository(products),
      routines,
      usage: usageService(),
      now: () => new Date(timestamp),
    });

    const result = await service.generate(userId, { period: "am" });

    expect(result.explanation?.priorities.map((item) => item.code)).toEqual([
      "barrier_support",
      "soothing",
    ]);
    expect(result.explanation?.restrictions).toEqual([
      expect.objectContaining({ code: "REDUCE_TREATMENT" }),
    ]);
    expect(result.excluded_products).toContainEqual(expect.objectContaining({
      owned_product_id: treatmentOwnedId,
      reason_code: "HIGH_SENSITIVITY_REDUCE_ACTIVE",
    }));
  });

  it("does not retry persistence after a successful first attempt", async () => {
    const routines = generatedRoutineRepository([ownedProduct]);
    const { service, planWithTrace } = persistenceTestService(routines);

    await expect(service.generate(userId, { period: "am" })).resolves.toBeDefined();

    expect(routines.replace).toHaveBeenCalledOnce();
    expect(planWithTrace).toHaveBeenCalledOnce();
  });

  it("retries the same generated payload once after a connect timeout", async () => {
    let current: RoutineWithStepsRow | null = null;
    const replace = vi.fn(async (input: Parameters<RoutineRepository["replace"]>[0]) => {
      if (replace.mock.calls.length === 1) throw persistenceConnectTimeout();
      current = routineRow(
        { steps: input.steps, excludedProducts: input.excludedProducts },
        input.skinSnapshot,
        [ownedProduct],
        input.decisionSnapshot,
        input.weatherSnapshot,
      );
      return current;
    });
    const routines: RoutineRepository = {
      findByDate: vi.fn(async () => current),
      findById: vi.fn(async () => current),
      replace,
    };
    const { service, planWithTrace } = persistenceTestService(routines);

    await expect(service.generate(userId, { period: "am" })).resolves.toBeDefined();

    expect(replace).toHaveBeenCalledTimes(2);
    expect(replace.mock.calls[1]![0]).toEqual(replace.mock.calls[0]![0]);
    expect(planWithTrace).toHaveBeenCalledOnce();
  });

  it("accepts read-back when the timed-out write already committed", async () => {
    let current: RoutineWithStepsRow | null = null;
    const replace = vi.fn(async (input: Parameters<RoutineRepository["replace"]>[0]) => {
      current = routineRow(
        { steps: input.steps, excludedProducts: input.excludedProducts },
        input.skinSnapshot,
        [ownedProduct],
        input.decisionSnapshot,
        input.weatherSnapshot,
      );
      throw persistenceConnectTimeout();
    });
    const routines: RoutineRepository = {
      findByDate: vi.fn(async () => current),
      findById: vi.fn(async () => current),
      replace,
    };
    const { service } = persistenceTestService(routines);

    await expect(service.generate(userId, { period: "am" })).resolves.toMatchObject({ id: routineId });
    expect(replace).toHaveBeenCalledOnce();
  });

  it("does not overwrite a newer routine discovered before retry", async () => {
    const initial = routineRow(
      { steps: [], excludedProducts: [] },
      checkin,
      [ownedProduct],
    );
    let current: RoutineWithStepsRow | null = initial;
    const replace = vi.fn(async () => {
      current = {
        ...initial,
        updated_at: "2026-08-18T08:01:00+00:00",
      };
      throw persistenceConnectTimeout();
    });
    const routines: RoutineRepository = {
      findByDate: vi.fn(async () => current),
      findById: vi.fn(async () => current),
      replace,
    };
    const { service } = persistenceTestService(routines);

    await expect(service.generate(userId, { period: "am" })).resolves.toMatchObject({
      decision_snapshot: null,
    });
    expect(replace).toHaveBeenCalledOnce();
  });

  it("does not retry when read-back cannot confirm the persisted state", async () => {
    const replace = vi.fn().mockRejectedValue(persistenceConnectTimeout());
    const findByDate = vi.fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("ROUTINE_READ_FAILED"));
    const routines: RoutineRepository = {
      findByDate,
      findById: vi.fn().mockResolvedValue(null),
      replace,
    };
    const { service, planWithTrace } = persistenceTestService(routines);

    await expect(service.generate(userId, { period: "am" })).rejects.toThrow("ROUTINE_WRITE_FAILED");
    expect(replace).toHaveBeenCalledOnce();
    expect(findByDate).toHaveBeenCalledTimes(2);
    expect(planWithTrace).toHaveBeenCalledOnce();
  });

  it("stops after a second transport failure when read-back remains unchanged", async () => {
    const replace = vi.fn().mockRejectedValue(persistenceConnectTimeout());
    const routines: RoutineRepository = {
      findByDate: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(null),
      replace,
    };
    const { service, planWithTrace } = persistenceTestService(routines);

    await expect(service.generate(userId, { period: "am" })).rejects.toThrow("ROUTINE_WRITE_FAILED");
    expect(replace).toHaveBeenCalledTimes(2);
    expect(routines.findByDate).toHaveBeenCalledTimes(3);
    expect(planWithTrace).toHaveBeenCalledOnce();
  });

  it("does not retry a non-transport persistence error", async () => {
    const replace = vi.fn(async () => {
      throw new Error("ROUTINE_WRITE_FAILED", {
        cause: { code: "23514", message: "check constraint violated" },
      });
    });
    const routines: RoutineRepository = {
      findByDate: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(null),
      replace,
    };
    const { service } = persistenceTestService(routines);

    await expect(service.generate(userId, { period: "am" })).rejects.toThrow("ROUTINE_WRITE_FAILED");
    expect(replace).toHaveBeenCalledOnce();
  });
});

function profileRow(): ProfileRow {
  return {
    user_id: userId,
    display_name: null,
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    skin_type: null,
    sensitivity_level: 0,
    goals: [],
    allergies: [],
    avoid_ingredients: [],
    max_am_steps: 4,
    max_pm_steps: 5,
    location_name: null,
    latitude: null,
    longitude: null,
    preferences: {},
    onboarding_completed_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function profileRepository(
  row = profileRow(),
): ProfileRepository {
  return {
    findByUserId: vi.fn().mockResolvedValue(row),
    upsertByUserId: vi.fn(),
  };
}

function profileRepositoryDynamic(
  current: () => ProfileRow | null,
): ProfileRepository {
  return {
    findByUserId: vi.fn().mockImplementation(async () => current()),
    upsertByUserId: vi.fn(),
  };
}

function checkinRepository(
  value: typeof checkin | null = checkin,
): SkinCheckinRepository {
  return {
    listByUserId: vi.fn(),
    findById: vi.fn(),
    findByDate: vi.fn().mockResolvedValue(value),
    upsertByDate: vi.fn(),
    update: vi.fn(),
  };
}

function checkinRepositoryDynamic(
  current: () => typeof checkin | null,
): SkinCheckinRepository {
  return {
    listByUserId: vi.fn(),
    findById: vi.fn(),
    findByDate: vi.fn().mockImplementation(async () => current()),
    upsertByDate: vi.fn(),
    update: vi.fn(),
  };
}

function weatherRepository(value: WeatherRow | null = null): WeatherRepository {
  return {
    findLatestByUserId: vi.fn(),
    findByDate: vi.fn().mockResolvedValue(value),
    upsertByDate: vi.fn(),
  };
}

function weatherRepositoryDynamic(
  current: () => WeatherRow | null,
): WeatherRepository {
  return {
    findLatestByUserId: vi.fn(),
    findByDate: vi.fn().mockImplementation(async () => current()),
    upsertByDate: vi.fn(),
  };
}

function weatherRow(override: Partial<WeatherRow> = {}): WeatherRow {
  return {
    id: "76000000-0000-4000-8000-000000000001",
    user_id: userId,
    recorded_date: "2026-08-18",
    temperature: 28,
    humidity: 50,
    uv_index: 2,
    weather_code: "0",
    source: "open_meteo",
    raw_payload: {},
    created_at: timestamp,
    ...override,
  };
}

function ownedWithType(
  id: string,
  productType: OwnedProductWithProductRow["product"]["product_type"],
): OwnedProductWithProductRow {
  return {
    ...ownedProduct,
    id,
    product_id: id.replace("71000000", "72000000"),
    product: {
      ...product,
      id: id.replace("71000000", "72000000"),
      product_name: productType,
      product_type: productType,
    },
  };
}

function verifiedMoisturizerResolver(
  moisturizerProductId: string,
): ProductDecisionResolverService {
  const resolve = vi.fn(async (
    item: Parameters<ProductDecisionResolverService["resolve"]>[0],
  ) => {
    const base = resolveProductDecisionProfile({ product: item, knowledge: null });
    return item.id === moisturizerProductId
      ? {
          ...base,
          primary_role: "moisturizer" as const,
          primary_role_source: "verified_knowledge" as const,
          capabilities: [
            { code: "hydration" as const, confidence: 90 },
            { code: "barrier_support" as const, confidence: 90 },
          ],
          knowledge_status: "verified" as const,
          confidence: 90,
        }
      : base;
  });
  return {
    resolve,
    resolveMany: vi.fn(async (
      items: Parameters<ProductDecisionResolverService["resolveMany"]>[0],
    ) => Promise.all(items.map((item) => resolve(item)))),
  };
}

function knowledgeRepository(): KnowledgeRepository {
  return {
    listVerifiedProducts: vi.fn(),
    findVerifiedProduct: vi.fn().mockResolvedValue({
      id: catalogProductId,
    } as CatalogProductWithSourceRow),
    listVerifiedProductIngredients: vi.fn().mockResolvedValue([{
      ingredient: {
        inci_name: "Fragrance",
        display_name: null,
        aliases: ["Parfum"],
      },
    } as CatalogProductIngredientWithRelationsRow]),
    findVerifiedByBarcode: vi.fn(),
      findVerifiedByIdentity: vi.fn(),
  };
}

function ownedProductRepository(
  products: OwnedProductWithProductRow[] = [ownedProduct],
): OwnedProductRepository {
  return {
    listByUserId: vi.fn().mockResolvedValue(products),
    listByUserIdWithCatalogImage: vi.fn().mockResolvedValue(products),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
  };
}

function routineRow(
  plan: Pick<ReturnType<typeof buildRoutinePlan>, "steps" | "excludedProducts">,
  skinSnapshot: RoutineWithStepsRow["skin_snapshot"],
  products: OwnedProductWithProductRow[],
  decisionSnapshot: RoutineWithStepsRow["decision_snapshot"] = null,
  weatherSnapshot: RoutineWithStepsRow["weather_snapshot"] = {},
): RoutineWithStepsRow {
  return {
    id: routineId,
    user_id: userId,
    routine_date: "2026-08-18",
    period: "am",
    skin_snapshot: skinSnapshot,
    weather_snapshot: weatherSnapshot,
    decision_snapshot: decisionSnapshot,
    excluded_products: plan.excludedProducts,
    status: "generated",
    created_at: timestamp,
    updated_at: timestamp,
    steps: plan.steps.map((step, index) => ({
      ...step,
      id: index === 0
        ? stepId
        : `73000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      routine_id: routineId,
      feedback_rating: null,
      feedback_notes: null,
      feedback_at: null,
      created_at: timestamp,
      owned_product: products.find(
        (item) => item.id === step.owned_product_id,
      )!,
    })),
  };
}

function routineRepository(existing: RoutineWithStepsRow): RoutineRepository {
  let current = existing;
  return {
    findByDate: vi.fn().mockImplementation(async () => current),
    findById: vi.fn().mockImplementation(async () => current),
    replace: vi.fn().mockImplementation(async (
      input: Parameters<RoutineRepository["replace"]>[0],
    ) => {
      current = {
        ...current,
        skin_snapshot: input.skinSnapshot,
        weather_snapshot: input.weatherSnapshot,
        decision_snapshot: input.decisionSnapshot,
        excluded_products: input.excludedProducts,
        steps: input.steps.map((step, index) => ({
          ...step,
          id: current.steps[index]?.id ?? stepId,
          routine_id: current.id,
          feedback_rating: null,
          feedback_notes: null,
          feedback_at: null,
          created_at: timestamp,
          owned_product: current.steps.find(
            (existingStep) => existingStep.owned_product_id === step.owned_product_id,
          )?.owned_product ?? ownedProduct,
        })),
      };
      return current;
    }),
  };
}

function generatedRoutineRepository(
  products: OwnedProductWithProductRow[],
): RoutineRepository {
  let generated: RoutineWithStepsRow | null = null;
  return {
    findByDate: vi.fn().mockImplementation(async () => generated),
    findById: vi.fn().mockImplementation(async () => generated),
    replace: vi.fn().mockImplementation(async (input) => {
      const plan = {
        steps: input.steps,
        excludedProducts: input.excludedProducts,
      };
      generated = routineRow(
        plan,
        input.skinSnapshot,
        products,
        input.decisionSnapshot,
        input.weatherSnapshot,
      );
      return generated;
    }),
  };
}

function withCatalog(product: OwnedProductWithProductRow, catalogId: string): OwnedProductWithProductRow {
  return {
    ...product,
    product: { ...product.product, catalog_product_id: catalogId, identity_status: "matched" },
  };
}

function todayKnowledgeService(): NonNullable<RuleEngineDependencies["todayProductKnowledge"]> {
  return {
    load: vi.fn(async (catalogIds: string[]) => ({
      plannerEvidenceByCatalogId: new Map(catalogIds.map((id) => [id, emptyPlannerProductEvidence()])),
      runtimeKnowledgeByCatalogId: new Map(),
      safetyIngredientsByCatalogId: new Map(),
    })),
  };
}

function persistenceTestService(routines: RoutineRepository) {
  const planWithTrace = vi.fn().mockResolvedValue({
    decision: null,
    failureReason: "CARE_PLANNER_UNAVAILABLE",
  });
  return {
    planWithTrace,
    service: createRuleEngineService({
      profiles: profileRepository(),
      checkins: checkinRepository(),
      weather: weatherRepository(),
      ownedProducts: ownedProductRepository(),
      routines,
      usage: usageService(),
      carePlanner: {
        plan: vi.fn().mockResolvedValue(null),
        planWithTrace,
      },
      now: () => new Date(timestamp),
    }),
  };
}

function persistenceConnectTimeout() {
  return new Error("ROUTINE_WRITE_FAILED", {
    cause: {
      message: "TypeError: fetch failed",
      details: "Caused by: ConnectTimeoutError (UND_ERR_CONNECT_TIMEOUT)",
    },
  });
}

function usageService(routineRolePreferences: Awaited<ReturnType<UsageService["getRoutineRolePreferences"]>> = []): UsageService {
  return {
    recordRoutineUsage: vi.fn(),
    recordFeedbackMessage: vi.fn(),
    listUsageHistory: vi.fn(),
    getRecentProductStats: vi.fn().mockResolvedValue(new Map()),
    getRoutineRolePreferences: vi.fn().mockResolvedValue(routineRolePreferences),
  };
}
