import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260822000000_create_product_care_role_foundation.sql",
);

describe("product care role foundation migration contract", () => {
  let sql: string;

  beforeAll(async () => {
    sql = await readFile(migrationPath, "utf8");
  });

  it("初始化与现有护理流程一致的六个 care role", () => {
    for (const code of [
      "remover",
      "cleanser",
      "hydration",
      "treatment",
      "moisturizer",
      "sunscreen",
    ]) {
      expect(sql).toContain(`('${code}',`);
    }
  });

  it("通过多对多 assignment 连接 catalog product 与 care role", () => {
    expect(sql).toContain(
      "catalog_product_id uuid not null references public.catalog_products (id) on delete cascade",
    );
    expect(sql).toContain(
      "care_role_code text not null references public.care_roles (code) on update cascade on delete restrict",
    );
    expect(sql).toContain("unique (catalog_product_id, care_role_code)");
  });

  it("支持 primary/secondary 与 verified/candidate/unknown", () => {
    expect(sql).toContain(
      "assignment_kind text not null check (assignment_kind in ('primary', 'secondary'))",
    );
    expect(sql).toContain(
      "status text not null check (status in ('verified', 'candidate', 'unknown'))",
    );
    expect(sql).toContain(
      "confidence smallint check (confidence is null or confidence between 0 and 100)",
    );
    expect(sql).toContain(
      "check (status <> 'verified' or confidence is not null)",
    );
  });

  it("增加按产品状态和角色状态查询的索引", () => {
    expect(sql).toContain(
      "catalog_product_care_roles_product_status_idx",
    );
    expect(sql).toContain(
      "on public.catalog_product_care_roles (catalog_product_id, status)",
    );
    expect(sql).toContain("catalog_product_care_roles_role_status_idx");
    expect(sql).toContain(
      "on public.catalog_product_care_roles (care_role_code, status)",
    );
  });

  it("两张公共知识表启用 RLS，认证用户只有读取授权", () => {
    for (const table of ["care_roles", "catalog_product_care_roles"]) {
      expect(sql).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(sql).toContain(
        `revoke all on table public.${table} from anon, authenticated`,
      );
    }

    expect(sql).toContain(
      "grant select on table public.care_roles, public.catalog_product_care_roles to authenticated",
    );
    expect(sql).not.toMatch(
      /grant\s+(insert|update|delete|all)[^;]*\s+to authenticated/i,
    );
  });

  it("只暴露 active taxonomy 和 verified catalog 的 role 关系", () => {
    expect(sql).toContain('create policy "care_roles_select_active"');
    expect(sql).toContain("using (is_active = true)");
    expect(sql).toContain(
      'create policy "catalog_product_care_roles_select_verified_catalog"',
    );
    expect(sql).toContain("catalog_products.status = 'verified'");
  });

  it("不根据 product_type 回填或生成 catalog role assignment", () => {
    expect(sql).not.toContain("insert into public.catalog_product_care_roles");
    expect(sql).not.toContain("product_type");
  });
});
