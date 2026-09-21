import { describe, expect, it } from "vitest";

import { buildHomeAttentionItems } from "@/features/home/home-attention-view-model";
import type { OwnedProduct } from "@/schemas/product";
import type { SkinProfileSuggestion } from "@/server/services/skin-profile-suggestion-service";

const suggestion: SkinProfileSuggestion = {
  id: "usual",
  kind: "add_usual_area",
  concern: "dryness",
  area: "cheeks",
  evidence_summary: "internal",
  strength: "moderate",
  window: { from: "2026-08-20", to: "2026-09-16" },
};

describe("Home Attention view model", () => {
  it("returns no items without qualifying assets or suggestions", () => {
    expect(build([])).toEqual([]);
  });

  it.each([
    ["2026-09-15", "asset_expired", "有产品已经到期"],
    ["2026-09-22", "asset_expiring_soon", "有产品快到期了"],
    ["2026-10-10", "asset_expiring_soon", "有产品进入临期阶段"],
  ] as const)("classifies %s against the supplied today", (expiresOn, kind, title) => {
    expect(build([asset({ expires_on: expiresOn })])[0]).toMatchObject({ kind, title });
  });

  it("ignores null expiry, excluded statuses, and empty products", () => {
    expect(build([
      asset({ expires_on: null }),
      asset({ id: "archived", status: "archived" }),
      asset({ id: "finished", status: "finished" }),
      asset({ id: "discarded", status: "discarded" }),
      asset({ id: "empty", quantity_remaining_percent: 0 }),
    ])).toEqual([]);
  });

  it("emits only the highest-severity aggregated asset item", () => {
    const items = build([
      asset({ id: "expired-a", expires_on: "2026-09-14" }),
      asset({ id: "expired-b", expires_on: "2026-09-15" }),
      asset({ id: "seven", expires_on: "2026-09-20" }),
      asset({ id: "thirty", expires_on: "2026-10-10" }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "asset_expired", description: "你有 2 件产品已经到期。" });
  });

  it("aggregates same-tier products instead of creating one card per asset", () => {
    const items = build([
      asset({ id: "one", expires_on: "2026-09-20" }),
      asset({ id: "two", expires_on: "2026-09-21" }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("你有 2 件产品将在 7 天内到期。");
  });

  it("uses the supplied Profile-timezone date rather than a hardcoded timezone", () => {
    const ownedProducts = [asset({ expires_on: "2026-09-16" })];
    expect(buildHomeAttentionItems({ today: "2026-09-15", ownedProducts, profileSuggestions: [] })[0].description).toContain("还有 1 天");
    expect(buildHomeAttentionItems({ today: "2026-09-16", ownedProducts, profileSuggestions: [] })[0].description).toContain("今天到期");
  });

  it("adds one profile suggestion after the asset item with the existing deep link", () => {
    const items = build([asset({ expires_on: "2026-09-20" })], [suggestion]);
    expect(items.map((item) => item.kind)).toEqual(["asset_expiring_soon", "profile_suggestion"]);
    expect(items[1]).toMatchObject({
      description: "最近几周，脸颊多次出现发干。",
      href: "/profile?suggestion=usual_area&concern=dryness&area=cheeks",
    });
    expect(items.map((item) => item.kind)).not.toContain("daily_skin_missing");
  });

  it("places one quantity check below expiry risk and above the profile suggestion", () => {
    const items = buildHomeAttentionItems({
      today: "2026-09-16",
      ownedProducts: [asset({ expires_on: "2026-09-20" })],
      profileSuggestions: [suggestion],
      quantityAttention: {
        owned_product_id: "asset",
        product_display_name: "雅诗兰黛 · 小棕瓶",
        current_recorded_quantity: 50,
        reason: "recent_usage_quantity_check",
      },
    });

    expect(items.map((item) => item.kind)).toEqual([
      "asset_expiring_soon",
      "inventory_quantity_check",
      "profile_suggestion",
    ]);
    expect(items[1]).toMatchObject({
      title: "要不要更新一下余量？",
      description: "最近常用的「雅诗兰黛 · 小棕瓶」，当前记录的余量可能需要更新。",
      actionLabel: "检查余量",
    });
    expect(items[1].description).not.toMatch(/使用了|预计|应该只剩/);
  });
});

function build(
  ownedProducts: TestAsset[],
  profileSuggestions: SkinProfileSuggestion[] = [],
) {
  return buildHomeAttentionItems({
    today: "2026-09-16",
    ownedProducts,
    profileSuggestions,
  });
}

function asset(overrides: Partial<TestAsset> = {}) {
  return { ...baseAsset(), ...overrides };
}

type TestAsset = {
  id: string;
  status: OwnedProduct["status"];
  expires_on: string | null;
  quantity_remaining_percent: number;
  product: {
    brand_name: string | null;
    product_name: string;
  };
};

function baseAsset(): TestAsset {
  return {
    id: "asset",
    status: "active" as OwnedProduct["status"],
    expires_on: "2026-09-20",
    quantity_remaining_percent: 50,
    product: {
      brand_name: "颐莲",
      product_name: "玻尿酸保湿喷雾",
    },
  };
}
