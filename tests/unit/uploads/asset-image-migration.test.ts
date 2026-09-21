import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260826010000_add_product_asset_image_foundation.sql"), "utf8");

describe("product asset image migration", () => {
  it("requires an override upload to belong to the same authenticated asset", () => {
    expect(migration).toContain("upload_assets.user_id = (select auth.uid())");
    expect(migration).toContain("upload_assets.owned_product_id = user_owned_products.id");
    expect(migration).toContain("upload_assets.status = 'ready'");
  });
});
