import { describe, expect, it } from "vitest";

import {
  filterProductsForSafety,
  type ProductSafetyIngredientData,
} from "@/server/domain/product-safety";

describe("filterProductsForSafety", () => {
  it("excludes a product that matches a user avoid ingredient", () => {
    const product = candidate("unsafe", "catalog-unsafe");
    const result = filterProductsForSafety(input({
      products: [product],
      avoidIngredients: ["Parfum"],
      ingredientDataByCatalogProductId: ingredientMap([
        ["catalog-unsafe", ingredients("Fragrance", ["Parfum"])],
      ]),
    }));

    expect(result.eligibleProducts).toEqual([]);
    expect(result.excludedProducts).toEqual([expect.objectContaining({
      productId: product.product_id,
      ownedProductId: product.id,
      reason: "AVOID_INGREDIENT_MATCH",
      matchedAvoidIngredients: ["Parfum"],
    })]);
  });

  it("keeps a product with unknown ingredients eligible and records unknown", () => {
    const product = candidate("manual", null);
    const result = filterProductsForSafety(input({ products: [product] }));

    expect(result.eligibleProducts).toEqual([product]);
    expect(result.excludedProducts).toEqual([]);
    expect(result.unknownProducts).toEqual([expect.objectContaining({
      productId: product.product_id,
      reason: "INGREDIENT_DATA_UNKNOWN",
    })]);
  });

  it("keeps a verified product without an avoid match eligible for scoring", () => {
    const product = candidate("safe", "catalog-safe");
    const result = filterProductsForSafety(input({
      products: [product],
      avoidIngredients: ["Parfum"],
      ingredientDataByCatalogProductId: ingredientMap([
        ["catalog-safe", ingredients("Glycerin")],
      ]),
    }));

    expect(result).toEqual({
      eligibleProducts: [product],
      excludedProducts: [],
      unknownProducts: [],
    });
  });

  it("does not infer or exclude an unset or future explicit expiry date", () => {
    const unset = candidate("unset-expiry", null);
    const future = candidate("future-expiry", null, { expires_on: "2026-08-20" });

    const result = filterProductsForSafety(input({ products: [unset, future] }));

    expect(result.eligibleProducts).toEqual([unset, future]);
    expect(result.excludedProducts).toEqual([]);
  });

  it("treats historical unopened and active assets as equally eligible", () => {
    const active = candidate("active", null, { status: "active" });
    const unopened = candidate("legacy-unopened", null, { status: "unopened" });

    const result = filterProductsForSafety(input({ products: [active, unopened] }));

    expect(result.eligibleProducts).toEqual([active, unopened]);
    expect(result.excludedProducts).toEqual([]);
  });

  it.each([
    ["archived", candidate("archived", null, { status: "archived" }), "PRODUCT_ARCHIVED"],
    ["finished", candidate("finished", null, { status: "finished" }), "PRODUCT_FINISHED"],
    ["inactive", candidate("inactive", null, { status: "paused" }), "PRODUCT_NOT_ACTIVE"],
    ["empty", candidate("empty", null, { quantity_remaining_percent: 0 }), "PRODUCT_EMPTY"],
    ["expired", candidate("expired", null, { expires_on: "2026-08-18" }), "PRODUCT_EXPIRED"],
  ])("preserves the existing %s exclusion", (_label, product, reason) => {
    const result = filterProductsForSafety(input({ products: [product] }));

    expect(result.excludedProducts[0].reason).toBe(reason);
    expect(result.eligibleProducts).toEqual([]);
  });

  it("preserves the recent high-reaction hard block", () => {
    const product = candidate("reactive", null);
    const result = filterProductsForSafety(input({
      products: [product],
      feedbackStats: new Map([[
        product.id,
        { highReactionCount: 3 },
      ]]),
    }));

    expect(result.excludedProducts[0].reason).toBe(
      "RECENT_HIGH_REACTION_HARD_BLOCK",
    );
  });
});

type Candidate = ReturnType<typeof candidate>;

function input(
  override: Partial<Parameters<typeof filterProductsForSafety<Candidate>>[0]> = {},
): Parameters<typeof filterProductsForSafety<Candidate>>[0] {
  return {
    products: [],
    routineDate: "2026-08-19",
    feedbackStats: new Map(),
    assessIngredients: true,
    avoidIngredients: [],
    ingredientDataByCatalogProductId: new Map(),
    ...override,
  };
}

function candidate(
  id: string,
  catalogProductId: string | null,
  override: Partial<{
    status: string;
    archived_at: string | null;
    expires_on: string | null;
    quantity_remaining_percent: number;
  }> = {},
) {
  return {
    id: `owned-${id}`,
    product_id: `product-${id}`,
    status: "active",
    archived_at: null,
    expires_on: null,
    quantity_remaining_percent: 80,
    product: { catalog_product_id: catalogProductId },
    ...override,
  };
}

function ingredients(
  inciName: string,
  aliases: string[] = [],
): ProductSafetyIngredientData {
  return {
    reliable: true,
    ingredients: [{ inciName, displayName: null, aliases }],
  };
}

function ingredientMap(
  entries: Array<[string, ProductSafetyIngredientData]>,
) {
  return new Map(entries);
}
