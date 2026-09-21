import { describe, expect, it } from "vitest";

import type { OwnedProductWithProductRow } from "@/server/repositories/owned-product-repository";
import { emptyPlannerProductEvidence } from "@/server/services/planner-product-evidence-service";
import { baselineTypeBackedPurposesFor } from "@/server/services/rule-engine-service";

describe("baseline type-backed Today purposes", () => {
  it.each([
    ["cleanser", ["cleansing"]],
    ["moisturizer", ["basic_moisturization"]],
  ] as const)("allows confirmed %s identity only for its conservative baseline role", (productType, purposes) => {
    expect(baselineTypeBackedPurposesFor(owned(productType), emptyPlannerProductEvidence())).toEqual(purposes);
  });

  it.each(["sunscreen", "toner", "essence", "serum"] as const)("does not infer a purpose from confirmed %s type", (productType) => {
    expect(baselineTypeBackedPurposesFor(owned(productType), emptyPlannerProductEvidence())).toEqual([]);
  });

  it("does not trust a type from an unknown identity or a conflicting evidence identity", () => {
    expect(baselineTypeBackedPurposesFor(owned("cleanser", { identity_status: "unknown" }), emptyPlannerProductEvidence())).toEqual([]);
    expect(baselineTypeBackedPurposesFor(owned("cleanser"), { ...emptyPlannerProductEvidence(), productType: "moisturizer" })).toEqual([]);
  });
});

function owned(
  productType: "cleanser" | "moisturizer" | "sunscreen" | "toner" | "essence" | "serum",
  patch: Partial<OwnedProductWithProductRow["product"]> = {},
) {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    user_id: "user",
    product_id: "20000000-0000-4000-8000-000000000001",
    status: "active",
    purchase_date: null,
    opened_at: null,
    expires_on: null,
    quantity_remaining_percent: 80,
    notes: null,
    archived_at: null,
    created_at: "2026-09-12T00:00:00.000Z",
    updated_at: "2026-09-12T00:00:00.000Z",
    product: {
      id: "20000000-0000-4000-8000-000000000001",
      brand_name: "Test",
      product_name: "Known identity",
      variant_name: null,
      barcode: null,
      identity_status: "matched",
      category: "skincare",
      subcategory: "face_care",
      product_type: productType,
      catalog_product_id: "30000000-0000-4000-8000-000000000001",
      created_by_user_id: "user",
      created_at: "2026-09-12T00:00:00.000Z",
      updated_at: "2026-09-12T00:00:00.000Z",
      ...patch,
    },
  } as OwnedProductWithProductRow;
}
