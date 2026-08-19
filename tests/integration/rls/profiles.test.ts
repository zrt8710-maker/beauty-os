import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/db/database.types";

const migrationPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20260818000000_create_profiles.sql",
    import.meta.url,
  ),
);

describe("profiles migration 的 RLS 契约", () => {
  const sql = readFileSync(migrationPath, "utf8").toLowerCase();

  it("只创建 profiles 一张业务表并开启 RLS", () => {
    expect(sql.match(/create\s+table\s+/g)).toHaveLength(1);
    expect(sql).toContain("create table public.profiles");
    expect(sql).toContain("alter table public.profiles enable row level security");
  });

  it("所有 CRUD policy 都限定 authenticated 与 auth.uid()", () => {
    for (const operation of ["select", "insert", "update", "delete"]) {
      expect(sql).toContain(`for ${operation}`);
    }

    expect(sql.match(/to authenticated/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql.match(/select auth\.uid\(\)/g)?.length).toBeGreaterThanOrEqual(5);
    expect(sql).toContain("revoke all on table public.profiles from anon");
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

describeLive("profiles 双用户 RLS 隔离（真实 Supabase）", () => {
  let clientA!: SupabaseClient<Database>;
  let clientB!: SupabaseClient<Database>;
  let userAId = "";
  let userBId = "";

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

    await Promise.all([
      clientA
        .from("profiles")
        .update({ display_name: "RLS user A" })
        .eq("user_id", userAId),
      clientB
        .from("profiles")
        .update({ display_name: "RLS user B" })
        .eq("user_id", userBId),
    ]);
  });

  afterAll(async () => {
    await Promise.all([clientA.auth.signOut(), clientB.auth.signOut()]);
  });

  it("两个用户不能互相读取 profile", async () => {
    const [aReadsB, bReadsA] = await Promise.all([
      clientA.from("profiles").select("user_id").eq("user_id", userBId),
      clientB.from("profiles").select("user_id").eq("user_id", userAId),
    ]);

    expect(aReadsB.error).toBeNull();
    expect(bReadsA.error).toBeNull();
    expect(aReadsB.data).toEqual([]);
    expect(bReadsA.data).toEqual([]);
  });

  it("两个用户不能互相修改 profile", async () => {
    const [aUpdatesB, bUpdatesA] = await Promise.all([
      clientA
        .from("profiles")
        .update({ display_name: "changed by A" })
        .eq("user_id", userBId)
        .select("user_id"),
      clientB
        .from("profiles")
        .update({ display_name: "changed by B" })
        .eq("user_id", userAId)
        .select("user_id"),
    ]);

    expect(aUpdatesB.error).toBeNull();
    expect(bUpdatesA.error).toBeNull();
    expect(aUpdatesB.data).toEqual([]);
    expect(bUpdatesA.data).toEqual([]);

    const [profileA, profileB] = await Promise.all([
      clientA
        .from("profiles")
        .select("display_name")
        .eq("user_id", userAId)
        .single(),
      clientB
        .from("profiles")
        .select("display_name")
        .eq("user_id", userBId)
        .single(),
    ]);

    expect(profileA.data?.display_name).toBe("RLS user A");
    expect(profileB.data?.display_name).toBe("RLS user B");
  });
});
