import { describe, expect, it } from "vitest";

import { applyBaselineOverrideSelection, buildEffectiveDailySkinState } from "@/features/check-in/effective-daily-skin-state";
import type { DailyStateConcern, SkinCheckin } from "@/schemas/checkin";
import type { Profile } from "@/schemas/profile";

const profile: Pick<Profile, "long_term_skin_baseline"> = { long_term_skin_baseline: {
  usual_oily_areas: ["t_zone"], usual_dry_areas: ["nose_wings"],
  recurring_tendencies: [
    { kind: "small_bumps", usual_areas: ["forehead"], tendency: "frequent", usual_intensity: "noticeable", source: "user_declared" },
    { kind: "visible_pores", usual_areas: ["cheeks"], tendency: "frequent", usual_intensity: "slight", source: "user_declared" },
    { kind: "blackheads", usual_areas: ["nose"], tendency: "recurring", usual_intensity: "slight", source: "user_declared" },
  ],
} };
function concern(patch: Partial<DailyStateConcern>): DailyStateConcern { return { kind: "dryness", status: "present", areas: ["nose_wings"], attributes: {}, user_wording: [], source: ["conversation"], interaction_origin: "user_raised", area_origin: "user_confirmed", ...patch }; }
function checkin(concerns: DailyStateConcern[]): SkinCheckin { return { id: "50000000-0000-4000-8000-000000000001", recorded_date: "2026-09-06", created_at: "2026-09-06T00:00:00.000Z", dryness_level: 0, oiliness_level: 0, redness_level: 0, sensitivity_level: 0, acne_level: 0, notes: null, known_fields: [], field_provenance: {}, is_legacy: false, daily_state: { version: 2, summary: null, concerns } }; }

describe("EffectiveDailySkinState", () => {
  it("inherits unmentioned baseline facts without inventing today facts", () => {
    const result = buildEffectiveDailySkinState({ checkin: checkin([]), profile });
    expect(result.inheritedBaseline.map((item) => [item.concern, item.area, item.provenance])).toEqual([
      ["oiliness", "t_zone", "baseline_inherited"], ["dryness", "nose_wings", "baseline_inherited"], ["small_bumps", "forehead", "baseline_inherited"], ["visible_pores", "cheeks", "baseline_inherited"], ["blackheads", "nose", "baseline_inherited"],
    ]);
    expect(result.todayOverrides).toEqual([]);
  });

  it("uses today facts to override comparable baseline and preserves a new manifestation", () => {
    const result = buildEffectiveDailySkinState({ checkin: checkin([
      concern({ attributes: { severity: "mild", baseline_comparison: "more_than_usual" } }),
      concern({ kind: "flaking", attributes: { severity: "slight", baseline_comparison: "new" } }),
    ]), profile });
    expect(result.items.find((item) => item.key === "dryness:nose_wings")).toMatchObject({ status: "present", provenance: "today_confirmed", baselineComparison: "more_than_usual", grade: 2 });
    expect(result.items.find((item) => item.key === "flaking:nose_wings")).toMatchObject({ provenance: "today_confirmed", baselineComparison: "new", grade: 1 });
    expect(result.items.find((item) => item.key === "oiliness:t_zone")?.provenance).toBe("baseline_inherited");
  });

  it("lets an explicit manual absence override an inherited baseline", () => {
    const result = buildEffectiveDailySkinState({ checkin: checkin([
      concern({ kind: "oiliness", areas: ["t_zone"], status: "absent", attributes: { baseline_comparison: "usual" }, source: ["manual"] }),
    ]), profile });
    expect(result.items.find((item) => item.key === "oiliness:t_zone")).toMatchObject({ status: "absent", provenance: "manual_override", grade: 0 });
  });

  it("round-trips a manual baseline edit back to inheritance without creating a daily fact", () => {
    const baseline = { concern: "oiliness" as const, area: "t_zone" as const };
    const overridden = applyBaselineOverrideSelection([], baseline, "absent");
    expect(overridden).toMatchObject([{ kind: "oiliness", status: "absent", source: ["manual"] }]);
    const inheritedAgain = applyBaselineOverrideSelection(overridden, baseline, "inherit");
    expect(inheritedAgain).toEqual([]);
    const effective = buildEffectiveDailySkinState({ checkin: checkin(inheritedAgain), profile });
    expect(effective.items.find((item) => item.key === "oiliness:t_zone")).toMatchObject({ status: "present", provenance: "baseline_inherited", todayConcern: null });
  });

  it("applies the same policy to a dry profile with a cheek-redness override", () => {
    const dryProfile: Pick<Profile, "long_term_skin_baseline"> = { long_term_skin_baseline: { usual_oily_areas: [], usual_dry_areas: ["cheeks"], recurring_tendencies: [] } };
    const result = buildEffectiveDailySkinState({ checkin: checkin([
      concern({ kind: "redness", areas: ["cheeks"], attributes: { severity: "moderate", baseline_comparison: "new" } }),
    ]), profile: dryProfile });
    expect(result.items.find((item) => item.key === "dryness:cheeks")?.provenance).toBe("baseline_inherited");
    expect(result.items.find((item) => item.key === "redness:cheeks")).toMatchObject({ provenance: "today_confirmed", grade: 2, baselineComparison: "new" });
  });

  it("applies the same policy to a normal profile with a chin-blemish override", () => {
    const normalProfile: Pick<Profile, "long_term_skin_baseline"> = { long_term_skin_baseline: { usual_oily_areas: [], usual_dry_areas: [], recurring_tendencies: [{ kind: "blemishes", usual_areas: ["chin"], tendency: "occasional", usual_intensity: "slight", source: "user_declared" }] } };
    const result = buildEffectiveDailySkinState({ checkin: checkin([
      concern({ kind: "blemishes", areas: ["chin"], attributes: { amount: "many", baseline_comparison: "more_than_usual" } }),
    ]), profile: normalProfile });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ concern: "blemishes", area: "chin", provenance: "today_confirmed", grade: null, baselineComparison: "more_than_usual" });
  });

  it("excludes a completion-only concern from the effective state", () => {
    const result = buildEffectiveDailySkinState({ checkin: checkin([
      concern({ kind: "roughness", status: "absent", user_wording: ["没有了"] }),
    ]), profile: { long_term_skin_baseline: { usual_oily_areas: [], usual_dry_areas: [], recurring_tendencies: [] } } });
    expect(result.todayOverrides).toEqual([]);
  });
});
