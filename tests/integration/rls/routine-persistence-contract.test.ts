import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database, Json } from "@/db/database.types";
import { createOwnedProductRepository } from "@/server/repositories/owned-product-repository";
import { createProfileRepository } from "@/server/repositories/profile-repository";
import { createRoutineRepository } from "@/server/repositories/routine-repository";
import { createSkinCheckinRepository } from "@/server/repositories/skin-checkin-repository";
import { createUsageRepository } from "@/server/repositories/usage-repository";
import { createWeatherRepository } from "@/server/repositories/weather-repository";
import {
  buildRoutinePlan,
  createRuleEngineService,
  type RuleContext,
} from "@/server/services/rule-engine-service";
import { createUsageService } from "@/server/services/usage-service";

const environment = {
  url: process.env.SUPABASE_TEST_URL,
  key: process.env.SUPABASE_TEST_PUBLISHABLE_KEY,
  email: process.env.SUPABASE_TEST_USER_A_EMAIL,
  password: process.env.SUPABASE_TEST_USER_A_PASSWORD,
};

const describeLive = Object.values(environment).every(Boolean) ? describe : describe.skip;
const routineDate = isolatedDate();

describeLive("routine persistence contract (linked Supabase)", () => {
  let client!: SupabaseClient<Database>;
  let userId = "";
  let productId = "";
  let ownedProductId = "";

  beforeAll(async () => {
    client = createClient<Database>(environment.url!, environment.key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const session = await client.auth.signInWithPassword({
      email: environment.email!,
      password: environment.password!,
    });
    if (session.error || !session.data.user) throw new Error("Routine contract user could not authenticate.");
    userId = session.data.user.id;

    const product = await client.from("products").insert({
      brand_name: "Routine contract",
      product_name: "Persistence fixture",
      category: "skincare",
      subcategory: "sun_care",
      product_type: "sunscreen",
      created_by_user_id: userId,
    }).select("id").single();
    if (product.error) throw product.error;
    productId = product.data.id;

    const owned = await client.from("user_owned_products").insert({
      user_id: userId,
      product_id: productId,
      status: "active",
      quantity_remaining_percent: 100,
    }).select("id").single();
    if (owned.error) throw owned.error;
    ownedProductId = owned.data.id;
  });

  afterAll(async () => {
    await client.from("routines").delete().eq("routine_date", routineDate);
    await client.from("user_owned_products").delete().eq("id", ownedProductId);
    await client.from("products").delete().eq("id", productId);
    await client.auth.signOut();
  });

  it("Case A: persists an ordinary routine", async () => {
    const plan = buildPlan();
    expect(plan.excludedProducts).toEqual([]);
    expect(plan.steps).toEqual([expect.objectContaining({
      reason_code: "BASE_ROUTINE_SELECTED",
    })]);

    const id = await persist(plan);
    expect(id).toBeTypeOf("string");
    const [routine, steps] = await Promise.all([
      client.from("routines").select("id").eq("id", id).single(),
      client.from("routine_steps").select("reason_code").eq("routine_id", id),
    ]);
    expect(routine.error).toBeNull();
    expect(routine.data?.id).toBe(id);
    expect(steps.error).toBeNull();
    expect(steps.data).toEqual([expect.objectContaining({
      reason_code: "BASE_ROUTINE_SELECTED",
    })]);
  });

  it("Case B: persists AVOID_INGREDIENT_MATCH and returns it after a read", async () => {
    const plan = buildPlan({
      productSafety: {
        assessIngredients: true,
        avoidIngredients: ["Parfum"],
        ingredientDataByCatalogProductId: new Map([["routine-contract-catalog", {
          reliable: true,
          ingredients: [{
            inciName: "Fragrance",
            displayName: null,
            aliases: ["Parfum"],
          }],
        }]]),
      },
      product: { catalog_product_id: "routine-contract-catalog" },
    });
    expect(plan.steps).toEqual([]);
    expect(plan.excludedProducts).toEqual([expect.objectContaining({
      reason_code: "AVOID_INGREDIENT_MATCH",
    })]);

    await persist(plan);
    const stored = await client.from("routines").select("excluded_products").eq("routine_date", routineDate).eq("period", "am").single();
    expect(stored.error).toBeNull();
    expect(stored.data?.excluded_products).toEqual([expect.objectContaining({ reason_code: "AVOID_INGREDIENT_MATCH" })]);
  });

  it("Case C: persists RECENT_HIGH_REACTION_HARD_BLOCK", async () => {
    const plan = buildPlan({
      feedbackStats: new Map([[ownedProductId, {
        usageCount: 3,
        averageRating: 2,
        highReactionCount: 3,
      }]]),
    });
    expect(plan.steps).toEqual([]);
    expect(plan.excludedProducts).toEqual([expect.objectContaining({
      reason_code: "RECENT_HIGH_REACTION_HARD_BLOCK",
    })]);

    await expect(persist(plan)).resolves.toBeTypeOf("string");
    const stored = await client.from("routines").select("excluded_products").eq("routine_date", routineDate).eq("period", "am").single();
    expect(stored.error).toBeNull();
    expect(stored.data?.excluded_products).toEqual([expect.objectContaining({ reason_code: "RECENT_HIGH_REACTION_HARD_BLOCK" })]);
  });

  it("Case D: persists RECENT_HIGH_REACTION_PENALTY as a routine step reason", async () => {
    const plan = buildPlan({
      feedbackStats: new Map([[ownedProductId, {
        usageCount: 1,
        averageRating: 2,
        highReactionCount: 1,
      }]]),
    });
    expect(plan.steps).toEqual([expect.objectContaining({
      reason_code: "RECENT_HIGH_REACTION_PENALTY",
    })]);

    await persist(plan);
    const stored = await client.from("routine_steps").select("reason_code").eq("owned_product_id", ownedProductId).order("created_at", { ascending: false }).limit(1).single();
    expect(stored.error).toBeNull();
    expect(stored.data?.reason_code).toBe("RECENT_HIGH_REACTION_PENALTY");
  });

  function buildPlan(override: {
    feedbackStats?: RuleContext["feedbackStats"];
    productSafety?: RuleContext["productSafety"];
    product?: Partial<RuleContext["products"][number]["product"]>;
  } = {}) {
    const product = {
      id: productId,
      brand_name: "Routine contract",
      product_name: "Persistence fixture",
      category: "skincare",
      subcategory: "sun_care",
      product_type: "sunscreen",
      catalog_product_id: null,
      created_by_user_id: userId,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      ...override.product,
    };
    const owned = {
      id: ownedProductId,
      user_id: userId,
      product_id: productId,
      status: "active",
      purchase_date: null,
      opened_at: null,
      expires_on: null,
      quantity_remaining_percent: 100,
      notes: null,
      archived_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      product,
    } as RuleContext["products"][number];

    return buildRoutinePlan({
      routineDate,
      period: "am",
      checkin: null,
      weather: null,
      products: [owned],
      feedbackStats: override.feedbackStats ?? new Map(),
      maxSteps: 5,
      productSafety: override.productSafety,
    });
  }

  async function persist(plan: ReturnType<typeof buildRoutinePlan>) {
    const result = await client.rpc("replace_daily_routine", {
      p_routine_date: routineDate,
      p_period: "am",
      p_skin_snapshot: {},
      p_weather_snapshot: {},
      p_decision_snapshot: { version: 1 },
      p_excluded_products: plan.excludedProducts as Json[],
      p_steps: plan.steps as Json[],
    });
    if (result.error) throw result.error;
    return result.data;
  }

});

const decisionSnapshotDate = isolatedDate();
const reuseDate = isolatedDate();
const legacyDate = isolatedDate();

describeLive("routine decision snapshot (linked Supabase)", () => {
  let client!: SupabaseClient<Database>;
  let userId = "";
  let productId = "";
  let ownedProductId = "";
  let originalProfile: Database["public"]["Tables"]["profiles"]["Row"] | null = null;

  beforeAll(async () => {
    client = createClient<Database>(environment.url!, environment.key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const session = await client.auth.signInWithPassword({
      email: environment.email!, password: environment.password!,
    });
    if (session.error || !session.data.user) throw new Error("Decision snapshot user could not authenticate.");
    userId = session.data.user.id;
    const profile = await client.from("profiles").select("*").eq("user_id", userId).maybeSingle();
    if (profile.error) throw profile.error;
    originalProfile = profile.data;
    await setProfile({ sensitivity_level: 0, avoid_ingredients: [], max_am_steps: 4 });

    const product = await client.from("products").insert({
      brand_name: "Decision snapshot",
      product_name: "Remote sunscreen fixture",
      category: "skincare",
      subcategory: "sun_care",
      product_type: "sunscreen",
      created_by_user_id: userId,
    }).select("id").single();
    if (product.error) throw product.error;
    productId = product.data.id;
    const owned = await client.from("user_owned_products").insert({
      user_id: userId, product_id: productId, status: "active", quantity_remaining_percent: 100,
    }).select("id").single();
    if (owned.error) throw owned.error;
    ownedProductId = owned.data.id;
  });

  afterAll(async () => {
    await client.from("routines").delete().in("routine_date", [decisionSnapshotDate, reuseDate, legacyDate]);
    await client.from("skin_checkins").delete().in("recorded_date", [decisionSnapshotDate, reuseDate]);
    await client.from("weather_data").delete().in("recorded_date", [decisionSnapshotDate, reuseDate]);
    await client.from("user_owned_products").delete().eq("id", ownedProductId);
    await client.from("products").delete().eq("id", productId);
    if (originalProfile) {
      await client.from("profiles").update({
        timezone: originalProfile.timezone,
        sensitivity_level: originalProfile.sensitivity_level,
        avoid_ingredients: originalProfile.avoid_ingredients,
        max_am_steps: originalProfile.max_am_steps,
      }).eq("user_id", userId);
    } else {
      await client.from("profiles").delete().eq("user_id", userId);
    }
    await client.auth.signOut();
  });

  it("Cases A-D: generates remotely, reads back v1, and keeps saved facts after current inputs change", async () => {
    const service = createService(decisionSnapshotDate);
    await writeCheckin(decisionSnapshotDate, 0);
    await writeWeather(decisionSnapshotDate, 2);

    const generated = await service.generate(userId, { period: "am" });
    const remote = await client.from("routines")
      .select("decision_snapshot,skin_snapshot,weather_snapshot")
      .eq("id", generated.id).single();
    expect(remote.error).toBeNull();
    expect(remote.data?.decision_snapshot).toEqual(generated.decision_snapshot);
    expect(generated.decision_snapshot?.version).toBe(1);

    await writeCheckin(decisionSnapshotDate, 4);
    await setProfile({ sensitivity_level: 4, avoid_ingredients: ["Parfum"], max_am_steps: 1 });
    await writeWeather(decisionSnapshotDate, 8);
    const read = await service.getRoutine(userId, generated.id);

    expect(read.steps).toEqual(generated.steps);
    expect(read.decision_snapshot).toEqual(generated.decision_snapshot);
    expect(read.explanation).toEqual(generated.explanation);
    expect(read.explanation?.reasons).not.toContainEqual(expect.objectContaining({ code: "TODAY_DRYNESS_HIGH" }));
    expect(read.explanation?.reasons).not.toContainEqual(expect.objectContaining({ code: "HIGH_UV_AM" }));
  }, 20_000);

  it("Case E: reads a legacy routine without synthesizing current explanation", async () => {
    const legacy = await client.from("routines").insert({
      user_id: userId,
      routine_date: legacyDate,
      period: "am",
      skin_snapshot: {},
      weather_snapshot: {},
      decision_snapshot: null,
      excluded_products: [],
    }).select("id").single();
    if (legacy.error) throw legacy.error;
    const step = await client.from("routine_steps").insert({
      routine_id: legacy.data.id, owned_product_id: ownedProductId, step_order: 1,
      role: "sunscreen", reason: "Legacy saved step", reason_code: "BASE_ROUTINE_SELECTED",
      score: 50, score_breakdown: { base: 40, skin_fit: 0, weather_fit: 0, feedback_score: 0, inventory_priority: 10 },
    });
    if (step.error) throw step.error;

    const read = await createService(legacyDate).getRoutine(userId, legacy.data.id);
    expect(read.decision_snapshot).toBeNull();
    expect(read.steps).toHaveLength(1);
    expect(read).not.toHaveProperty("explanation");
  });

  it("Case F: replaces a remote routine when only decision facts change", async () => {
    await setProfile({ sensitivity_level: 0, avoid_ingredients: [], max_am_steps: 4 });
    await writeCheckin(reuseDate, 0);
    await writeWeather(reuseDate, 2);
    const service = createService(reuseDate);
    const first = await service.generate(userId, { period: "am" });

    await setProfile({ sensitivity_level: 4, avoid_ingredients: [], max_am_steps: 4 });
    const second = await service.generate(userId, { period: "am" });
    const remote = await client.from("routines").select("decision_snapshot").eq("id", second.id).single();

    expect(second.steps.map(persistedStepFacts)).toEqual(first.steps.map(persistedStepFacts));
    expect(second.decision_snapshot).not.toEqual(first.decision_snapshot);
    expect(remote.error).toBeNull();
    expect(remote.data?.decision_snapshot).toEqual(second.decision_snapshot);
  }, 20_000);

  function persistedStepFacts(step: {
    owned_product_id: string;
    step_order: number;
    role: string;
    reason: string;
    reason_code: string | null;
    score: number;
    score_breakdown: Json;
  }) {
    return {
      owned_product_id: step.owned_product_id,
      step_order: step.step_order,
      role: step.role,
      reason: step.reason,
      reason_code: step.reason_code,
      score: step.score,
      score_breakdown: step.score_breakdown,
    };
  }

  function createService(date: string) {
    const profiles = createProfileRepository(client);
    const checkins = createSkinCheckinRepository(client);
    const weather = createWeatherRepository(client);
    const routines = createRoutineRepository(client);
    return createRuleEngineService({
      profiles, checkins, weather,
      ownedProducts: createOwnedProductRepository(client),
      routines,
      usage: createUsageService(createUsageRepository(client), routines),
      now: () => new Date(`${date}T12:00:00.000Z`),
    });
  }

  async function setProfile(input: { sensitivity_level: number; avoid_ingredients: string[]; max_am_steps: number }) {
    const result = await client.from("profiles").upsert({
      user_id: userId,
      timezone: "Asia/Shanghai",
      ...input,
    }, { onConflict: "user_id" });
    if (result.error) throw result.error;
  }

  async function writeCheckin(date: string, dryness: number) {
    const result = await client.from("skin_checkins").upsert({
      user_id: userId, recorded_date: date,
      dryness_level: dryness, oiliness_level: 0, redness_level: 0,
      sensitivity_level: 0, acne_level: 0, notes: null,
      known_fields: ["dryness_level"], field_provenance: { dryness_level: ["manual"] },
    }, { onConflict: "user_id,recorded_date" });
    if (result.error) throw result.error;
  }

  async function writeWeather(date: string, uvIndex: number) {
    const result = await client.from("weather_data").upsert({
      user_id: userId, recorded_date: date,
      temperature: 28, humidity: 50, uv_index: uvIndex, weather_code: "0",
      source: "decision_snapshot_test", raw_payload: {}, created_at: new Date().toISOString(),
    }, { onConflict: "user_id,recorded_date" });
    if (result.error) throw result.error;
  }
});

function isolatedDate() {
  const offset = Number.parseInt(crypto.randomUUID().replaceAll("-", "").slice(0, 8), 16) % 36_500;
  return new Date(Date.UTC(2100, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10);
}
