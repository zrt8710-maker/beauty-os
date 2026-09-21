import { describe, expect, it } from "vitest";

import type { EffectiveDailySkinState } from "@/features/check-in/effective-daily-skin-state";
import { consumerAreaLabel, consumerConcernLabel } from "@/features/today/consumer-skin-labels";
import { describeEffectiveTodaySkin } from "@/features/today/effective-today-skin-context";

const concernLabels = {
  blemishes: "痘痘",
  stinging: "刺痛",
  itching: "发痒",
  burning: "灼热",
  dullness: "暗沉",
  uneven_tone: "肤色不均",
  post_blemish_marks: "痘印",
} as const;

describe("Today consumer skin labels", () => {
  it.each(Object.entries(concernLabels))("maps %s without exposing its raw enum", (value, expected) => {
    const label = consumerConcernLabel(value);
    expect(label).toBe(expected);
    expect(label).not.toContain(value);
  });

  it("uses safe fallback labels for unknown taxonomy values", () => {
    expect(consumerConcernLabel("future_internal_concern")).toBe("皮肤状态");
    expect(consumerAreaLabel("future_internal_area")).toBe("局部");
  });

  it("does not leak concern or area enums through effective Today context", () => {
    const state = {
      items: [],
      todayOverrides: [{
        key: "blemishes:hairline",
        concern: "blemishes",
        area: "hairline",
        status: "present",
        grade: null,
        baselineComparison: "new",
        provenance: "today_confirmed",
        todayConcern: null,
      }],
      inheritedBaseline: [{
        key: "uneven_tone:eye_area",
        concern: "uneven_tone",
        area: "eye_area",
        status: "present",
        grade: null,
        baselineComparison: null,
        provenance: "baseline_inherited",
        todayConcern: null,
      }],
    } as EffectiveDailySkinState;

    const copy = describeEffectiveTodaySkin(state);
    expect(copy).toContain("发际线出现痘痘");
    expect(copy).toContain("眼周肤色不均");
    expect(copy).not.toMatch(/blemishes|uneven_tone|hairline|eye_area/u);
  });
});
