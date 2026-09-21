import { describe, expect, it } from "vitest";

import { skinCheckinInputSchema } from "@/schemas/checkin";

const validInput = {
  dryness_level: 1,
  oiliness_level: 2,
  redness_level: 3,
  sensitivity_level: 4,
  acne_level: 0,
  notes: null,
  recorded_date: "2026-08-18",
  known_fields: ["dryness_level", "oiliness_level", "redness_level", "sensitivity_level", "acne_level"],
  field_provenance: {
    dryness_level: ["manual"], oiliness_level: ["manual"], redness_level: ["manual"], sensitivity_level: ["manual"], acne_level: ["manual"],
  },
};

describe("skin checkin schema", () => {
  it("接受 0 到 4 的整数等级", () => {
    expect(skinCheckinInputSchema.safeParse(validInput).success).toBe(true);
  });

  it.each([-1, 5, 1.5])("拒绝范围外或非整数等级 %s", (level) => {
    expect(
      skinCheckinInputSchema.safeParse({
        ...validInput,
        dryness_level: level,
      }).success,
    ).toBe(false);
  });

  it("拒绝客户端 user_id", () => {
    expect(
      skinCheckinInputSchema.safeParse({ ...validInput, user_id: "user-b" })
        .success,
    ).toBe(false);
  });

  it("允许只确认一个字段，并保留其余字段为 unknown", () => {
    expect(skinCheckinInputSchema.safeParse({
      ...validInput,
      known_fields: ["dryness_level"],
      field_provenance: { dryness_level: ["manual"] },
    }).success).toBe(true);
  });

  it("拒绝 unknown 字段的来源和不支持的来源", () => {
    expect(skinCheckinInputSchema.safeParse({
      ...validInput,
      known_fields: [],
      field_provenance: { dryness_level: ["manual"] },
    }).success).toBe(false);
    expect(skinCheckinInputSchema.safeParse({
      ...validInput,
      field_provenance: { dryness_level: ["provider"] },
    }).success).toBe(false);
  });
});
