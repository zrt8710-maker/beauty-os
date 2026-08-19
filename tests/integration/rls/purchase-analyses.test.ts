import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
