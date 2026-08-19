import { describe, expect, it } from "vitest";

import { profileInputSchema } from "@/schemas/profile";

const validInput = {
  skin_type: "combination",
  sensitivity_level: 2,
  skin_goals: ["hydration", "barrier_support"],
  preferred_routine_length: {
    am_steps: 4,
    pm_steps: 5,
  },
  texture_preferences: ["lightweight", "gel"],
  avoid_ingredients: ["fragrance"],
  timezone: "Asia/Shanghai",
  location: {
    name: "上海",
    latitude: 31.2304,
    longitude: 121.4737,
  },
};

describe("profileInputSchema", () => {
  it("接受合法皮肤档案和边界值", () => {
    const result = profileInputSchema.safeParse({
      ...validInput,
      sensitivity_level: 4,
      preferred_routine_length: { am_steps: 1, pm_steps: 8 },
      location: { name: null, latitude: -90, longitude: 180 },
    });

    expect(result.success).toBe(true);
  });

  it("拒绝越界的敏感程度和步骤数", () => {
    const result = profileInputSchema.safeParse({
      ...validInput,
      sensitivity_level: 5,
      preferred_routine_length: { am_steps: 0, pm_steps: 9 },
    });

    expect(result.success).toBe(false);
  });

  it("拒绝非法坐标以及只填写单个坐标", () => {
    const outOfRange = profileInputSchema.safeParse({
      ...validInput,
      location: { name: "未知", latitude: 91, longitude: 181 },
    });
    const incomplete = profileInputSchema.safeParse({
      ...validInput,
      location: { name: "上海", latitude: 31.2304, longitude: null },
    });

    expect(outOfRange.success).toBe(false);
    expect(incomplete.success).toBe(false);
  });

  it("拒绝非法时区、重复目标和未知字段", () => {
    const result = profileInputSchema.safeParse({
      ...validInput,
      skin_goals: ["hydration", "hydration"],
      timezone: "Mars/Olympus",
      user_id: "another-user",
    });

    expect(result.success).toBe(false);
  });
});
