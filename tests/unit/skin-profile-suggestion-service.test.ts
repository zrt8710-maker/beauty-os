import { describe, expect, it } from "vitest";

import { buildSkinProfileSuggestions } from "@/server/services/skin-profile-suggestion-service";
import type { Profile } from "@/schemas/profile";
import type { DailyStateConcern, SkinCheckin } from "@/schemas/checkin";

const profile = (): Pick<Profile, "long_term_skin_baseline"> => ({ long_term_skin_baseline: { usual_oily_areas: [], usual_dry_areas: [], recurring_tendencies: [] } });

describe("SkinProfileSuggestion builder", () => {
  it("does not suggest a usual area when three dates span less than 14 days", () => {
    const checkins = confirmedDays(["2026-08-28", "2026-08-24", "2026-08-20"], "oiliness", "t_zone");
    expect(buildSkinProfileSuggestions(profile(), checkins, "2026-08-28")).toEqual([]);
  });

  it("suggests a usual area after three reliable dates, 14 days, and seven confirmed records", () => {
    const checkins = withEmptyConfirmedDays(confirmedDays(["2026-08-28", "2026-08-21", "2026-08-14"], "dryness", "cheeks"), ["2026-08-27", "2026-08-26", "2026-08-25", "2026-08-24"]);
    expect(buildSkinProfileSuggestions(profile(), checkins, "2026-08-28")).toContainEqual(expect.objectContaining({ kind: "add_usual_area", concern: "dryness", area: "cheeks", strength: "moderate" }));
  });

  it("does not duplicate an existing usual area", () => {
    const current = profile();
    current.long_term_skin_baseline.usual_oily_areas.push("t_zone");
    const checkins = withEmptyConfirmedDays(confirmedDays(["2026-08-28", "2026-08-21", "2026-08-14"], "oiliness", "t_zone"), ["2026-08-27", "2026-08-26", "2026-08-25", "2026-08-24"]);
    expect(buildSkinProfileSuggestions(current, checkins, "2026-08-28")).toEqual([]);
  });

  it("does not count missing or unknown/composite-incomplete concerns as present evidence", () => {
    const checkins = withEmptyConfirmedDays([
      record("2026-08-28", [incompleteComposite("nose")]),
      record("2026-08-21", [incompleteComposite("nose")]),
      record("2026-08-14", [incompleteComposite("nose")]),
      record("2026-08-07", [incompleteComposite("nose")]),
      record("2026-08-01", [incompleteComposite("nose")]),
    ], ["2026-08-27", "2026-08-26", "2026-08-25", "2026-08-24", "2026-08-23", "2026-08-22", "2026-08-20", "2026-08-19", "2026-08-18"]);
    expect(buildSkinProfileSuggestions(profile(), checkins, "2026-08-28")).toEqual([]);
  });

  it("requires five dates, 21 days, and fourteen confirmed records for recurring tendencies", () => {
    const shortSpan = withEmptyConfirmedDays(confirmedDays(["2026-08-28", "2026-08-25", "2026-08-22", "2026-08-19", "2026-08-16"], "redness", "cheeks"), Array.from({ length: 9 }, (_, index) => `2026-08-${String(15 - index).padStart(2, "0")}`));
    expect(buildSkinProfileSuggestions(profile(), shortSpan, "2026-08-28")).toEqual([]);

    const qualifying = withEmptyConfirmedDays(confirmedDays(["2026-08-28", "2026-08-21", "2026-08-14", "2026-08-07", "2026-08-01"], "redness", "cheeks"), ["2026-08-27", "2026-08-26", "2026-08-25", "2026-08-24", "2026-08-23", "2026-08-22", "2026-08-20", "2026-08-19", "2026-08-18"]);
    expect(buildSkinProfileSuggestions(profile(), qualifying, "2026-08-28")).toContainEqual(expect.objectContaining({ kind: "add_recurring_tendency", concern: "redness", area: "cheeks" }));
  });

  it("does not duplicate an existing recurring tendency and never writes the Profile", () => {
    const current = profile();
    current.long_term_skin_baseline.recurring_tendencies.push({ kind: "redness", usual_areas: ["cheeks"], tendency: "unknown", usual_intensity: "unknown", source: "user_declared" });
    const before = structuredClone(current);
    const checkins = withEmptyConfirmedDays(confirmedDays(["2026-08-28", "2026-08-21", "2026-08-14", "2026-08-07", "2026-08-01"], "redness", "cheeks"), ["2026-08-27", "2026-08-26", "2026-08-25", "2026-08-24", "2026-08-23", "2026-08-22", "2026-08-20", "2026-08-19", "2026-08-18"]);
    expect(buildSkinProfileSuggestions(current, checkins, "2026-08-28")).toEqual([]);
    expect(current).toEqual(before);
  });

  it("aggregates stinging, itching, and burning by distinct date, but does not treat redness as reactive discomfort", () => {
    const reactive = withEmptyConfirmedDays([
      ...confirmedDays(["2026-08-28", "2026-08-21"], "stinging", "cheeks"),
      ...confirmedDays(["2026-08-14", "2026-08-07"], "itching", "cheeks"),
      ...confirmedDays(["2026-08-01"], "burning", "cheeks"),
    ], ["2026-08-27", "2026-08-26", "2026-08-25", "2026-08-24", "2026-08-23", "2026-08-22", "2026-08-20", "2026-08-19", "2026-08-18"]);
    expect(buildSkinProfileSuggestions(profile(), reactive, "2026-08-28")).toContainEqual(expect.objectContaining({ kind: "add_recurring_tendency", concern: "reactive_discomfort", area: "cheeks" }));

    const redness = withEmptyConfirmedDays(confirmedDays(["2026-08-28", "2026-08-21", "2026-08-14", "2026-08-07", "2026-08-01"], "redness", "cheeks"), ["2026-08-27", "2026-08-26", "2026-08-25", "2026-08-24", "2026-08-23", "2026-08-22", "2026-08-20", "2026-08-19", "2026-08-18"]);
    expect(buildSkinProfileSuggestions(profile(), redness, "2026-08-28").some((item) => item.kind === "add_recurring_tendency" && item.concern === "reactive_discomfort")).toBe(false);
  });
});

function confirmedDays(dates: string[], kind: DailyStateConcern["kind"], area: DailyStateConcern["areas"][number]) { return dates.map((date) => record(date, [concern(kind, area)])); }
function withEmptyConfirmedDays(rows: SkinCheckin[], dates: string[]) { return [...rows, ...dates.map((date) => record(date, []))]; }
function concern(kind: DailyStateConcern["kind"], area: DailyStateConcern["areas"][number], attributes: DailyStateConcern["attributes"] = {}): DailyStateConcern { return { kind, status: "present", areas: [area], attributes: kind === "blackheads" ? { amount: "few", distribution: "localized", ...attributes } : { severity: "mild", ...attributes }, user_wording: [], source: ["conversation"], interaction_origin: "user_raised", area_origin: "user_confirmed" }; }
function incompleteComposite(area: DailyStateConcern["areas"][number]): DailyStateConcern { return { kind: "blackheads", status: "present", areas: [area], attributes: { amount: "few" }, user_wording: [], source: ["conversation"], interaction_origin: "user_raised", area_origin: "user_confirmed" }; }
function record(recorded_date: string, concerns: DailyStateConcern[]): SkinCheckin { return { id: `50000000-0000-4000-8000-${recorded_date.replaceAll("-", "")}`, recorded_date, created_at: `${recorded_date}T00:00:00.000Z`, dryness_level: 0, oiliness_level: 0, redness_level: 0, sensitivity_level: 0, acne_level: 0, notes: null, daily_state: { version: 2, summary: null, concerns }, known_fields: [], field_provenance: {}, is_legacy: false }; }
