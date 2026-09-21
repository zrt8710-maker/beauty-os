import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/db/database.types";

const migration = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/20260818050000_create_routines.sql", import.meta.url)),
  "utf8",
).toLowerCase();

const enhancementMigration = readFileSync(
  fileURLToPath(new URL(
    "../../../supabase/migrations/20260818051000_enhance_routine_rules.sql",
    import.meta.url,
  )),
  "utf8",
).toLowerCase();

describe("routine migration contract", () => {
  it("routines 与 routine_steps 都启用 owner-only RLS", () => {
    for (const table of ["routines", "routine_steps"]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`revoke all on table public.${table} from anon`);
    }
    expect(migration).toContain("routines.user_id = (select auth.uid())");
  });

  it("步骤必须关联当前用户拥有的产品", () => {
    expect(migration).toContain("user_owned_products.id = routine_steps.owned_product_id");
    expect(migration).toContain("user_owned_products.user_id = (select auth.uid())");
    expect(migration).toContain("routine_contains_unowned_product");
  });

  it("重复生成使用受限的原子 RPC", () => {
    expect(migration).toContain("create or replace function public.replace_daily_routine");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("revoke all on function public.replace_daily_routine");
  });

  it("增强 migration 保存排除产品、reason code 与评分明细", () => {
    expect(enhancementMigration).toContain("add column excluded_products jsonb");
    expect(enhancementMigration).toContain("add column reason_code text");
    expect(enhancementMigration).toContain("add column score_breakdown jsonb");
    expect(enhancementMigration).toContain("'makeup_remover'");
    expect(enhancementMigration).toContain("p_excluded_products jsonb");
    expect(enhancementMigration).toContain("routine_excludes_unowned_product");
    expect(enhancementMigration).toContain("set search_path = ''");
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

const describeLive = Object.values(testEnvironment).every(Boolean) ? describe : describe.skip;
const liveDate = createIsolatedTestDate();

describeLive("routine 双用户隔离（真实 Supabase）", () => {
  let clientA!: SupabaseClient<Database>;
  let clientB!: SupabaseClient<Database>;
  let userAId = "";
  let userBId = "";
  let productAId = "";
  let productBId = "";
  let ownedAId = "";
  let ownedBId = "";
  let routineAId = "";

  beforeAll(async () => {
    clientA = createClient<Database>(testEnvironment.url!, testEnvironment.key!, { auth: { persistSession: false, autoRefreshToken: false } });
    clientB = createClient<Database>(testEnvironment.url!, testEnvironment.key!, { auth: { persistSession: false, autoRefreshToken: false } });
    const [sessionA, sessionB] = await Promise.all([
      clientA.auth.signInWithPassword({ email: testEnvironment.userAEmail!, password: testEnvironment.userAPassword! }),
      clientB.auth.signInWithPassword({ email: testEnvironment.userBEmail!, password: testEnvironment.userBPassword! }),
    ]);
    if (sessionA.error || sessionB.error) throw new Error("Routine RLS users could not authenticate.");
    userAId = sessionA.data.user.id;
    userBId = sessionB.data.user.id;

    const [productA, productB] = await Promise.all([
      clientA.from("products").insert(productInput(userAId, "A")).select("id").single(),
      clientB.from("products").insert(productInput(userBId, "B")).select("id").single(),
    ]);
    if (productA.error || productB.error) throw new Error("Routine RLS products could not be created.");
    productAId = productA.data.id;
    productBId = productB.data.id;

    const [ownedA, ownedB] = await Promise.all([
      clientA.from("user_owned_products").insert(ownedInput(userAId, productAId)).select("id").single(),
      clientB.from("user_owned_products").insert(ownedInput(userBId, productBId)).select("id").single(),
    ]);
    if (ownedA.error || ownedB.error) throw new Error("Routine RLS inventory could not be created.");
    ownedAId = ownedA.data.id;
    ownedBId = ownedB.data.id;

    const [routineA, routineB] = await Promise.all([
      createLiveRoutine(clientA, ownedAId),
      createLiveRoutine(clientB, ownedBId),
    ]);
    if (routineA.error || routineB.error) throw new Error("Routine RLS fixtures could not be generated.");
    routineAId = routineA.data!;
  });

  afterAll(async () => {
    await Promise.all([
      clientA.from("routines").delete().eq("routine_date", liveDate),
      clientB.from("routines").delete().eq("routine_date", liveDate),
    ]);
    await Promise.all([
      clientA.from("user_owned_products").delete().eq("id", ownedAId),
      clientB.from("user_owned_products").delete().eq("id", ownedBId),
    ]);
    await Promise.all([
      clientA.from("products").delete().eq("id", productAId),
      clientB.from("products").delete().eq("id", productBId),
    ]);
    await Promise.all([clientA.auth.signOut(), clientB.auth.signOut()]);
  });

  it("两个用户不能互相读取方案", async () => {
    const [fromA, fromB] = await Promise.all([
      clientA.from("routines").select("id").eq("user_id", userBId),
      clientB.from("routines").select("id").eq("user_id", userAId),
    ]);
    expect(fromA.error).toBeNull();
    expect(fromB.error).toBeNull();
    expect(fromA.data).toEqual([]);
    expect(fromB.data).toEqual([]);
  });

  it("用户不能把其他用户库存关联到自己的方案", async () => {
    const result = await clientA.from("routine_steps").insert({
      routine_id: routineAId,
      owned_product_id: ownedBId,
      step_order: 2,
      role: "moisturizer",
      reason: "cross-user-test",
      score: 50,
    });
    expect(result.error).not.toBeNull();
  });
});

function productInput(userId: string, suffix: string) {
  return {
    brand_name: "RLS",
    product_name: `Routine test ${suffix}`,
    category: "skincare",
    subcategory: "face_care",
    product_type: "cleanser",
    created_by_user_id: userId,
  };
}

function ownedInput(userId: string, productId: string) {
  return {
    user_id: userId,
    product_id: productId,
    status: "active",
    quantity_remaining_percent: 100,
  };
}

function createLiveRoutine(client: SupabaseClient<Database>, ownedProductId: string) {
  return client.rpc("replace_daily_routine", {
    p_routine_date: liveDate,
    p_period: "am",
    p_skin_snapshot: {},
    p_weather_snapshot: {},
    p_decision_snapshot: { version: 1 },
    p_excluded_products: [],
    p_steps: [{
      owned_product_id: ownedProductId,
      step_order: 1,
      role: "cleanser",
      reason: "RLS test",
      reason_code: "BASE_ROUTINE_SELECTED",
      score: 50,
      score_breakdown: {
        base: 40,
        skin_fit: 0,
        weather_fit: 0,
        recent_feedback: 0,
        inventory_priority: 10,
      },
    }],
  });
}

function createIsolatedTestDate() {
  const randomDayOffset =
    Number.parseInt(crypto.randomUUID().replaceAll("-", "").slice(0, 8), 16) %
    36_500;

  return new Date(
    Date.UTC(2100, 0, 1) + randomDayOffset * 24 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10);
}
