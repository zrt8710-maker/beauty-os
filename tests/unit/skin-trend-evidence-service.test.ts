import { describe, expect, it } from "vitest";

import type { DailyStateArea, DailyStateConcernKind, SkinCheckin } from "@/schemas/checkin";
import { createSkinTrendEvidenceService } from "@/server/services/skin-trend-evidence-service";

const service = createSkinTrendEvidenceService();

describe("SkinTrendEvidenceService", () => {
  it("keeps unknown distinct from explicit absence and missing dates", () => {
    const result = evaluate("redness", [
      v2("2026-08-28", "redness", "present", ["cheeks"]),
      v2("2026-08-27", "redness", "absent", ["cheeks"]),
      v2("2026-08-26", "oiliness", "present", ["t_zone"]),
    ]);
    expect(result.concern.present_days).toEqual([]);
    expect(result.concern.explicit_absent_days).toEqual(["2026-08-27"]);
    expect(result.concern.unknown_days).toEqual(["2026-08-28", "2026-08-26"]);
    expect(result.concern.unknown_days).not.toContain("2026-08-25");
  });

  it("requires both distinct occurrences and coverage before recurring wording", () => {
    const sparse = evaluate("blackheads", [
      v2("2026-08-28", "blackheads", "present", ["nose"]),
      v2("2026-08-27", "blackheads", "present", ["nose"]),
      v2("2026-08-26", "blackheads", "present", ["nose"]),
    ]);
    expect(sparse.evidence_strength).toBe("limited");
    expect(sparse.statements_allowed).toEqual([]);
  });

  it("uses Snapshot grades, reliable areas, triggers, and user baseline wording", () => {
    const rows = Array.from({ length: 7 }, (_, index) => v2(`2026-08-${String(28 - index).padStart(2, "0")}`, "stinging", "present", ["cheeks"], { trigger: "洗脸后", severity: "slight", baseline_comparison: "more_than_usual" }));
    const result = evaluate("stinging", rows);
    expect(result.evidence_strength).toBe("adequate");
    expect(result.statements_allowed).toEqual(["recent_multiple_records"]);
    expect(result.recurring_areas).toEqual([{ area: "cheeks", present_days: 7, present_dates: ["2026-08-28", "2026-08-27", "2026-08-26", "2026-08-25", "2026-08-24", "2026-08-23", "2026-08-22"] }]);
    expect(result.recurring_triggers).toEqual([{ trigger: "洗脸后", present_days: 7 }]);
    expect(result.grade_observations).toEqual([{ grade: 1, present_days: 7 }]);
    expect(result.baseline_comparisons).toEqual([{ comparison: "more_than_usual", present_days: 7 }]);
  });

  it("does not permit frequency comparison with sparse earlier coverage", () => {
    const result = evaluate("redness", [
      ...Array.from({ length: 7 }, (_, index) => v2(`2026-08-${String(28 - index).padStart(2, "0")}`, "redness", "present", ["cheeks"])),
      v2("2026-07-31", "redness", "present", ["cheeks"]),
    ]);
    expect(result.comparison.status).toBe("insufficient_coverage");
  });

  it("does not infer reliable present evidence from v1 detail or legacy fields", () => {
    const legacyV1: SkinCheckin = { ...base("2026-08-28"), daily_state: { version: 1, summary: "脸颊有点红", details: [{ area: "脸颊", finding: "redness", status: "present", description: "轻微", source: ["legacy"] }] } };
    const nullState = { ...base("2026-08-27"), known_fields: [], daily_state: null };
    const canonical: SkinCheckin = { ...base("2026-08-26"), redness_level: 0, known_fields: ["redness_level"], field_provenance: { redness_level: ["manual"] } };
    const result = evaluate("redness", [legacyV1, nullState, canonical]);
    expect(result.concern.present_days).toEqual([]);
    expect(result.concern.explicit_absent_days).toEqual([]);
    expect(result.concern.unknown_days).toEqual(["2026-08-28", "2026-08-26"]);
  });

  it("has no Profile baseline input and therefore cannot alter daily evidence", () => {
    const result = evaluate("oiliness", [v2("2026-08-28", "oiliness", "present", ["t_zone"], { severity: "slight" })]);
    expect(result.concern.present_days).toEqual(["2026-08-28"]);
    expect(result.window.confirmed_checkin_days).toBe(1);
  });
});

function evaluate(concern: DailyStateConcernKind, checkins: SkinCheckin[]) { return service.evaluate({ concern, checkins, end_date: "2026-08-28" }); }
function base(recorded_date: string): SkinCheckin { return { id: "50000000-0000-4000-8000-000000000001", dryness_level: 0, oiliness_level: 0, redness_level: 0, sensitivity_level: 0, acne_level: 0, notes: null, daily_state: null, recorded_date, known_fields: [], field_provenance: {}, created_at: "2026-08-01T00:00:00.000Z", is_legacy: false }; }
function v2(recorded_date: string, kind: DailyStateConcernKind, status: "present" | "absent", areas: DailyStateArea[], attributes: { trigger?: string; severity?: "slight"; baseline_comparison?: "more_than_usual" } = {}): SkinCheckin {
  return { ...base(recorded_date), daily_state: { version: 2, summary: `${kind} ${status}`, concerns: [{ kind, status, areas: areas as never, attributes, user_wording: [kind], source: ["conversation"], interaction_origin: "user_raised", area_origin: "user_confirmed" }] } };
}
