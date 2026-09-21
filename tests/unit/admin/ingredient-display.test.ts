import { describe, expect, it } from "vitest";

import { displayIngredientName } from "@/features/admin/ingredient-display";

describe("Admin ingredient display", () => {
  it("uses a Chinese presentation name for common Japanese INCI evidence", () => {
    expect(displayIngredientName({ raw_name: "パルミチン酸", normalized_name: null })).toBe("棕榈酸");
    expect(displayIngredientName({ raw_name: "ミリスチン酸", normalized_name: null })).toBe("肉豆蔻酸");
    expect(displayIngredientName({ raw_name: "水酸化K", normalized_name: null })).toBe("氢氧化钾");
  });

  it("prefers an already-Chinese normalized name", () => {
    expect(displayIngredientName({ raw_name: "パルミチン酸", normalized_name: "棕榈酸（规范名）" })).toBe("棕榈酸（规范名）");
  });
});
