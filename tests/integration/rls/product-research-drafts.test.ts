import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("product research draft RLS migration contract", () => {
  it("allows candidate Catalog references while restricting draft persistence to service role", async () => {
    const sql = await readFile(
      path.join(process.cwd(), "supabase/migrations/20260827002000_create_catalog_product_research_drafts.sql"),
      "utf8",
    );

    expect(sql).toContain("references public.catalog_products (id)");
    expect(sql).not.toContain("status = 'verified'");
    expect(sql).toContain("unique (catalog_product_id, research_version)");
    expect(sql).toContain("alter table public.catalog_product_research_drafts enable row level security");
    expect(sql).toContain("revoke all on table public.catalog_product_research_drafts");
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("user_owned_products");
    expect(sql).not.toContain("catalog_product_ingredients");
    expect(sql).not.toContain("catalog_product_capabilities");
    expect(sql).not.toContain("catalog_product_care_roles");
  });
});
