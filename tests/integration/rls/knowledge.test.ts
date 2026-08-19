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
});
