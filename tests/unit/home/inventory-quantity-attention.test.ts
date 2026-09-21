import { describe, expect, it } from "vitest";

import { deriveInventoryQuantityAttention } from "@/features/home/inventory-quantity-attention";
import type { OwnedProduct } from "@/schemas/product";
import type { QuantityUsageRecord } from "@/server/repositories/usage-repository";

describe("Inventory quantity attention", () => {
  it("suggests a check for three recent explicit uses after the asset baseline spanning seven days", () => {
    expect(derive([asset()], usage("asset", "2026-09-08", "2026-09-12", "2026-09-15")))
      .toEqual({
        owned_product_id: "asset",
        product_display_name: "雅诗兰黛 · 小棕瓶",
        current_recorded_quantity: 50,
        reason: "recent_usage_quantity_check",
      });
  });

  it("does not remind for fewer than three uses", () => {
    expect(derive([asset()], usage("asset", "2026-09-08", "2026-09-15"))).toBeNull();
  });

  it("does not count usage on or before the asset updated date", () => {
    expect(derive(
      [asset({ updated_at: "2026-09-15T08:00:00.000Z" })],
      usage("asset", "2026-09-08", "2026-09-12", "2026-09-15"),
    )).toBeNull();
  });

  it("does not remind when records do not span seven days", () => {
    expect(derive([asset()], usage("asset", "2026-09-11", "2026-09-14", "2026-09-16"))).toBeNull();
  });

  it("does not remind when the latest record is older than seven days", () => {
    expect(derive([asset()], usage("asset", "2026-08-20", "2026-08-28", "2026-09-08"))).toBeNull();
  });

  it.each(["finished", "discarded", "archived"] as const)("excludes %s assets", (status) => {
    expect(derive([
      asset({ status, archived_at: status === "archived" ? "2026-09-10T00:00:00.000Z" : null }),
    ], usage("asset", "2026-09-08", "2026-09-12", "2026-09-15"))).toBeNull();
  });

  it("excludes assets recorded at zero quantity", () => {
    expect(derive(
      [asset({ quantity_remaining_percent: 0 })],
      usage("asset", "2026-09-08", "2026-09-12", "2026-09-15"),
    )).toBeNull();
  });

  it("selects one candidate by count, latest use, then stable owned-product id", () => {
    const selectedByCount = derive(
      [asset({ id: "a" }), asset({ id: "b" })],
      [
        ...usage("a", "2026-09-08", "2026-09-12", "2026-09-15"),
        ...usage("b", "2026-09-07", "2026-09-10", "2026-09-14", "2026-09-16"),
      ],
    );
    expect(selectedByCount?.owned_product_id).toBe("b");

    const selectedByLatest = derive(
      [asset({ id: "a" }), asset({ id: "b" })],
      [
        ...usage("a", "2026-09-07", "2026-09-11", "2026-09-14"),
        ...usage("b", "2026-09-08", "2026-09-12", "2026-09-15"),
      ],
    );
    expect(selectedByLatest?.owned_product_id).toBe("b");

    const selectedById = derive(
      [asset({ id: "b" }), asset({ id: "a" })],
      [
        ...usage("a", "2026-09-08", "2026-09-12", "2026-09-15"),
        ...usage("b", "2026-09-08", "2026-09-12", "2026-09-15"),
      ],
    );
    expect(selectedById?.owned_product_id).toBe("a");
  });

  it("treats a user quantity save as a new conservative baseline without changing quantity automatically", () => {
    const recentUsage = usage("asset", "2026-09-08", "2026-09-12", "2026-09-15");
    expect(derive([asset()], recentUsage)?.current_recorded_quantity).toBe(50);
    expect(derive([asset({ updated_at: "2026-09-16T08:00:00.000Z", quantity_remaining_percent: 75 })], recentUsage)).toBeNull();
  });
});

function derive(ownedProducts: TestAsset[], recentUsage: QuantityUsageRecord[]) {
  return deriveInventoryQuantityAttention({
    ownedProducts,
    recentUsage,
    timeZone: "Asia/Shanghai",
    today: "2026-09-16",
  });
}

type TestAsset = Pick<OwnedProduct, "id" | "status" | "archived_at" | "quantity_remaining_percent" | "updated_at"> & {
  product: Pick<OwnedProduct["product"], "brand_name" | "product_name">;
};

function asset(overrides: Partial<TestAsset> = {}): TestAsset {
  return {
    id: "asset",
    status: "active",
    archived_at: null,
    quantity_remaining_percent: 50,
    updated_at: "2026-09-01T00:00:00.000Z",
    product: { brand_name: "雅诗兰黛", product_name: "小棕瓶" },
    ...overrides,
  };
}

function usage(ownedProductId: string, ...dates: string[]): QuantityUsageRecord[] {
  return dates.map((usedDate) => ({ ownedProductId, usedDate }));
}
