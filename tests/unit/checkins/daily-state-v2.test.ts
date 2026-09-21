import { describe, expect, it } from "vitest";

import { dailyStateSchema } from "@/schemas/checkin";

describe("Daily Skin State v2", () => {
  it("continues to load a valid v1 daily state", () => {
    expect(dailyStateSchema.safeParse({ version: 1, summary: "鼻翼有点起皮", details: [{ area: "鼻翼", finding: "flaking", status: "present", description: "少量", source: ["legacy"] }] }).success).toBe(true);
  });

  it("validates a concern-led v2 state", () => {
    const result = dailyStateSchema.safeParse({ version: 2, summary: "鼻子下午比平时油很多，额头有不少小凸起。", concerns: [
      { kind: "oiliness", status: "present", areas: ["nose"], attributes: { severity: "moderate", duration: "part_day", baseline_comparison: "more_than_usual" }, user_wording: ["下午比平时油很多"], source: ["conversation"] },
      { kind: "small_bumps", status: "present", areas: ["forehead"], attributes: { amount: "many", distribution: "scattered" }, user_wording: ["闭口", "小凸起"], source: ["conversation"] },
      { kind: "blackheads", status: "present", areas: ["nose"], attributes: { amount: "several" }, user_wording: ["黑头"], source: ["conversation"] },
    ] });
    expect(result.success).toBe(true);
  });

  it("rejects irrelevant bounded attributes", () => {
    expect(dailyStateSchema.safeParse({ version: 2, summary: null, concerns: [{ kind: "redness", status: "present", areas: ["cheeks"], attributes: { amount: "many" }, user_wording: ["泛红"], source: ["conversation"] }] }).success).toBe(false);
  });
});
