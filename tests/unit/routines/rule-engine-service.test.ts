import { describe, expect, it, vi } from "vitest";

import type { OwnedProductRepository } from "@/server/repositories/owned-product-repository";
import type { ProfileRepository } from "@/server/repositories/profile-repository";
import type {
  RoutineRepository,
  RoutineWithStepsRow,
} from "@/server/repositories/routine-repository";
import type { SkinCheckinRepository } from "@/server/repositories/skin-checkin-repository";
import type { WeatherRepository } from "@/server/repositories/weather-repository";
import type { UsageService } from "@/server/services/usage-service";
import {
  buildRoutinePlan,
  createRuleEngineService,
} from "@/server/services/rule-engine-service";

const userId = "user-a";
const routineId = "70000000-0000-4000-8000-000000000001";
const ownedId = "71000000-0000-4000-8000-000000000001";
const productId = "72000000-0000-4000-8000-000000000001";
const stepId = "73000000-0000-4000-8000-000000000001";
const checkinId = "74000000-0000-4000-8000-000000000001";
const timestamp = "2026-08-18T08:00:00.000Z";

const product = {
  id: productId,
  brand_name: "Test",
  catalog_product_id: null,
  product_name: "Moisturizer",
  category: "skincare",
  subcategory: "face_care",
  product_type: "moisturizer",
  created_by_user_id: userId,
  created_at: timestamp,
  updated_at: timestamp,
};

const ownedProduct = {
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

const checkin = {
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
    expect(routines.replace).not.toHaveBeenCalled();
  });
});

function profileRepository(): ProfileRepository {
  return {
    findByUserId: vi.fn().mockResolvedValue({
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
    }),
    upsertByUserId: vi.fn(),
  };
}

function checkinRepository(): SkinCheckinRepository {
  return {
    listByUserId: vi.fn(),
    findById: vi.fn(),
    findByDate: vi.fn().mockResolvedValue(checkin),
    upsertByDate: vi.fn(),
    update: vi.fn(),
  };
}

function weatherRepository(): WeatherRepository {
  return {
    findLatestByUserId: vi.fn(),
    findByDate: vi.fn().mockResolvedValue(null),
    upsertByDate: vi.fn(),
  };
}

function ownedProductRepository(): OwnedProductRepository {
  return {
    listByUserId: vi.fn().mockResolvedValue([ownedProduct]),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
  };
}

function routineRepository(existing: RoutineWithStepsRow): RoutineRepository {
  return {
    findByDate: vi.fn().mockResolvedValue(existing),
    findById: vi.fn().mockResolvedValue(existing),
    replace: vi.fn(),
  };
}

function usageService(): UsageService {
  return {
    recordRoutineUsage: vi.fn(),
    listUsageHistory: vi.fn(),
    getRecentProductStats: vi.fn().mockResolvedValue(new Map()),
  };
}
