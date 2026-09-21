import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("knowledge RLS migration contract", () => {
  it("verified 知识可读，普通用户没有写入、更新和删除授权", async () => {
    const sql = await readFile(path.join(process.cwd(), "supabase/migrations/20260818070000_create_product_knowledge.sql"), "utf8");
    for (const table of ["knowledge_sources", "catalog_products", "ingredients", "catalog_product_ingredients"]) expect(sql).toContain(`alter table public.${table} enable row level security`);
    expect(sql).toContain("grant select on table public.knowledge_sources, public.catalog_products, public.ingredients, public.catalog_product_ingredients to authenticated");
    expect(sql).not.toContain("grant insert on table public.catalog_products to authenticated");
    expect(sql).toContain("using (status = 'verified')");
  });

  it("目录关联只能由确认事务写入，并允许显式保持手工产品", async () => {
    const sql = await readFile(path.join(process.cwd(), "supabase/migrations/20260818071000_add_product_draft_catalog_matching.sql"), "utf8");
    expect(sql).toContain("candidate_catalog_product_id uuid references public.catalog_products");
    expect(sql).toContain("catalog_product_id uuid references public.catalog_products");
    expect(sql).toContain("draft_record.candidate_catalog_product_id is distinct from p_catalog_product_id");
    expect(sql).toContain("product_type, catalog_product_id, created_by_user_id");
  });

  it("产品身份查询使用同一 normalize function、verified 限制和表达式索引", async () => {
    const catalogSql = await readFile(path.join(process.cwd(), "supabase/migrations/20260818070000_create_product_knowledge.sql"), "utf8");
    const sql = await readFile(path.join(process.cwd(), "supabase/migrations/20260819003000_add_catalog_identity_query.sql"), "utf8");
    expect(catalogSql).toContain("barcode text unique");
    expect(sql).toContain("catalog_products_verified_normalized_identity_idx");
    expect(sql).toContain("public.normalize_product_match_text(brand_name)");
    expect(sql).toContain("public.normalize_product_match_text(product_name)");
    expect(sql).toContain("where status = 'verified'");
    expect(sql).toContain("catalog_product.status = 'verified'");
    expect(sql).toContain("returns setof public.catalog_products");
    expect(sql).toContain("to authenticated");
  });

  it("身份查询复用既有 PostgreSQL normalize，不在 Step 2 定义第二套规则", async () => {
    const normalizationSql = await readFile(path.join(process.cwd(), "supabase/migrations/20260818081000_stabilize_write_boundaries.sql"), "utf8");
    const identitySql = await readFile(path.join(process.cwd(), "supabase/migrations/20260819003000_add_catalog_identity_query.sql"), "utf8");
    expect(normalizationSql).toContain("create function public.normalize_product_match_text(value text)");
    expect(normalizationSql).toContain("pg_catalog.lower(");
    expect(normalizationSql).toContain("pg_catalog.regexp_replace(value, '[^[:alnum:]]+', '', 'g')");
    expect(identitySql).not.toContain("create function public.normalize_product_match_text");
    expect(identitySql.match(/public\.normalize_product_match_text/g)).toHaveLength(6);
  });
});
