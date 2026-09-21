import { describe, expect, it } from "vitest";

import { getTodayNewChangeIndicators } from "@/features/skin-conversation/today-new-change-indicator";
import type { LongTermSkinBaseline } from "@/schemas/profile";

const baseline: LongTermSkinBaseline = {
  usual_oily_areas: ["t_zone"],
  usual_dry_areas: ["nose_wings"],
  recurring_tendencies: [{ kind: "blackheads" as const, usual_areas: ["nose"], tendency: "recurring" as const, usual_intensity: "noticeable" as const, source: "user_declared" as const }],
};

describe("today-new change indicator", () => {
  it("shows only a newly mentioned concern-area, never an unrecorded past", () => {
    expect(getTodayNewChangeIndicators("T区有点油，脸颊和鼻翼有点干", baseline, [])).toEqual([
      { key: "dryness:cheeks", label: "今天新变化 · 脸颊发干" },
    ]);
  });

  it("keeps matching baseline concerns out of the indicator", () => {
    expect(getTodayNewChangeIndicators("鼻子有黑头，T区有点油", baseline, [])).toEqual([]);
  });

  it("does not repeat a concern-area already mentioned by the user today", () => {
    expect(getTodayNewChangeIndicators("脸颊还是有点干", baseline, ["脸颊有点干"])).toEqual([]);
  });
});
