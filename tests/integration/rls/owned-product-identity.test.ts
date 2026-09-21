import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/db/database.types";

const sql = readFileSync(
  fileURLToPath(
    new URL(
      "../../../supabase/migrations/20260820000000_create_owned_product_with_identity.sql",
      import.meta.url,
    ),
  ),
  "utf8",
).toLowerCase();
const identityPersistenceSql = readFileSync(
  fileURLToPath(
    new URL(
      "../../../supabase/migrations/20260824020000_add_product_identity_persistence.sql",
      import.meta.url,
    ),
  ),
  "utf8",
).toLowerCase();
const confirmedCatalogIdentitySql = readFileSync(
  fileURLToPath(
    new URL(
      "../../../supabase/migrations/20260912000000_allow_confirmed_catalog_identity_owned_product.sql",
      import.meta.url,
    ),
  ),
  "utf8",
).toLowerCase();

describe("manual product identity creation migration", () => {
  it("keeps the historical verified-boundary migration intact", () => {
    expect(sql).toContain("auth.uid() is distinct from p_user_id");
    expect(sql).toContain("where id = p_catalog_product_id\n      and status = 'verified'");
    expect(sql).toContain("status = 'verified'");
    expect(sql).toContain("find_verified_catalog_products_by_identity");
    expect(sql).toContain("catalog_identity_mismatch");
  });

  it("uses catalog identity fields instead of user classification when linked", () => {
    expect(sql).toContain("catalog_record.brand_name");
    expect(sql).toContain("catalog_record.product_name");
    expect(sql).toContain("catalog_record.category");
    expect(sql).toContain("catalog_record.subcategory");
    expect(sql).toContain("catalog_record.product_type");
    expect(sql).toContain("catalog_record.id");
  });

  it("keeps both inserts in one PostgreSQL transaction without swallowing failures", () => {
    expect(sql).toContain("insert into public.products");
    expect(sql).toContain("insert into public.user_owned_products");
    expect(sql).not.toContain("exception when");
    expect(sql).toContain("security invoker");
  });
});

describe("confirmed Catalog identity asset creation migration", () => {
  it("accepts confirmed candidate or verified identities while preserving identity checks", () => {
    expect(confirmedCatalogIdentitySql).toContain("status in ('candidate', 'verified')");
    expect(confirmedCatalogIdentitySql).not.toContain("verified_catalog_candidate_not_found");
    expect(confirmedCatalogIdentitySql).toContain("confirmed_catalog_identity_not_found");
    expect(confirmedCatalogIdentitySql).toContain("catalog_identity_mismatch");
    expect(confirmedCatalogIdentitySql).toContain("normalize_product_match_text(catalog_record.brand_name)");
    expect(confirmedCatalogIdentitySql).toContain("catalog_record.product_type");
  });
});

describe("product identity persistence migration", () => {
  it("adds nullable variant and non-unique barcode plus constrained status", () => {
    expect(identityPersistenceSql).toContain("add column variant_name text");
    expect(identityPersistenceSql).toContain("add column barcode text");
    expect(identityPersistenceSql).not.toMatch(/unique\s*\([^)]*barcode/);
    expect(identityPersistenceSql).toContain(
      "add column identity_status text not null default 'unknown'",
    );
    expect(identityPersistenceSql).toContain(
      "identity_status in ('matched', 'unknown')",
    );
  });

  it("derives identity status from resolution kind and never accepts it as input", () => {
    expect(identityPersistenceSql).toContain("p_resolution_kind text");
    expect(identityPersistenceSql).not.toContain("p_identity_status");
    expect(identityPersistenceSql).toContain(
      "when p_resolution_kind in ('catalog', 'external') then 'matched'",
    );
    expect(identityPersistenceSql).toContain("else 'unknown'");
    expect(identityPersistenceSql).toContain(
      "revoke insert, update on table public.products from authenticated",
    );
    const directInsertGrant = identityPersistenceSql.match(
      /grant insert \([\s\S]*?\) on table public\.products to authenticated/,
    )?.[0];
    const directUpdateGrant = identityPersistenceSql.match(
      /grant update \([\s\S]*?\) on table public\.products to authenticated/,
    )?.[0];
    expect(directInsertGrant).not.toContain("identity_status");
    expect(directUpdateGrant).not.toContain("identity_status");
    expect(identityPersistenceSql).toContain("security definer");
  });

  it("persists canonical catalog identity and submitted external identity", () => {
    expect(identityPersistenceSql).toContain("catalog_record.variant_name");
    expect(identityPersistenceSql).toContain("catalog_record.barcode");
    expect(identityPersistenceSql).toContain("p_variant_name");
    expect(identityPersistenceSql).toContain("p_barcode");
    expect(identityPersistenceSql).toContain("resolved_identity_status");
  });

  it("keeps product and asset creation atomic", () => {
    expect(identityPersistenceSql).toContain("insert into public.products");
    expect(identityPersistenceSql).toContain(
      "insert into public.user_owned_products",
    );
    expect(identityPersistenceSql).not.toContain("exception when");
  });
});

const testEnvironment = {
  url: process.env.SUPABASE_TEST_URL,
  key: process.env.SUPABASE_TEST_PUBLISHABLE_KEY,
  email: process.env.SUPABASE_TEST_USER_A_EMAIL,
  password: process.env.SUPABASE_TEST_USER_A_PASSWORD,
};
const describeLive = Object.values(testEnvironment).every(Boolean)
  ? describe
  : describe.skip;

describeLive("manual identity creation atomic transaction（真实 Supabase）", () => {
  let client!: SupabaseClient<Database>;
  let userId = "";
  let createdProductId = "";
  let createdOwnedProductId = "";
  const manualName = `Manual Identity ${crypto.randomUUID()}`;
  const rollbackName = `Rollback Identity ${crypto.randomUUID()}`;
  const forgedStatusName = `Forged Identity ${crypto.randomUUID()}`;

  beforeAll(async () => {
    client = createClient<Database>(testEnvironment.url!, testEnvironment.key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const session = await client.auth.signInWithPassword({
      email: testEnvironment.email!,
      password: testEnvironment.password!,
    });
    if (session.error) throw new Error("RLS test user could not authenticate.");
    userId = session.data.user.id;
  });

  afterAll(async () => {
    if (createdOwnedProductId) {
      await client.from("user_owned_products").delete().eq("id", createdOwnedProductId);
    }
    if (createdProductId) {
      await client.from("products").delete().eq("id", createdProductId);
    }
    await client.auth.signOut();
  });

  it("creates a manual product and owned product together", async () => {
    const result = await client
      .rpc(
        "create_owned_product_with_identity",
        rpcInput(userId, manualName, "unopened") as never,
      )
      .select("id, product_id")
      .single();

    expect(result.error).toBeNull();
    createdOwnedProductId = result.data!.id;
    createdProductId = result.data!.product_id;

    const product = await client
      .from("products")
      .select("product_name, variant_name, barcode, identity_status, product_type, catalog_product_id")
      .eq("id", createdProductId)
      .single();
    expect(product.data).toEqual({
      product_name: manualName,
      variant_name: "30 ml",
      barcode: "4006381333931",
      identity_status: "unknown",
      product_type: "serum",
      catalog_product_id: null,
    });
  });

  it("rolls back the product insert when owned-product creation fails", async () => {
    const result = await client.rpc(
      "create_owned_product_with_identity",
      rpcInput(userId, rollbackName, "invalid_status") as never,
    );
    const products = await client
      .from("products")
      .select("id")
      .eq("product_name", rollbackName);

    expect(result.error).not.toBeNull();
    expect(products.error).toBeNull();
    expect(products.data).toEqual([]);
  });

  it("rejects direct client writes to identity_status", async () => {
    const result = await client.from("products").insert({
      brand_name: "Forged Brand",
      product_name: forgedStatusName,
      category: "skincare",
      subcategory: "face_care",
      product_type: "serum",
      identity_status: "matched",
      created_by_user_id: userId,
    });

    expect(result.error).not.toBeNull();
  });
});

function rpcInput(userId: string, productName: string, status: string) {
  return {
    p_user_id: userId,
    p_resolution_kind: "unknown",
    p_brand_name: "Manual Brand",
    p_product_name: productName,
    p_variant_name: "30 ml",
    p_barcode: "4006381333931",
    p_category: "skincare",
    p_subcategory: "face_care",
    p_product_type: "serum",
    p_catalog_product_id: null,
    p_status: status,
    p_purchase_date: null,
    p_opened_at: null,
    p_expires_on: null,
    p_quantity_remaining_percent: 100,
    p_notes: null,
  };
}
