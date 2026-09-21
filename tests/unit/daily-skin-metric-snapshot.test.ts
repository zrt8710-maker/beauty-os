import { describe, expect, it } from "vitest";

import { buildDailySkinMetricSnapshot } from "@/domain/skin-grading/daily-skin-metric-snapshot";
import type { DailyStateConcern, SkinCheckin } from "@/schemas/checkin";

function checkin(concerns: DailyStateConcern[]): SkinCheckin {
  return { id: "00000000-0000-4000-8000-202609010000", recorded_date: "2026-09-01", created_at: "2026-09-01T00:00:00.000Z", dryness_level: 0, oiliness_level: 0, redness_level: 0, sensitivity_level: 0, acne_level: 0, notes: null, daily_state: { version: 2, summary: null, concerns }, known_fields: [], field_provenance: {}, is_legacy: false };
}
function concern(patch: Partial<DailyStateConcern> = {}): DailyStateConcern {
  return { kind: "oiliness", status: "present", areas: ["t_zone"], attributes: { severity: "slight" }, user_wording: [], source: ["conversation"], interaction_origin: "user_raised", area_origin: "user_confirmed", ...patch };
}

describe("DailySkinMetricSnapshot", () => {
  it("is deterministic for the same saved check-in", () => {
    const saved = checkin([concern()]);
    expect(buildDailySkinMetricSnapshot(saved)).toEqual(buildDailySkinMetricSnapshot(saved));
  });

  it("keeps confirmed absence distinct from missing facts", () => {
    expect(buildDailySkinMetricSnapshot(checkin([concern({ status: "absent", attributes: {} })])).metrics).toMatchObject([{ daily_status: "absent", grade_status: "graded", grade: 0 }]);
    expect(buildDailySkinMetricSnapshot(checkin([])).metrics).toEqual([]);
  });

  it("represents insufficient direct and composite evidence as unknown, never zero", () => {
    expect(buildDailySkinMetricSnapshot(checkin([concern({ attributes: {} })])).metrics).toMatchObject([{ grade_status: "unknown", grade: null }]);
    expect(buildDailySkinMetricSnapshot(checkin([concern({ kind: "blackheads", areas: ["nose"], attributes: { amount: "few" } })])).metrics).toMatchObject([{ grade_status: "unknown", grade: null }]);
  });

  it("does not invent an area for unconfirmed full-face fallback", () => {
    expect(buildDailySkinMetricSnapshot(checkin([concern({ areas: ["full_face"], area_origin: "unknown", attributes: { severity: "marked" } })])).metrics).toMatchObject([{ area: null, grade_status: "unknown", grade: null }]);
  });
});
