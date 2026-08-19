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
});
