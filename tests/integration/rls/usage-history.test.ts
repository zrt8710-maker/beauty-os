import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.join(process.cwd(), "supabase/migrations/20260818060000_create_usage_history.sql");
const stabilizationPath = path.join(process.cwd(), "supabase/migrations/20260818081000_stabilize_write_boundaries.sql");

describe("usage history RLS migration contract", () => {
  it("为历史及产品反馈启用用户隔离，并在稳定性 migration 撤销直接写入", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const stabilization = await readFile(stabilizationPath, "utf8");
    expect(sql).toContain("alter table public.usage_history enable row level security");
    expect(sql).toContain("alter table public.usage_history_products enable row level security");
    expect(sql).toContain("grant select, insert on table public.usage_history to authenticated");
    expect(sql).toContain("grant select, insert on table public.usage_history_products to authenticated");
    expect(sql).not.toContain("grant update, delete on table public.usage_history to authenticated");
    expect(sql).toContain("user_owned_products.user_id = (select auth.uid())");
    expect(stabilization).toContain("revoke insert on table public.usage_history from authenticated");
    expect(stabilization).toContain("revoke insert on table public.usage_history_products from authenticated");
    expect(stabilization).toContain("alter function public.record_routine_usage(");
    expect(stabilization).toContain(") security definer");
  });

  it("RPC 在写入前验证方案归属和方案内产品归属", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("routines.user_id = (select auth.uid())");
    expect(sql).toContain("USAGE_PRODUCT_NOT_IN_OWN_ROUTINE");
    expect(sql).toContain("security invoker");
  });
});
