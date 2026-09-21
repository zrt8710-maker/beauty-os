import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DailySkinEditView } from "@/features/check-in/daily-skin-edit-view";

describe("DailySkinEditView", () => {
  it("shows a human-facing editor with inherited baseline reference, not raw schema fields", () => {
    const html = renderToStaticMarkup(<DailySkinEditView
      draft={{ dryness_level: 0, oiliness_level: 1, redness_level: 0, sensitivity_level: 0, acne_level: 0, notes: null, recorded_date: "2026-09-01", known_fields: ["oiliness_level"], field_provenance: { oiliness_level: ["conversation"] }, daily_state: { version: 2, summary: null, concerns: [{ kind: "oiliness", status: "present", areas: ["t_zone"], attributes: { severity: "slight", baseline_comparison: "usual" }, user_wording: ["T区有点油"], source: ["conversation"], interaction_origin: "user_raised", area_origin: "user_confirmed" }] } }}
      message=""
      onCancel={vi.fn()}
      onChange={vi.fn()}
      onSave={vi.fn()}
      profile={{ long_term_skin_baseline: { usual_oily_areas: ["t_zone"], usual_dry_areas: ["nose_wings"], recurring_tendencies: [] } }}
      saving={false}
    />);
    expect(html).toContain("调整今天的皮肤状态");
    expect(html).toContain("T 区 · 出油");
    expect(html).toContain("鼻翼 · 发干");
    expect(html).toContain("沿用长期状态");
    expect(html).toContain("补充今天的其他状态");
    expect(html).not.toContain(">oiliness<");
    expect(html).not.toContain(">t_zone<");
    expect(html).not.toContain(">full_face<");
    expect(html).not.toContain(">present<");
    expect(html).not.toContain("未记录");
  });

  it("keeps a durable area visible even when its area origin is unknown, and hides completion artifacts", () => {
    const html = renderToStaticMarkup(<DailySkinEditView
      draft={{ dryness_level: 2, oiliness_level: 0, redness_level: 0, sensitivity_level: 0, acne_level: 0, notes: null, recorded_date: "2026-09-06", known_fields: ["dryness_level"], field_provenance: { dryness_level: ["conversation"] }, daily_state: { version: 2, summary: null, concerns: [
        { kind: "dryness", status: "present", areas: ["nose_wings"], attributes: { severity: "mild", baseline_comparison: "more_than_usual" }, user_wording: ["鼻翼特别干"], source: ["conversation"], interaction_origin: "assistant_prompted", area_origin: "unknown" },
        { kind: "flaking", status: "present", areas: ["nose_wings"], attributes: { severity: "slight" }, user_wording: ["有起皮"], source: ["conversation"], interaction_origin: "assistant_prompted", area_origin: "unknown" },
        { kind: "roughness", status: "absent", areas: ["nose_wings"], attributes: {}, user_wording: ["没有了"], source: ["conversation"], interaction_origin: "assistant_prompted", area_origin: "unknown" },
      ] } }}
      message="" onCancel={vi.fn()} onChange={vi.fn()} onSave={vi.fn()}
      profile={{ long_term_skin_baseline: { usual_oily_areas: [], usual_dry_areas: ["nose_wings"], recurring_tendencies: [] } }} saving={false}
    />);
    expect(html).toContain("鼻翼 · 发干");
    expect(html).toContain("鼻翼 · 起皮");
    expect(html).not.toContain("区域未指定 · 发干");
    expect(html).not.toContain("区域未指定 · 起皮");
    expect(html).not.toContain("鼻翼 · 粗糙");
  });
});
