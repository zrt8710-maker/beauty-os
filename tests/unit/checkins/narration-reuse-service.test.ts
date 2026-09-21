import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => new Map<string, Promise<unknown>>());
const dailyGenerate = vi.hoisted(() => vi.fn());
const weeklyNarrate = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({
  unstable_cache: <T>(callback: (serializedFacts: string) => Promise<T>, keyParts: string[]) => async (serializedFacts: string) => {
    const key = `${keyParts.join(":")}:${serializedFacts}`;
    if (!cache.has(key)) cache.set(key, callback(serializedFacts));
    return cache.get(key) as Promise<T>;
  },
}));

vi.mock("@/server/daily-skin-report/volcengine-professional-daily-observation-provider", () => ({
  createConfiguredVolcengineProfessionalDailyObservationProvider: () => ({ generate: dailyGenerate }),
}));

vi.mock("@/server/weekly-skin-summary/volcengine-weekly-skin-narration-provider", () => ({
  createConfiguredVolcengineWeeklySkinNarrationProvider: () => ({ narrate: weeklyNarrate }),
}));

import { getReusableDailyNarration, getReusableWeeklyNarration } from "@/server/daily-skin-report/narration-reuse-service";
import { buildWeeklySkinSummary } from "@/features/profile/weekly-skin-summary-view-model";
import type { DailyStateConcern, SkinCheckin } from "@/schemas/checkin";
import type { Profile } from "@/schemas/profile";

const profile: Profile = { skin_type: "combination", sensitivity_level: 1, skin_goals: ["oil_control"], long_term_skin_baseline: { usual_oily_areas: ["t_zone"], usual_dry_areas: [], recurring_tendencies: [] }, preferred_routine_length: { am_steps: 2, pm_steps: 2 }, texture_preferences: [], avoid_ingredients: [], timezone: "Asia/Shanghai", location: { name: null, latitude: null, longitude: null }, onboarding_completed_at: null, updated_at: "2026-09-12T00:00:00.000Z" };
const oil: DailyStateConcern = { kind: "oiliness", status: "present", areas: ["t_zone"], attributes: { severity: "slight" }, user_wording: ["T区有点油"], source: ["conversation"], interaction_origin: "user_raised", area_origin: "user_confirmed" };
const dailyInput = { today: { version: 2 as const, summary: "T区有点油", concerns: [oil] }, profile, recentTrends: [], mode: "short_history" as const };

function record(date: string, concerns: DailyStateConcern[] = [oil]): SkinCheckin {
  return { id: `00000000-0000-4000-8000-${date.replaceAll("-", "")}`, recorded_date: date, created_at: `${date}T00:00:00.000Z`, dryness_level: 0, oiliness_level: 0, redness_level: 0, sensitivity_level: 0, acne_level: 0, notes: null, daily_state: { version: 2, summary: "T区有点油", concerns }, known_fields: [], field_provenance: {}, is_legacy: false };
}

function weeklySummary(checkins = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"].map((date) => record(date))) {
  return buildWeeklySkinSummary({ checkins, profile, recentTrends: [], endDate: "2026-09-07" });
}

describe("Narration reuse", () => {
  beforeEach(() => {
    cache.clear();
    dailyGenerate.mockReset().mockResolvedValue({ overall_observation: "今天主要是 T 区轻微出油，先继续观察是否连续出现。", baseline_comparison: null, key_observations: ["留意明天 T 区是否仍偏油。"] });
    weeklyNarrate.mockReset().mockResolvedValue({ narration: "这 7 次记录整体以 T 区轻微出油为主，变化比较平稳。接下来可以维持当前节奏，并继续留意是否连续出现新的局部变化。" });
  });

  it("reuses the same Daily facts and separates presentation modes", async () => {
    await getReusableDailyNarration(dailyInput);
    await getReusableDailyNarration(dailyInput);
    await getReusableDailyNarration({ ...dailyInput, mode: "daily_overview" });

    expect(dailyGenerate).toHaveBeenCalledTimes(2);
    expect(dailyGenerate).toHaveBeenNthCalledWith(1, expect.objectContaining({ presentation_mode: "short_history" }));
    expect(dailyGenerate).toHaveBeenNthCalledWith(2, expect.objectContaining({ presentation_mode: "daily_overview" }));
  });

  it("regenerates Daily narration when durable Daily facts change", async () => {
    await getReusableDailyNarration(dailyInput);
    await getReusableDailyNarration({ ...dailyInput, today: { ...dailyInput.today, summary: "T区出油，脸颊发干", concerns: [...dailyInput.today.concerns, { ...oil, kind: "dryness", areas: ["cheeks"], user_wording: ["脸颊发干"] }] } });

    expect(dailyGenerate).toHaveBeenCalledTimes(2);
  });

  it("reuses a completed Weekly group's facts and regenerates when one record changes", async () => {
    const summary = weeklySummary();
    await getReusableWeeklyNarration({ summary, profile });
    await getReusableWeeklyNarration({ summary, profile });
    const changed = weeklySummary([record("2026-09-01"), record("2026-09-02"), record("2026-09-03"), record("2026-09-04"), record("2026-09-05"), record("2026-09-06"), record("2026-09-07", [{ ...oil, attributes: { severity: "marked" } }])]);
    await getReusableWeeklyNarration({ summary: changed, profile });

    expect(weeklyNarrate).toHaveBeenCalledTimes(2);
  });
});
