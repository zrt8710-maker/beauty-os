import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260820001000_create_product_capability_foundation.sql",
);

describe("product capability foundation migration contract", () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(migrationPath, "utf8");
  });

  it("初始化今日护理所需的五个 capability", () => {
    for (const code of [
      "hydration",
      "barrier_support",
      "soothing",
      "oil_balance",
      "sun_protection",
    ]) {
      expect(sql).toContain(`('${code}',`);
    }
  });

  it("catalog capability 通过外键连接 verified catalog 与 capability taxonomy", () => {
    expect(sql).toContain(
      "catalog_product_id uuid not null references public.catalog_products (id) on delete cascade",
    );
    expect(sql).toContain(
      "capability_code text not null references public.capabilities (code) on update cascade on delete restrict",
    );
  });

  it("支持 verified、candidate、unknown 并要求 verified confidence", () => {
    expect(sql).toContain(
      "status text not null check (status in ('verified', 'candidate', 'unknown'))",
    );
    expect(sql).toContain(
      "confidence smallint check (confidence is null or confidence between 0 and 100)",
    );
    expect(sql).toContain("check (status <> 'verified' or confidence is not null)");
  });

  it("每个 catalog product 的同一 capability 只能存在一条评估", () => {
    expect(sql).toContain("unique (catalog_product_id, capability_code)");
  });

  it("evidence 归属于 capability assessment 并记录方向与审核状态", () => {
    expect(sql).toContain(
      "product_capability_id uuid not null references public.catalog_product_capabilities (id) on delete cascade",
    );
    expect(sql).toContain("direction text not null check (direction in ('supports', 'contradicts'))");
    expect(sql).toContain(
      "review_status in ('verified', 'candidate', 'rejected')",
    );
  });

  it("三张知识表启用 RLS，认证用户只有读取授权", () => {
    for (const table of [
      "capabilities",
      "catalog_product_capabilities",
      "product_capability_evidence",
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`revoke all on table public.${table} from anon, authenticated`);
    }

    expect(sql).toContain(
      "grant select on table public.capabilities, public.catalog_product_capabilities, public.product_capability_evidence to authenticated",
    );
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|all)[^;]*\s+to authenticated/i);
  });

  it("产品能力和证据只通过 verified catalog product 暴露", () => {
    expect(sql).toContain(
      'create policy "catalog_product_capabilities_select_verified_catalog"',
    );
    expect(sql).toContain(
      'create policy "product_capability_evidence_select_verified_catalog"',
    );
    expect(sql.match(/catalog_products\.status = 'verified'/g)).toHaveLength(2);
  });
});
