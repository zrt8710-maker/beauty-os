import { describe, expect, it } from "vitest";

import {
  ownedProductCreateSchema,
  ownedProductUpdateSchema,
  productCreateSchema,
  productSchema,
} from "@/schemas/product";

const validOwnedProduct = {
  product_id: "10000000-0000-4000-8000-000000000001",
  status: "active",
  purchase_date: "2026-08-01",
  opened_at: "2026-08-10",
  quantity_remaining_percent: 50,
  notes: "晚间使用",
};

describe("product schemas", () => {
  it("接受稳定的产品分类与对应产品类型", () => {
    expect(
      productCreateSchema.safeParse({
        brand_name: "Beauty OS",
        product_name: "保湿精华",
        category: "skincare",
        product_type: "serum",
      }).success,
    ).toBe(true);
  });

  it("拒绝大类与产品类型不一致以及身份字段", () => {
    const mismatched = productCreateSchema.safeParse({
      brand_name: null,
      product_name: "粉底液",
      category: "skincare",
      product_type: "foundation",
    });
    const impersonation = productCreateSchema.safeParse({
      brand_name: null,
      product_name: "洁面",
      category: "skincare",
      product_type: "cleanser",
      created_by_user_id: "user-b",
    });

    expect(mismatched.success).toBe(false);
    expect(impersonation.success).toBe(false);
  });

  it("接受 Supabase 返回的带时区偏移的产品时间戳", () => {
    expect(
      productSchema.safeParse({
        id: "10000000-0000-4000-8000-000000000001",
        brand_name: null,
        product_name: "保湿洁面乳",
        category: "skincare",
        subcategory: "face_care",
        product_type: "cleanser",
        created_at: "2026-08-19T10:00:00+00:00",
        updated_at: "2026-08-19T10:00:00+00:00",
      }).success,
    ).toBe(true);
  });

  it("quantity_remaining_percent 接受 0 和 100 边界", () => {
    expect(
      ownedProductCreateSchema.safeParse({
        ...validOwnedProduct,
        quantity_remaining_percent: 0,
      }).success,
    ).toBe(true);
    expect(
      ownedProductCreateSchema.safeParse({
        ...validOwnedProduct,
        quantity_remaining_percent: 100,
      }).success,
    ).toBe(true);
  });

  it("quantity_remaining_percent 拒绝越界值和小数", () => {
    for (const quantity of [-1, 100.5, 101]) {
      expect(
        ownedProductUpdateSchema.safeParse({
          quantity_remaining_percent: quantity,
        }).success,
      ).toBe(false);
    }
  });

  it("拒绝开封日期早于购买日期", () => {
    const result = ownedProductCreateSchema.safeParse({
      ...validOwnedProduct,
      purchase_date: "2026-08-10",
      opened_at: "2026-08-01",
    });

    expect(result.success).toBe(false);
  });
});
