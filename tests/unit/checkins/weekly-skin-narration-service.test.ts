import { describe, expect, it, vi } from "vitest";

import { buildWeeklySkinSummary } from "@/features/profile/weekly-skin-summary-view-model";
import { buildWeeklySkinNarrationFacts, createWeeklySkinNarrationService } from "@/server/weekly-skin-summary/weekly-skin-narration-service";
import type { DailyStateConcern, SkinCheckin } from "@/schemas/checkin";
import type { Profile } from "@/schemas/profile";

const profile: Profile = { skin_type: "combination", sensitivity_level: 1, skin_goals: [], long_term_skin_baseline: { usual_oily_areas: ["t_zone"], usual_dry_areas: [], recurring_tendencies: [] }, preferred_routine_length: { am_steps: 2, pm_steps: 2 }, texture_preferences: [], avoid_ingredients: [], timezone: "Asia/Shanghai", location: { name: null, latitude: null, longitude: null }, onboarding_completed_at: null, updated_at: "2026-09-12T00:00:00.000Z" };
const oil: DailyStateConcern = { kind: "oiliness", status: "present", areas: ["t_zone"], attributes: { severity: "slight", baseline_comparison: "usual" }, user_wording: [], source: ["conversation"], interaction_origin: "user_raised", area_origin: "user_confirmed" };
const unknownBlackheads: DailyStateConcern = { kind: "blackheads", status: "present", areas: ["nose"], attributes: { amount: "few", baseline_comparison: "new" }, user_wording: [], source: ["conversation"], interaction_origin: "user_raised", area_origin: "user_confirmed" };

function record(date: string, concerns: DailyStateConcern[] = [oil]): SkinCheckin { return { id: `00000000-0000-4000-8000-${date.replaceAll("-", "")}`, recorded_date: date, created_at: `${date}T00:00:00.000Z`, dryness_level: 0, oiliness_level: 0, redness_level: 0, sensitivity_level: 0, acne_level: 0, notes: null, daily_state: { version: 2, summary: null, concerns }, known_fields: [], field_provenance: {}, is_legacy: false }; }
function sevenAcrossNaturalWeeks() { return ["2026-09-01", "2026-09-02", "2026-09-04", "2026-09-06", "2026-09-08", "2026-09-10", "2026-09-12"].map((date) => record(date)); }

describe("Weekly skin narration", () => {
  it("binds deterministic facts to every record in a seven-record batch, even across natural weeks", () => {
    const summary = buildWeeklySkinSummary({ checkins: sevenAcrossNaturalWeeks(), profile, recentTrends: [], endDate: "2026-09-12" });

    expect(summary.period).toEqual({ start: "2026-09-01", end: "2026-09-12" });
    expect(summary.recorded_count).toBe(7);
    expect(summary.recorded_dates).toEqual(["2026-09-01", "2026-09-02", "2026-09-04", "2026-09-06", "2026-09-08", "2026-09-10", "2026-09-12"]);
    expect(summary.stable).toMatchObject([{ label: "T 区 · 出油" }]);
  });

  it("passes complete classified facts to AI narration instead of the deterministic overall template", async () => {
    const summary = buildWeeklySkinSummary({ checkins: sevenAcrossNaturalWeeks(), profile, recentTrends: [], endDate: "2026-09-12" });
    const narrate = vi.fn().mockResolvedValue({ narration: "这 7 次记录整体节奏比较平稳，T 区出油多次接近平时状态，没有看到持续偏离的趋势。近期可以先维持现在让皮肤感觉舒适的护理节奏，并继续留意同一区域是否出现连续变化。" });
    const result = await createWeeklySkinNarrationService({ narrate }).narrate({ summary, profile });

    expect(narrate).toHaveBeenCalledWith(expect.objectContaining({ period: { start: "2026-09-01", end: "2026-09-12" }, recorded_count: 7, recorded_dates: summary.recorded_dates, stable: expect.arrayContaining([expect.objectContaining({ label: "T 区 · 出油" })]), long_term_baseline: expect.objectContaining({ usual_oily_areas: ["T 区"] }) }));
    expect(result).toContain("整体节奏比较平稳");
    expect(result).not.toContain("暂未显示明确的跨日变化");
  });

  it("rejects an AI concern that is absent from deterministic facts", async () => {
    const summary = buildWeeklySkinSummary({ checkins: sevenAcrossNaturalWeeks(), profile, recentTrends: [], endDate: "2026-09-12" });
    const result = await createWeeklySkinNarrationService({ narrate: vi.fn().mockResolvedValue({ narration: "这 7 次记录整体比较稳定，但脸颊泛红持续加重，需要立即调整护理。T 区出油虽然较平时接近，但仍建议持续观察后续变化，避免忽略其他新的皮肤信号。" }) }).narrate({ summary, profile });

    expect(result).not.toContain("脸颊泛红持续加重");
    expect(result).toContain("T 区 · 出油");
  });

  it("uses a natural multi-sentence fallback when the provider fails and does not turn ungraded observations into absence", async () => {
    const summary = buildWeeklySkinSummary({ checkins: sevenAcrossNaturalWeeks().map((item) => ({ ...item, daily_state: { ...item.daily_state!, concerns: [unknownBlackheads] } })), profile, recentTrends: [], endDate: "2026-09-12" });
    const facts = buildWeeklySkinNarrationFacts(summary, profile);
    const result = await createWeeklySkinNarrationService({ narrate: vi.fn().mockRejectedValue(new Error("offline")) }).narrate({ summary, profile });

    expect(facts.ungraded_observation_count).toBeGreaterThan(0);
    expect(result.length).toBeGreaterThan(80);
    expect(result).toContain("暂时不把它解释为皮肤已经稳定或问题消失");
    expect(result).not.toContain("暂无明确跨日变化");
  });
});
