import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/db/database.types";

describe("purchase analyses RLS migration contract", () => {
  const stabilizationPath = path.join(process.cwd(), "supabase/migrations/20260818081000_stabilize_write_boundaries.sql");

  it("用户只能读取自己的分析，稳定性 migration 禁止直接写结果", async () => {
    const sql = await readFile(path.join(process.cwd(), "supabase/migrations/20260818080000_create_purchase_analyses.sql"), "utf8");
    const stabilization = await readFile(stabilizationPath, "utf8");
    expect(sql).toContain("alter table public.purchase_analyses enable row level security");
    expect(sql).toContain("using ((select auth.uid()) = user_id)");
    expect(sql).toContain("with check (\n  (select auth.uid()) = user_id");
    expect(sql).toContain("grant select, insert on table public.purchase_analyses to authenticated");
    expect(sql).not.toContain("grant update"); expect(sql).not.toContain("grant delete");
    expect(stabilization).toContain("revoke insert on table public.purchase_analyses from authenticated");
    expect(stabilization).toContain("create function public.persist_purchase_analysis(");
    expect(stabilization).toContain("PURCHASE_FINAL_SCORE_MISMATCH");
    expect(stabilization).toContain("PURCHASE_DECISION_MISMATCH");
  });
  it("catalog 候选必须仍是 verified", async () => {
    const sql = await readFile(path.join(process.cwd(), "supabase/migrations/20260818080000_create_purchase_analyses.sql"), "utf8");
    expect(sql).toContain("catalog_products.status = 'verified'");
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

const describeLive = Object.values(testEnvironment).every(Boolean)
  ? describe
  : describe.skip;

describeLive("purchase analyses 双用户 RLS 隔离（真实 Supabase）", () => {
  let clientA!: SupabaseClient<Database>;
  let clientB!: SupabaseClient<Database>;

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
  });

  it("用户 B 无法读取用户 A 通过受控 RPC 写入的分析", async () => {
    const created = await clientA.rpc("persist_purchase_analysis", {
      p_candidate_product_id: null as unknown as string,
      p_candidate_snapshot: { product_name: "RLS Purchase Candidate" },
      p_inventory_snapshot: { items: [] },
      p_goal_snapshot: {},
      p_duplicate_score: 50,
      p_gap_score: 50,
      p_compatibility_score: 50,
      p_usage_probability_score: 50,
      p_risk_score: 50,
      p_final_score: 50,
      p_decision: "do_not_buy",
      p_evidence: {},
      p_unknowns: [],
      p_reason_codes: [],
    });

    expect(created.error).toBeNull();
    expect(created.data).toHaveLength(1);
    const analysisId = created.data![0].id;

    const [ownRead, foreignRead] = await Promise.all([
      clientA.from("purchase_analyses").select("id").eq("id", analysisId),
      clientB.from("purchase_analyses").select("id").eq("id", analysisId),
    ]);

    expect(ownRead.error).toBeNull();
    expect(ownRead.data).toEqual([{ id: analysisId }]);
    expect(foreignRead.error).toBeNull();
    expect(foreignRead.data).toEqual([]);
  });
});
