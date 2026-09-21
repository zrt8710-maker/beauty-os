import { describe, expect, it } from "vitest";

import { buildTodayObservationSummary } from "@/features/skin-conversation/today-observation-summary";

describe("today observation summary", () => {
  it("uses only confirmed daily-state facts and keeps the chat result concise", () => {
    const summary = buildTodayObservationSummary({
      version: 2,
      summary: null,
      concerns: [
        { kind: "oiliness", status: "present", areas: ["t_zone"], attributes: { baseline_comparison: "usual" }, user_wording: ["和平时差不多"], source: ["conversation"] },
        { kind: "dryness", status: "present", areas: ["cheeks"], attributes: { baseline_comparison: "new" }, user_wording: ["摸起来粗糙"], source: ["conversation"] },
      ],
    });
    expect(summary).toEqual([
      "T区出油和长期记录的状态基本一致。",
      "脸颊发干是今天新留意到的变化。",
      "接下来可继续观察脸颊发干有没有变化。",
    ]);
    expect(summary).toHaveLength(3);
  });

  it("does not invent a summary for unrecorded symptoms", () => {
    expect(buildTodayObservationSummary({ version: 2, summary: null, concerns: [] })).toEqual([]);
  });
});
