import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createOwnedProductWithIdentitySchema } from "@/schemas/product-identity";

describe("identity boundary hardening", () => {
  it("defaults new identity-backed assets to active without requiring opened_at", () => {
    const result = createOwnedProductWithIdentitySchema.parse({
      resolution_kind: "catalog",
      brand_name: "Test",
      product_name: "Product",
      variant_name: null,
      barcode: null,
      category: "skincare",
      product_type: "serum",
      catalog_product_id: "20000000-0000-4000-8000-000000000001",
      confirmation_token: null,
      idempotency_key: "10000000-0000-4000-8000-000000000001",
      purchase_date: null,
      expires_on: null,
      quantity_remaining_percent: 100,
      notes: null,
    });

    expect(result.status).toBe("active");
    expect(result.opened_at).toBeNull();
  });

  it("rejects a forged external identity without a confirmation token", () => {
    const result = createOwnedProductWithIdentitySchema.safeParse({
      resolution_kind: "external", brand_name: "Test", product_name: "Product",
      variant_name: null, barcode: null, category: "skincare", product_type: "serum",
      catalog_product_id: null, confirmation_token: null,
      idempotency_key: "10000000-0000-4000-8000-000000000001",
      status: "unopened", purchase_date: null, opened_at: null, expires_on: null,
      quantity_remaining_percent: 100, notes: null,
    });
    expect(result.success).toBe(false);
  });

  it("uses an idempotent creation boundary without a retired knowledge bootstrap", async () => {
    const [migration, route] = await Promise.all([
      readFile(path.join(process.cwd(), "supabase/migrations/20260825000000_harden_identity_boundary.sql"), "utf8"),
      readFile(path.join(process.cwd(), "src/app/api/v1/owned-products/with-identity/route.ts"), "utf8"),
    ]);
    expect(migration).toContain("asset_creation_idempotency");
    expect(migration).toContain("create_owned_product_with_identity_idempotent");
    expect(route).not.toContain("createUserAssetKnowledgeSuggestion");
    expect(route).not.toContain("createRequestUserAssetKnowledgeEnrichmentService");
  });
});
