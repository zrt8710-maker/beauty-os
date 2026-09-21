import { describe, expect, it } from "vitest";

import { applyProfileSuggestionIntent, parseProfileSuggestionIntent } from "@/features/profile/profile-suggestion-intent";
import type { Profile } from "@/schemas/profile";

const profile: Profile = { skin_type: "combination", sensitivity_level: 1, skin_goals: [], long_term_skin_baseline: { usual_oily_areas: [], usual_dry_areas: [], recurring_tendencies: [] }, preferred_routine_length: { am_steps: 2, pm_steps: 2 }, texture_preferences: [], avoid_ingredients: [], timezone: "Asia/Shanghai", location: { name: null, latitude: null, longitude: null }, onboarding_completed_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z" };

describe("Profile suggestion intent", () => {
  it("prefills a usual-area edit without mutating the saved Profile", () => {
    const intent = parseProfileSuggestionIntent({ suggestion: "usual_area", concern: "dryness", area: "cheeks" });
    const draft = applyProfileSuggestionIntent(profile, intent);
    expect(draft.long_term_skin_baseline.usual_dry_areas).toEqual(["cheeks"]);
    expect(profile.long_term_skin_baseline.usual_dry_areas).toEqual([]);
  });

  it("prefills a recurring tendency with the confirmed-suggestion source", () => {
    const intent = parseProfileSuggestionIntent({ suggestion: "recurring_tendency", concern: "small_bumps", area: "forehead" });
    const draft = applyProfileSuggestionIntent(profile, intent);
    expect(draft.long_term_skin_baseline.recurring_tendencies).toEqual([expect.objectContaining({ kind: "small_bumps", usual_areas: ["forehead"], source: "trend_suggestion_confirmed" })]);
  });

  it("accepts a recurring tendency without a reliable area", () => {
    const intent = parseProfileSuggestionIntent({ suggestion: "recurring_tendency", concern: "reactive_discomfort", area: "" });
    expect(applyProfileSuggestionIntent(profile, intent).long_term_skin_baseline.recurring_tendencies).toEqual([expect.objectContaining({ kind: "reactive_discomfort", usual_areas: [], source: "trend_suggestion_confirmed" })]);
  });

  it("rejects malformed query intent and never replaces existing baseline facts", () => {
    expect(parseProfileSuggestionIntent({ suggestion: "usual_area", concern: "dryness", area: "other" })).toBeNull();
    const existing: Profile = { ...profile, long_term_skin_baseline: { ...profile.long_term_skin_baseline, recurring_tendencies: [{ kind: "small_bumps", usual_areas: ["forehead"], tendency: "recurring", usual_intensity: "unknown", source: "user_declared" }] } };
    const intent = parseProfileSuggestionIntent({ suggestion: "recurring_tendency", concern: "small_bumps", area: "forehead" });
    expect(applyProfileSuggestionIntent(existing, intent)).toBe(existing);
  });
});
