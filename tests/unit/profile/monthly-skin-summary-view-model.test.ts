import { describe, expect, it } from "vitest";

import { buildMonthlySkinSummary } from "@/features/profile/monthly-skin-summary-view-model";
import type { WeeklySkinSummary } from "@/features/profile/weekly-skin-summary-view-model";
import type { Profile } from "@/schemas/profile";
import type { SkinCheckin } from "@/schemas/checkin";

const profile: Profile = { skin_type: "normal", sensitivity_level: 0, skin_goals: [], long_term_skin_baseline: { usual_oily_areas: [], usual_dry_areas: [], recurring_tendencies: [] }, preferred_routine_length: { am_steps: 2, pm_steps: 2 }, texture_preferences: [], avoid_ingredients: [], timezone: "Asia/Shanghai", location: { name: null, latitude: null, longitude: null }, onboarding_completed_at: null, updated_at: "2026-09-01T00:00:00.000Z" };
const week = (start: string): WeeklySkinSummary => ({ period: { start, end: "2026-08-30" }, recorded_count: 7, recorded_dates: [], overall: "", worsened: [], improved: [], stable: [{ key: "oiliness:t_zone", label: "T 区 · 出油", statement: "接近日常状态。" }], new_or_emerging: [], repeated_observations: [], ungraded_observation_count: 0, has_recent_trends: false, next_week_watch: [] });

describe("Monthly Skin Summary", () => {
  it("compresses weekly summaries without creating new daily facts", () => {
    const result = buildMonthlySkinSummary({ month: "2026-08", weeklySummaries: [week("2026-08-17"), { ...week("2026-08-24"), period: { start: "2026-08-24", end: "2026-08-30" } }], profile });
    expect(result.period).toEqual({ start: "2026-08-01", end: "2026-08-31" });
    expect(result.stable_patterns).toMatchObject([{ label: "T 区 · 出油" }]);
    expect(result.overall).toContain("大多接近日常状态");
    expect(result.overall).not.toContain("今天");
  });

  it("keeps a sparse user-confirmed new change as observation, not a monthly trend", () => {
    const checkin: SkinCheckin = { id: "00000000-0000-4000-8000-202608120000", recorded_date: "2026-08-12", created_at: "2026-08-12T00:00:00.000Z", dryness_level: 0, oiliness_level: 0, redness_level: 0, sensitivity_level: 0, acne_level: 0, notes: null, daily_state: { version: 2, summary: null, concerns: [{ kind: "dryness", status: "present", areas: ["cheeks"], attributes: { baseline_comparison: "new" }, user_wording: [], source: ["conversation"], interaction_origin: "user_raised", area_origin: "user_confirmed" }] }, known_fields: [], field_provenance: {}, is_legacy: false };
    const result = buildMonthlySkinSummary({ month: "2026-08", weeklySummaries: [], checkins: [checkin], profile });
    expect(result.emerging_patterns).toMatchObject([{ label: "脸颊 · 发干" }]);
    expect(result.overall).toContain("不足以形成稳定的月度模式");
  });
});
