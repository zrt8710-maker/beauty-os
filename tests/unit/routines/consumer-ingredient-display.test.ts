import { describe, expect, it } from "vitest";

import { consumerIngredientDisplayNames } from "@/lib/consumer-ingredient-display";

describe("consumer ingredient display projection", () => {
  it("uses concise Chinese ingredient names and removes base ingredients", () => {
    expect(consumerIngredientDisplayNames([
      "Water", "Myristic Acid", "Propanediol", "Glycerin", "Decyl Glucoside", "Niacinamide",
    ])).toEqual(["甘油", "癸基葡糖苷"]);
  });

  it("does not pass an unmapped English INCI name through to consumer copy", () => {
    expect(consumerIngredientDisplayNames(["Unmapped Example INCI"])).toEqual([]);
  });
});
