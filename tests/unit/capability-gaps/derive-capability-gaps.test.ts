import { describe, expect, it } from "vitest";

import { deriveCapabilityGaps } from "@/server/domain/capability-gaps";

describe("deriveCapabilityGaps", () => {
  it("returns a sunscreen gap when no owned sunscreen exists", () => {
    expect(deriveCapabilityGaps(input({
      requiredRoles: ["cleanser", "moisturizer", "sunscreen"],
      selectedProducts: [
        selected("cleanser", "cleanser-a"),
        selected("moisturizer", "moisturizer-a"),
      ],
    }))).toEqual([expect.objectContaining({
      role: "sunscreen",
      reason: "NO_OWNED_PRODUCT",
      ownedProductIds: [],
    })]);
  });

  it("returns unavailable when the owned sunscreen is expired", () => {
    expect(deriveCapabilityGaps(input({
      requiredRoles: ["sunscreen"],
      excludedProducts: [{
        ...selected("sunscreen", "sunscreen-a"),
        reason: "PRODUCT_EXPIRED",
      }],
    }))).toEqual([expect.objectContaining({
      role: "sunscreen",
      reason: "ALL_PRODUCTS_UNAVAILABLE",
      ownedProductIds: ["sunscreen-a"],
    })]);
  });

  it("returns unknown when the selected product lacks ingredient data", () => {
    const sunscreen = selected("sunscreen", "sunscreen-a");

    expect(deriveCapabilityGaps(input({
      requiredRoles: ["sunscreen"],
      selectedProducts: [sunscreen],
      unknownProducts: [{
        ...sunscreen,
        reason: "INGREDIENT_DATA_UNKNOWN",
      }],
    }))).toEqual([expect.objectContaining({
      role: "sunscreen",
      reason: "INGREDIENT_DATA_UNKNOWN",
      ownedProductIds: ["sunscreen-a"],
    })]);
  });

  it("does not create a treatment gap when sensitivity intentionally removes it", () => {
    expect(deriveCapabilityGaps(input({
      requiredRoles: ["treatment"],
      excludedProducts: [{
        ...selected("treatment", "treatment-a"),
        reason: "HIGH_SENSITIVITY_REDUCE_ACTIVE",
      }],
    }))).toEqual([]);
  });

  it("returns no gaps when every required role has a known selected product", () => {
    expect(deriveCapabilityGaps(input({
      requiredRoles: ["cleanser", "moisturizer", "sunscreen"],
      selectedProducts: [
        selected("cleanser", "cleanser-a"),
        selected("moisturizer", "moisturizer-a"),
        selected("sunscreen", "sunscreen-a"),
      ],
    }))).toEqual([]);
  });

  it("distinguishes a role whose products are all safety-excluded", () => {
    expect(deriveCapabilityGaps(input({
      requiredRoles: ["moisturizer"],
      excludedProducts: [{
        ...selected("moisturizer", "moisturizer-a"),
        reason: "AVOID_INGREDIENT_MATCH",
      }],
    }))).toEqual([expect.objectContaining({
      role: "moisturizer",
      reason: "ALL_PRODUCTS_SAFETY_EXCLUDED",
    })]);
  });

  it("does not treat step-limit removal as an asset gap", () => {
    expect(deriveCapabilityGaps(input({
      requiredRoles: ["moisturizer"],
      excludedProducts: [{
        ...selected("moisturizer", "moisturizer-a"),
        reason: "STEP_LIMIT_REMOVED",
      }],
    }))).toEqual([]);
  });
});

function selected(
  role: "cleanser" | "moisturizer" | "sunscreen" | "treatment",
  ownedProductId: string,
) {
  return { role, ownedProductId } as const;
}

function input(
  overrides: Partial<Parameters<typeof deriveCapabilityGaps>[0]> = {},
): Parameters<typeof deriveCapabilityGaps>[0] {
  return {
    requiredRoles: [],
    selectedProducts: [],
    excludedProducts: [],
    unknownProducts: [],
    ...overrides,
  };
}
