import { describe, expect, it } from "vitest";

import { buildWeeklySkinSummary } from "@/features/profile/weekly-skin-summary-view-model";
import type { DailyStateConcern, SkinCheckin } from "@/schemas/checkin";
import type { Profile } from "@/schemas/profile";

const profile: Profile = { skin_type: "combination", sensitivity_level: 1, skin_goals: [], long_term_skin_baseline: { usual_oily_areas: ["t_zone"], usual_dry_areas: ["nose_wings"], recurring_tendencies: [] }, preferred_routine_length: { am_steps: 2, pm_steps: 2 }, texture_preferences: [], avoid_ingredients: [], timezone: "Asia/Shanghai", location: { name: null, latitude: null, longitude: null }, onboarding_completed_at: null, updated_at: "2026-09-01T00:00:00.000Z" };
function record(date: string, concerns: DailyStateConcern[]): SkinCheckin { return { id: `00000000-0000-4000-8000-${date.replaceAll("-", "")}`, recorded_date: date, created_at: `${date}T00:00:00.000Z`, dryness_level: 0, oiliness_level: 0, redness_level: 0, sensitivity_level: 0, acne_level: 0, notes: null, daily_state: { version: 2, summary: null, concerns }, known_fields: [], field_provenance: {}, is_legacy: false }; }
function dryness(area: "cheeks" | "nose_wings", severity: "mild" | "moderate", comparison: "usual" | "new" = "usual", duration?: "all_day"): DailyStateConcern { return { kind: "dryness", status: "present", areas: [area], attributes: { severity, baseline_comparison: comparison, duration }, user_wording: [], source: ["conversation"], interaction_origin: "user_raised", area_origin: "user_confirmed" }; }
const oiliness: DailyStateConcern = { kind: "oiliness", status: "present", areas: ["t_zone"], attributes: { severity: "slight", baseline_comparison: "usual" }, user_wording: [], source: ["conversation"], interaction_origin: "user_raised", area_origin: "user_confirmed" };

describe("Weekly Skin Summary", () => {
  it("requires cross-day evidence before calling a concern worsened or improved", () => {
    const result = buildWeeklySkinSummary({ checkins: [record("2026-08-30", [dryness("cheeks", "moderate")]), record("2026-08-25", [oiliness])], profile, recentTrends: [], endDate: "2026-08-30" });
    expect(result.period).toEqual({ start: "2026-08-25", end: "2026-08-30" });
    expect(result.worsened).toEqual([]);
    expect(result.new_or_emerging).toEqual([]);
  });

  it("places clear same-week severity growth in worsened and stable profile evidence in stable", () => {
    const result = buildWeeklySkinSummary({ checkins: [record("2026-09-06", [dryness("cheeks", "moderate", "usual", "all_day"), oiliness]), record("2026-09-05", [dryness("cheeks", "mild"), oiliness])], profile, recentTrends: [], endDate: "2026-09-06" });
    expect(result.worsened).toMatchObject([{ label: "脸颊 · 发干" }]);
    expect(result.stable).toMatchObject([{ label: "T 区 · 出油" }]);
    expect(result.next_week_watch).toHaveLength(1);
  });

  it("keeps a single new user-raised concern emerging and never manufactures Profile facts", () => {
    const result = buildWeeklySkinSummary({ checkins: [record("2026-09-01", [dryness("cheeks", "mild", "new")])], profile, recentTrends: [], endDate: "2026-09-01" });
    expect(result.new_or_emerging).toMatchObject([{ label: "脸颊 · 发干" }]);
    expect(result.stable).toEqual([]);
    expect(result.overall).not.toContain("鼻翼发干");
  });

  it("skips composite concerns whose facts cannot be graded instead of treating them as rank one", () => {
    const unknownBlackheads: DailyStateConcern = { kind: "blackheads", status: "present", areas: ["nose"], attributes: { amount: "few", baseline_comparison: "new" }, user_wording: [], source: ["conversation"], interaction_origin: "user_raised", area_origin: "user_confirmed" };
    const result = buildWeeklySkinSummary({ checkins: [record("2026-09-01", [unknownBlackheads]), record("2026-08-31", [unknownBlackheads])], profile, recentTrends: [], endDate: "2026-09-01" });
    expect(result.worsened).toEqual([]);
    expect(result.improved).toEqual([]);
    expect(result.stable).toEqual([]);
    expect(result.new_or_emerging).toEqual([]);
  });

  it("does not label a 1 → 3 → 1 sequence as stable or continuously worsening", () => {
    const result = buildWeeklySkinSummary({ checkins: [record("2026-09-01", [dryness("cheeks", "mild")]), record("2026-08-31", [dryness("cheeks", "moderate")]), record("2026-08-30", [dryness("cheeks", "mild")])], profile, recentTrends: [], endDate: "2026-09-01" });
    expect(result.worsened).toEqual([]);
    expect(result.improved).toEqual([]);
    expect(result.stable).toEqual([]);
  });
});
