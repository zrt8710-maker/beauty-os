import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20260818031000_enforce_product_draft_state_integrity.sql",
    import.meta.url,
  ),
);

describe("product draft 状态完整性 migration", () => {
  const sql = readFileSync(migrationPath, "utf8").toLowerCase();
  const stabilizationSql = readFileSync(
    fileURLToPath(
      new URL(
        "../../../supabase/migrations/20260818081000_stabilize_write_boundaries.sql",
        import.meta.url,
      ),
    ),
    "utf8",
  ).toLowerCase();

  it("使用 before update trigger 保护所有直接状态更新", () => {
    expect(sql).toContain(
      "create trigger product_drafts_enforce_state_transition",
    );
    expect(sql).toContain("before update on public.product_drafts");
    expect(sql).toContain(
      "execute function public.enforce_product_draft_state_transition()",
    );
  });

  it("只允许 pending 编辑或拒绝，confirmed 与 rejected 均不可恢复或编辑", () => {
    expect(sql).toContain("if old.status = 'pending' then");
    expect(sql).toContain("new.status in ('pending', 'rejected')");
    expect(sql).toContain("confirmed_draft_immutable");
    expect(sql).toContain("rejected_draft_immutable");
  });

  it("仅确认 RPC 在同一事务设置本地 capability 后才能确认草稿", () => {
    expect(sql).toContain("pending_draft_must_use_confirm_function");
    expect(sql).toContain("beauty_os.confirming_product_draft");
    expect(sql).toContain("pg_catalog.set_config(");
    expect(sql).toContain("'true',\n    true");
    expect(sql).toContain("create or replace function public.confirm_product_draft");
    expect(sql).toContain("security invoker");
  });

  it("保留现有确认事务的产品、库存、图片关联与草稿状态写入", () => {
    expect(sql).toContain("insert into public.products");
    expect(sql).toContain("insert into public.user_owned_products");
    expect(sql).toContain("update public.upload_assets");
    expect(sql).toContain("update public.product_drafts");
    expect(sql).not.toContain("exception when");
  });

  it("普通 INSERT/UPDATE 无法写候选字段，匹配 RPC 会重新验证候选", () => {
    expect(stabilizationSql).toContain("revoke insert, update on table public.product_drafts from authenticated");
    expect(stabilizationSql).toContain("grant update (\n  brand_name,");
    expect(stabilizationSql).not.toContain("grant update (\n  candidate_catalog_product_id");
    expect(stabilizationSql).toContain("create function public.save_product_draft_match(");
    expect(stabilizationSql).toContain("normalized_name_match_not_unique");
    expect(stabilizationSql).toContain("status = 'verified'");
  });
});
