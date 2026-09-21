import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20260827009000_refine_publish_product_research_snapshot_v01.sql"),
  "utf8",
);

describe("narrow research snapshot publication RPC", () => {
  it("allows usable drafts, records the selected source, and verifies Catalog last", () => {
    expect(sql).toContain("v_draft.status not in ('draft', 'review_pending', 'approved')");
    expect(sql).toContain("SELECTED_RESEARCH_SOURCE_NOT_FOUND");
    expect(sql).toContain("catalog_product_research_draft_publications");
    expect(sql.lastIndexOf("set status = 'verified'")).toBeGreaterThan(sql.lastIndexOf("catalog_product_research_draft_publications"));
  });

  it("promotes only ingredients and never role/capability or snapshot-only fields", () => {
    expect(sql).toContain("insert into public.ingredients");
    expect(sql).toContain("insert into public.catalog_product_ingredients");
    expect(sql).not.toContain("catalog_product_care_roles");
    expect(sql).not.toContain("catalog_product_capabilities");
    expect(sql).not.toContain("product_capability_evidence");
    expect(sql).not.toContain("risk_cautions");
  });

  it("uses the source-backed raw ingredient name only when no canonical alias exists", () => {
    expect(sql).toContain("coalesce(nullif(btrim(v_item ->> 'normalized_name'), ''), nullif(btrim(v_item ->> 'raw_name'), ''))");
  });

  it("uses the publication audit as its idempotency boundary", () => {
    expect(sql).toContain("return v_existing_result || jsonb_build_object('idempotent', true)");
  });
});
