import { describe, expect, it } from "vitest";

import { buildProfileReport } from "@/features/profile/profile-report";
import type { Profile } from "@/schemas/profile";

const profile: Profile = {
  skin_type: "combination",
  sensitivity_level: 2,
  skin_goals: ["oil_control", "barrier_support"],
  long_term_skin_baseline: { usual_oily_areas: [], usual_dry_areas: [], recurring_tendencies: [] },
  preferred_routine_length: { am_steps: 3, pm_steps: 5 },
  texture_preferences: ["lightweight", "gel"],
  avoid_ingredients: ["香精", "酒精"],
  timezone: "Asia/Shanghai",
  location: {
    name: "上海",
    latitude: 31.2304,
    longitude: 121.4737,
  },
  onboarding_completed_at: "2026-08-18T00:00:00.000Z",
  updated_at: "2026-08-19T00:00:00.000Z",
};

describe("buildProfileReport", () => {
  it("derives an overview, care priorities, and preference summary", () => {
    const report = buildProfileReport(profile);

    expect(report.overview).toEqual({
      skinType: "混合性肌肤",
      sensitivity: "轻度敏感",
      goals: ["控油", "屏障维护"],
    });
    expect(report.carePriorities).toContain(
      "分区关注出油与干燥表现，让不同区域保持舒适。",
    );
    expect(report.preferenceSummary).toEqual({
      routine: "早间最多 3 步，晚间最多 5 步",
      textures: "轻薄、啫喱",
      avoidIngredients: "香精、酒精",
    });
  });

  it("returns useful fallback copy for incomplete optional information", () => {
    const report = buildProfileReport({
      ...profile,
      skin_type: null,
      skin_goals: [],
      texture_preferences: [],
      avoid_ingredients: [],
    });

    expect(report.overview.skinType).toBe("肤质待补充");
    expect(report.overview.goals).toEqual([]);
    expect(report.preferenceSummary.textures).toBe("未设置质地偏好");
    expect(report.preferenceSummary.avoidIngredients).toBe(
      "暂无主动填写的避用成分",
    );
  });
});
