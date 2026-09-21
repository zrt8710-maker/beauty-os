import { describe, expect, it } from "vitest";

import { retrieveCareGuidance } from "@/server/services/care-guidance-retrieval-service";

describe("care guidance retrieval", () => {
  it("retrieves the core oily-baseline and localized dryness/flaking PM guidance", () => {
    const ids = retrieveCareGuidance({
      effectiveSkinState: [{ concern: "oiliness", provenance: "baseline_inherited" }, { concern: "dryness", provenance: "today_confirmed" }, { concern: "flaking", provenance: "today_confirmed" }],
      dailyDelta: [{ concern: "dryness" }, { concern: "flaking" }], period: "pm", weather: null, unknowns: [],
    }).map((item) => item.guidanceId);
    expect(ids).toEqual(expect.arrayContaining(["GUIDE-BASELINE-DELTA-01", "GUIDE-CLEANSE-01", "GUIDE-MOISTURE-01", "GUIDE-FLAKE-01", "GUIDE-OIL-01", "GUIDE-MIN-SUFFICIENT-01"]));
  });
  it("matches reactive, UV, and blemish contexts without turning them into treatment", () => {
    expect(retrieveCareGuidance({ effectiveSkinState: [{ concern: "redness" }, { concern: "stinging" }], dailyDelta: [{ concern: "redness" }], period: "pm", weather: null, unknowns: [] }).map((x) => x.guidanceId)).toContain("GUIDE-REACTIVE-01");
    expect(retrieveCareGuidance({ effectiveSkinState: [], dailyDelta: [], period: "am", weather: { uvIndex: 8 }, unknowns: [] }).map((x) => x.guidanceId)).toContain("GUIDE-WEATHER-01");
    expect(retrieveCareGuidance({ effectiveSkinState: [{ concern: "small_bumps" }], dailyDelta: [{ concern: "small_bumps" }], period: "pm", weather: null, unknowns: [] }).map((x) => x.guidanceId)).toContain("GUIDE-BLEMISH-01");
  });
});
