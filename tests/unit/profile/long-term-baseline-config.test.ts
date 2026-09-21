import { describe, expect, it } from "vitest";

import { recurringTendencyGradingConcerns, usualIntensityLabel, usualIntensityOptions } from "@/features/profile/long-term-baseline-config";

describe("long-term baseline grading alignment", () => {
  it("uses the centralized Skin Grading labels for Profile usual intensity", () => {
    expect(usualIntensityOptions).toEqual([["slight", "轻微"], ["noticeable", "比较明显"], ["marked", "明显"], ["very_marked", "很明显"], ["unknown", "不确定"]]);
    expect(usualIntensityLabel("noticeable")).toBe("比较明显");
  });

  it("maps Profile help to the same centralized Daily concerns", () => {
    expect(recurringTendencyGradingConcerns("blackheads")).toEqual(["blackheads"]);
    expect(recurringTendencyGradingConcerns("small_bumps")).toEqual(["small_bumps"]);
  });

  it("keeps reactive discomfort mapped to the three existing Daily concerns", () => {
    expect(recurringTendencyGradingConcerns("reactive_discomfort")).toEqual(["stinging", "itching", "burning"]);
  });
});
