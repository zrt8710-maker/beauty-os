import { describe, expect, it } from "vitest";

import { profileInputSchema } from "@/schemas/profile";

const input = (usual_intensity: string, frequency = "recurring") => ({ skin_type: "combination", sensitivity_level: 2, skin_goals: [], long_term_skin_baseline: { usual_oily_areas: [], usual_dry_areas: [], recurring_tendencies: [{ kind: "blackheads", usual_areas: ["nose"], tendency: "recurring", frequency, usual_intensity, source: "user_declared" }] }, preferred_routine_length: { am_steps: 2, pm_steps: 2 }, texture_preferences: [], avoid_ingredients: [], timezone: "Asia/Shanghai", location: { name: null, latitude: null, longitude: null } });

describe("Profile usual intensity compatibility", () => {
  it.each(["mild", "moderate", "marked", "unknown"])("normalizes legacy %s safely", (legacy) => {
    const parsed = profileInputSchema.parse(input(legacy));
    const expected = ({ mild: "slight", moderate: "noticeable", marked: "marked", unknown: "unknown" } as const)[legacy];
    expect(parsed.long_term_skin_baseline.recurring_tendencies[0]?.usual_intensity).toBe(expected);
  });

  it("accepts very_marked and keeps frequency independent from usual intensity", () => {
    const tendency = profileInputSchema.parse(input("very_marked", "frequent")).long_term_skin_baseline.recurring_tendencies[0];
    expect(tendency).toMatchObject({ frequency: "frequent", usual_intensity: "very_marked" });
  });
});
