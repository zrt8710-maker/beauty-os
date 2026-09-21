import { describe, expect, it } from "vitest";

import type { DailyCareNeeds, DailyCarePriorityCode } from "@/server/domain/daily-care-needs";
import type { ProductDecisionProfile } from "@/server/domain/product-decision";
import { buildRoutinePlan, type RuleContext } from "@/server/services/rule-engine-service";

describe("minimum-sufficient routine", () => {
  it("PM moisturizer covering hydration and barrier_support avoids a hydration step", () => {
    const moisturizer = product("moisturizer", "moisturizer");
    const plan = routine("pm", ["hydration", "barrier_support"], [
      product("cleanser", "cleanser"), moisturizer, product("toner", "toner"),
    ], new Map([[moisturizer.product_id, verifiedProfile(moisturizer.product_id, ["hydration", "barrier_support"])]]));

    expect(roles(plan)).toEqual(["cleanser", "moisturizer"]);
  });

  it("adds a verified hydration product only for uncovered hydration", () => {
    const serum = product("serum", "toner");
    const plan = routine("pm", ["hydration"], [
      product("cleanser", "cleanser"), product("moisturizer", "moisturizer"), serum,
    ], new Map([[serum.product_id, verifiedProfile(serum.product_id, ["hydration"])]]));

    expect(roles(plan)).toEqual(["cleanser", "hydration", "moisturizer"]);
  });

  it("does not add hydration without a residual need, even when it is opened and low", () => {
    const serum = product("serum", "toner", { opened_at: "2026-08-01", quantity_remaining_percent: 10 });
    const spf = product("spf", "sunscreen");
    const plan = routine("am", [], [spf, serum], new Map([[serum.product_id, verifiedProfile(serum.product_id, ["hydration"])]]));

    expect(roles(plan)).toEqual(["sunscreen"]);
  });

  it("AM keeps only sunscreen when there is no care need; cleanser cannot enter", () => {
    const plan = routine("am", [], [
      product("cleanser", "cleanser"), product("toner", "toner"),
      product("moisturizer", "moisturizer"), product("spf", "sunscreen"),
    ]);

    expect(roles(plan)).toEqual(["sunscreen"]);
  });

  it("AM dryness selects a multi-cover moisturizer instead of adding hydration too", () => {
    const moisturizer = product("moisturizer", "moisturizer");
    const serum = product("serum", "toner");
    const plan = routine("am", ["hydration", "barrier_support"], [
      product("spf", "sunscreen"), moisturizer, serum,
    ], new Map([
      [moisturizer.product_id, verifiedProfile(moisturizer.product_id, ["hydration", "barrier_support"])],
      [serum.product_id, verifiedProfile(serum.product_id, ["hydration"])],
    ]));

    expect(roles(plan)).toEqual(["moisturizer", "sunscreen"]);
  });

  it("PM remover and treatment remain abstentions without their explicit directions", () => {
    const plan = routine("pm", [], [
      product("remover", "makeup_remover"), product("treatment", "treatment"),
      product("cleanser", "cleanser"), product("moisturizer", "moisturizer"),
    ]);

    expect(roles(plan)).toEqual(["cleanser", "moisturizer"]);
  });

  it("does not treat fallback product type as verified coverage", () => {
    const plan = routine("pm", ["hydration"], [
      product("cleanser", "cleanser"), product("moisturizer", "moisturizer"), product("toner", "toner"),
    ]);

    expect(roles(plan)).toEqual(["cleanser", "moisturizer"]);
  });

  it("uses maxSteps only as a hard upper bound after minimum selection", () => {
    const serum = product("serum", "toner");
    const products = [product("cleanser", "cleanser"), product("moisturizer", "moisturizer"), serum];
    const profiles = new Map([[serum.product_id, verifiedProfile(serum.product_id, ["hydration"])]]);

    expect(roles(routine("pm", ["hydration"], products, profiles, 3))).toEqual([
      "cleanser", "hydration", "moisturizer",
    ]);
    expect(roles(routine("pm", ["hydration"], products, profiles, 2))).toEqual([
      "cleanser", "moisturizer",
    ]);
  });
});

function routine(period: "am" | "pm", priorities: DailyCarePriorityCode[], products: RuleContext["products"], decisionProfilesByProductId = new Map<string, ProductDecisionProfile>(), maxSteps = 5) {
  return buildRoutinePlan({ routineDate: "2026-09-05", period, checkin: null, weather: null, products, feedbackStats: new Map(), maxSteps, dailyCareNeeds: needs(period, priorities), decisionProfilesByProductId });
}
function roles(plan: ReturnType<typeof buildRoutinePlan>) { return plan.steps.map((step) => step.role); }
function needs(period: "am" | "pm", codes: DailyCarePriorityCode[]): DailyCareNeeds { return { priorities: codes.map((code) => ({ code, level: "high", weight: 80, reasonCodes: [] })), requiredRoles: period === "am" ? ["sunscreen"] : ["cleanser", "moisturizer"], optionalRoles: ["hydration", "treatment"], restrictions: [], reasons: [], unknowns: [] }; }
function product(id: string, productType: string, patch: Record<string, unknown> = {}) { return { id, user_id: "user", product_id: `product-${id}`, status: "active", purchase_date: null, opened_at: null, expires_on: null, quantity_remaining_percent: 80, notes: null, archived_at: null, created_at: "2026-09-05T00:00:00.000Z", updated_at: "2026-09-05T00:00:00.000Z", product: { id: `product-${id}`, brand_name: null, product_name: id, variant_name: null, barcode: null, identity_status: "unknown", category: "skincare", subcategory: "face_care", product_type: productType, catalog_product_id: null, created_by_user_id: "user", created_at: "2026-09-05T00:00:00.000Z", updated_at: "2026-09-05T00:00:00.000Z" }, ...patch } as RuleContext["products"][number]; }
function verifiedProfile(productId: string, capabilities: ProductDecisionProfile["capabilities"][number]["code"][]): ProductDecisionProfile { return { product_id: productId, catalog_product_id: null, primary_role: null, primary_role_source: "product_type_fallback", secondary_roles: [], capabilities: capabilities.map((code) => ({ code, confidence: 90 })), period_eligibility: ["am", "pm"], caution_codes: [], knowledge_status: "verified", confidence: 90 }; }
