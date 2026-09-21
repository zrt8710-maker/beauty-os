import { describe, expect, it } from "vitest";

import {
  formatSkinLevel,
  getSkinStatusSummary,
} from "@/features/check-in/skin-status-view-model";

describe("skin status view model", () => {
  it("优先展示等级最高的两项状态", () => {
    expect(
      getSkinStatusSummary({
        dryness_level: 2,
        oiliness_level: 3,
        redness_level: 1,
        sensitivity_level: 0,
        acne_level: 0,
        known_fields: ["dryness_level", "oiliness_level", "redness_level", "sensitivity_level", "acne_level"],
      }),
    ).toBe("出油明显 · 干燥一般");
  });

  it("所有状态均为零时展示稳定状态", () => {
    expect(
      getSkinStatusSummary({
        dryness_level: 0,
        oiliness_level: 0,
        redness_level: 0,
        sensitivity_level: 0,
        acne_level: 0,
        known_fields: ["dryness_level", "oiliness_level", "redness_level", "sensitivity_level", "acne_level"],
      }),
    ).toBe("状态稳定");
  });

  it("为有效等级和异常等级提供可读文案", () => {
    expect(formatSkinLevel(1)).toBe("轻微");
    expect(formatSkinLevel(4)).toBe("严重");
    expect(formatSkinLevel(8)).toBe("未知");
  });

  it("没有已记录字段时不把 unknown 描述为稳定", () => {
    expect(getSkinStatusSummary({
      dryness_level: 0, oiliness_level: 0, redness_level: 0,
      sensitivity_level: 0, acne_level: 0, known_fields: [],
    })).toBeNull();
  });
});
