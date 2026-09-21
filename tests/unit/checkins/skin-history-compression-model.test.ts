import { describe, expect, it } from "vitest";

import { buildSkinHistoryCompression } from "@/features/check-in/skin-history-compression-model";
import type { DailyStateConcern, SkinCheckin } from "@/schemas/checkin";
import type { Profile } from "@/schemas/profile";

const profile: Profile = { skin_type: "combination", sensitivity_level: 1, skin_goals: [], long_term_skin_baseline: { usual_oily_areas: ["t_zone"], usual_dry_areas: [], recurring_tendencies: [] }, preferred_routine_length: { am_steps: 2, pm_steps: 2 }, texture_preferences: [], avoid_ingredients: [], timezone: "Asia/Shanghai", location: { name: null, latitude: null, longitude: null }, onboarding_completed_at: null, updated_at: "2026-09-08T00:00:00.000Z" };
function record(date: string, concerns: DailyStateConcern[]): SkinCheckin { return { id: `00000000-0000-4000-8000-${date.replaceAll("-", "")}`, recorded_date: date, created_at: `${date}T00:00:00.000Z`, dryness_level: 0, oiliness_level: 0, redness_level: 0, sensitivity_level: 0, acne_level: 0, notes: null, daily_state: { version: 2, summary: null, concerns }, known_fields: [], field_provenance: {}, is_legacy: false }; }
const oil: DailyStateConcern = { kind: "oiliness", status: "present", areas: ["t_zone"], attributes: { severity: "slight", baseline_comparison: "usual" }, user_wording: [], source: ["conversation"], interaction_origin: "user_raised", area_origin: "user_confirmed" };

describe("Skin history compression", () => {
  it("keeps a completed batch active until the next record starts a new batch", () => {
    const result = buildSkinHistoryCompression({ checkins: [record("2026-09-09", [oil]), record("2026-09-08", [oil]), record("2026-09-07", [oil]), record("2026-09-06", [oil]), record("2026-09-05", [oil]), record("2026-09-04", [oil]), record("2026-09-03", [oil]), record("2026-09-02", [oil]), record("2026-09-01", [oil])], profile, recentTrends: [], today: "2026-09-09" });
    expect(result.unsettledDaily.map((item) => item.date)).toEqual(["2026-09-09", "2026-09-08"]);
    expect(result.weeklySummaries.map((item) => item.period)).toEqual([{ start: "2026-09-01", end: "2026-09-07" }]);
    expect(result.monthlySummaries).toEqual([]);
  });

  it.each([
    [1, ["2026-09-01"], []],
    [6, ["2026-09-06", "2026-09-05", "2026-09-04", "2026-09-03", "2026-09-02", "2026-09-01"], []],
    [7, ["2026-09-07", "2026-09-06", "2026-09-05", "2026-09-04", "2026-09-03", "2026-09-02", "2026-09-01"], [{ start: "2026-09-01", end: "2026-09-07" }]],
    [8, ["2026-09-08"], [{ start: "2026-09-01", end: "2026-09-07" }]],
    [14, ["2026-09-14", "2026-09-13", "2026-09-12", "2026-09-11", "2026-09-10", "2026-09-09", "2026-09-08"], [{ start: "2026-09-08", end: "2026-09-14" }]],
    [15, ["2026-09-15"], [{ start: "2026-09-08", end: "2026-09-14" }]],
  ])("selects the expected active window for %i effective records", (count, activeDates, weeklyPeriods) => {
    const checkins = Array.from({ length: count }, (_, index) => record(`2026-09-${String(index + 1).padStart(2, "0")}`, [oil]));
    const result = buildSkinHistoryCompression({ checkins, profile, recentTrends: [], today: "2026-09-15" });

    expect(result.unsettledDaily.map((item) => item.date)).toEqual(activeDates);
    expect(result.weeklySummaries.map((item) => item.period)).toEqual(weeklyPeriods);
  });

  it("uses record count and preserves the latest completed summary across a month boundary", () => {
    const dates = ["2026-08-20", "2026-08-22", "2026-08-24", "2026-08-26", "2026-08-28", "2026-08-30", "2026-09-01"];
    const result = buildSkinHistoryCompression({ checkins: dates.map((date) => record(date, [oil])), profile, recentTrends: [], today: "2026-09-02" });

    expect(result.unsettledDaily.map((item) => item.date)).toEqual([...dates].reverse());
    expect(result.weeklySummaries.map((item) => item.period)).toEqual([{ start: "2026-08-20", end: "2026-09-01" }]);
  });

  it("retains no daily navigation links or hidden-date assumptions in the compressed model", () => {
    const result = buildSkinHistoryCompression({ checkins: [record("2026-09-08", [oil])], profile, recentTrends: [], today: "2026-09-08" });
    expect(result.weeklySummaries).toEqual([]);
    expect(result.monthlySummaries).toEqual([]);
    expect(result.unsettledDaily[0].summary).not.toContain("正常");
  });
});
