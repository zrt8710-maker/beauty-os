import { describe, expect, it } from "vitest";

import {
  productDraftConfirmationSchema,
  productDraftUpdateSchema,
} from "@/schemas/product-draft";

describe("product draft schema", () => {
  it("接受人工确认过且分类一致的产品信息", () => {
    expect(
      productDraftConfirmationSchema.safeParse({
        brand_name: "Beauty OS",
        product_name: "保湿精华",
        category: "skincare",
        subcategory: "face_care",
        product_type: "serum",
        notes: null,
      }).success,
    ).toBe(true);
  });

  it("拒绝非法分类值", () => {
    expect(
      productDraftUpdateSchema.safeParse({ category: "random_category" })
        .success,
    ).toBe(false);
  });

  it("拒绝彼此不匹配的分类组合", () => {
    expect(
      productDraftConfirmationSchema.safeParse({
        brand_name: null,
        product_name: "粉底液",
        category: "skincare",
        subcategory: "face_care",
        product_type: "foundation",
        notes: null,
      }).success,
    ).toBe(false);
  });
});
