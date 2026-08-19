import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/db/database.types";

const migrationPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20260818010000_create_products.sql",
    import.meta.url,
  ),
);

describe("inventory migration 的 RLS 契约", () => {
  const sql = readFileSync(migrationPath, "utf8").toLowerCase();

  it("只创建 products 与 user_owned_products 并开启 RLS", () => {
    expect(sql.match(/create\s+table\s+/g)).toHaveLength(2);
    expect(sql).toContain("create table public.products");
    expect(sql).toContain("create table public.user_owned_products");
    expect(sql).toContain("alter table public.products enable row level security");
    expect(sql).toContain(
      "alter table public.user_owned_products enable row level security",
    );
    expect(sql).not.toContain("create type");
  });

  it("两个表的 CRUD policy 都基于 authenticated 与 auth.uid()", () => {
    for (const operation of ["select", "insert", "update", "delete"]) {
      expect(sql.match(new RegExp(`for ${operation}`, "g"))?.length).toBeGreaterThanOrEqual(2);
    }

    expect(sql.match(/to authenticated/g)?.length).toBeGreaterThanOrEqual(8);
    expect(sql.match(/select auth\.uid\(\)/g)?.length).toBeGreaterThanOrEqual(10);
    expect(sql).toContain("revoke all on table public.products from anon");
    expect(sql).toContain("revoke all on table public.user_owned_products from anon");
  });

  it("库存写入只能关联当前用户创建的产品", () => {
    expect(sql).toContain("products.created_by_user_id = (select auth.uid())");
    expect(sql).toContain("quantity_remaining_percent between 0 and 100");
  });
});

const testEnvironment = {
  url: process.env.SUPABASE_TEST_URL,
  key: process.env.SUPABASE_TEST_PUBLISHABLE_KEY,
  userAEmail: process.env.SUPABASE_TEST_USER_A_EMAIL,
  userAPassword: process.env.SUPABASE_TEST_USER_A_PASSWORD,
  userBEmail: process.env.SUPABASE_TEST_USER_B_EMAIL,
  userBPassword: process.env.SUPABASE_TEST_USER_B_PASSWORD,
};

const hasLiveTestEnvironment = Object.values(testEnvironment).every(Boolean);
const describeLive = hasLiveTestEnvironment ? describe : describe.skip;

describeLive("inventory 双用户 RLS 隔离（真实 Supabase）", () => {
  let clientA!: SupabaseClient<Database>;
  let clientB!: SupabaseClient<Database>;
  let userAId = "";
  let userBId = "";
  let productAId = "";
  let productBId = "";
  let ownedAId = "";
  let ownedBId = "";

  beforeAll(async () => {
    clientA = createClient<Database>(testEnvironment.url!, testEnvironment.key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    clientB = createClient<Database>(testEnvironment.url!, testEnvironment.key!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [sessionA, sessionB] = await Promise.all([
      clientA.auth.signInWithPassword({
        email: testEnvironment.userAEmail!,
        password: testEnvironment.userAPassword!,
      }),
      clientB.auth.signInWithPassword({
        email: testEnvironment.userBEmail!,
        password: testEnvironment.userBPassword!,
      }),
    ]);

    if (sessionA.error || sessionB.error) {
      throw new Error("RLS test users could not authenticate.");
    }

    userAId = sessionA.data.user.id;
    userBId = sessionB.data.user.id;

    const [productA, productB] = await Promise.all([
      clientA
        .from("products")
        .insert({
          product_name: "RLS Product A",
          category: "skincare",
          subcategory: "face_care",
          product_type: "serum",
          created_by_user_id: userAId,
        })
        .select("id")
        .single(),
      clientB
        .from("products")
        .insert({
          product_name: "RLS Product B",
          category: "makeup",
          subcategory: "base_makeup",
          product_type: "foundation",
          created_by_user_id: userBId,
        })
        .select("id")
        .single(),
    ]);

    if (productA.error || productB.error) {
      throw new Error("RLS test products could not be created.");
    }

    productAId = productA.data.id;
    productBId = productB.data.id;

    const [ownedA, ownedB] = await Promise.all([
      clientA
        .from("user_owned_products")
        .insert({ user_id: userAId, product_id: productAId })
        .select("id")
        .single(),
      clientB
        .from("user_owned_products")
        .insert({ user_id: userBId, product_id: productBId })
        .select("id")
        .single(),
    ]);

    if (ownedA.error || ownedB.error) {
      throw new Error("RLS test inventory could not be created.");
    }

    ownedAId = ownedA.data.id;
    ownedBId = ownedB.data.id;
  });

  afterAll(async () => {
    if (ownedAId && ownedBId) {
      await Promise.all([
        clientA.from("user_owned_products").delete().eq("id", ownedAId),
        clientB.from("user_owned_products").delete().eq("id", ownedBId),
      ]);
    }
    if (productAId && productBId) {
      await Promise.all([
        clientA.from("products").delete().eq("id", productAId),
        clientB.from("products").delete().eq("id", productBId),
      ]);
    }
    await Promise.all([clientA.auth.signOut(), clientB.auth.signOut()]);
  });

  it("两个用户不能互相读取产品和库存", async () => {
    const [aProduct, bProduct, aOwned, bOwned] = await Promise.all([
      clientA.from("products").select("id").eq("id", productBId),
      clientB.from("products").select("id").eq("id", productAId),
      clientA.from("user_owned_products").select("id").eq("id", ownedBId),
      clientB.from("user_owned_products").select("id").eq("id", ownedAId),
    ]);

    for (const result of [aProduct, bProduct, aOwned, bOwned]) {
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    }
  });

  it("两个用户不能互相修改产品和库存", async () => {
    const [aProduct, bProduct, aOwned, bOwned] = await Promise.all([
      clientA
        .from("products")
        .update({ product_name: "changed by A" })
        .eq("id", productBId)
        .select("id"),
      clientB
        .from("products")
        .update({ product_name: "changed by B" })
        .eq("id", productAId)
        .select("id"),
      clientA
        .from("user_owned_products")
        .update({ quantity_remaining_percent: 1 })
        .eq("id", ownedBId)
        .select("id"),
      clientB
        .from("user_owned_products")
        .update({ quantity_remaining_percent: 1 })
        .eq("id", ownedAId)
        .select("id"),
    ]);

    for (const result of [aProduct, bProduct, aOwned, bOwned]) {
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    }
  });

  it("用户不能把其他用户产品加入自己的库存", async () => {
    const attempt = await clientA.from("user_owned_products").insert({
      user_id: userAId,
      product_id: productBId,
    });

    expect(attempt.error).not.toBeNull();
  });
});
