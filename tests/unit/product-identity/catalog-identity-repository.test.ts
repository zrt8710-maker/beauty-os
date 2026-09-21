import { describe, expect, it } from "vitest";

import type { Database } from "@/db/database.types";
import { createCatalogIdentityRepository } from "@/server/repositories/catalog-identity-repository";
import type { SupabaseClient } from "@supabase/supabase-js";

const rows = [
  product("10000000-0000-4000-8000-000000000001", "candidate", "12345678", "HFP", "果酸毛孔净透精华水"),
  product("10000000-0000-4000-8000-000000000002", "verified", "87654321", "CeraVe", "Moisturizing Cream"),
  product("10000000-0000-4000-8000-000000000003", "deprecated", "11111111", "Old", "Deprecated Product"),
];

describe("CatalogIdentityRepository", () => {
  it("matches candidate products by barcode and normalized identity", async () => {
    const repository = createCatalogIdentityRepository(fakeSupabase(rows));

    await expect(repository.findByBarcode("12345678")).resolves.toMatchObject({ status: "candidate" });
    await expect(repository.findByIdentity(" HFP ", "果酸-毛孔净透精华水")).resolves.toEqual([
      expect.objectContaining({ id: rows[0].id, status: "candidate" }),
    ]);
  });

  it("keeps verified identities and excludes deprecated rows", async () => {
    const repository = createCatalogIdentityRepository(fakeSupabase(rows));
    const products = await repository.listIdentityProducts({ limit: 100 });

    expect(products.map((item) => item.status)).toEqual(["candidate", "verified"]);
    await expect(repository.findByBarcode("87654321")).resolves.toMatchObject({ status: "verified" });
    await expect(repository.findByBarcode("11111111")).resolves.toBeNull();
  });

  it("recalls the existing PROYA Catalog through its brand-aware matching-only canonical form", async () => {
    const proya = { ...product("a9aa26bb-1320-424e-a0a2-9ca0684acb99", "candidate", null, "珀莱雅", "珀莱雅双抗精华2.0"), variant_name: "2.0" };
    const repository = createCatalogIdentityRepository(fakeSupabase([proya], []));

    await expect(repository.recallByIdentity!("珀莱雅", "双抗精华")).resolves.toEqual({
      exact: [proya],
      plausible: [],
      exact_reason: "canonical_name_exact",
    });
  });

  it("recalls an exact alias from the latest usable research draft", async () => {
    const proya = { ...product("a9aa26bb-1320-424e-a0a2-9ca0684acb99", "candidate", null, "珀莱雅", "珀莱雅双抗精华2.0"), variant_name: "2.0" };
    const repository = createCatalogIdentityRepository(fakeSupabase([proya], [researchDraft(proya.id, ["PROYA双抗精华液2.0"])]));

    await expect(repository.recallByIdentity!("珀莱雅", "PROYA双抗精华液2.0")).resolves.toMatchObject({
      exact: [proya],
      exact_reason: "known_alias_exact",
    });
  });

  it("returns only conservative same-brand plausible candidates and rejects shared-marketing-term false positives", async () => {
    const proya = { ...product("a9aa26bb-1320-424e-a0a2-9ca0684acb99", "candidate", null, "珀莱雅", "珀莱雅双抗精华2.0"), variant_name: "2.0" };
    const repository = createCatalogIdentityRepository(fakeSupabase([proya], []));

    await expect(repository.recallByIdentity!("珀莱雅", "双抗焕亮精华液")).resolves.toMatchObject({
      exact: [],
      plausible: [proya],
    });
    await expect(repository.recallByIdentity!("珀莱雅", "双抗面膜")).resolves.toEqual({
      exact: [],
      plausible: [],
      exact_reason: null,
    });
    await expect(repository.recallByIdentity!("珀莱雅", "红宝石精华")).resolves.toEqual({
      exact: [],
      plausible: [],
      exact_reason: null,
    });
  });

  it("reconciles the enriched Dr.Ci:Labo identity to the plausible existing Catalog product", async () => {
    const existing = {
      ...product("d9e2c05b-7403-43ed-af53-0e5b0aca45d0", "verified", null, "城野医生", "毛孔收敛爽肤水"),
      product_type: "toner",
    };
    const repository = createCatalogIdentityRepository(fakeSupabase([existing], []));

    await expect(repository.reconcileExternalIdentity!({
      original_brand_name: "城野医生",
      original_product_name: "毛孔收敛精华水",
      external_brand_name: "城野医生（Dr.Ci:Labo）",
      external_product_name: "Labo Labo毛孔细致焕活精华水",
      external_variant_name: "100ml",
      external_aliases: [],
      external_product_type: null,
    })).resolves.toEqual([existing]);
  });

  it("keeps the Winona exact and short-name recalls on their existing result kinds", async () => {
    const winona = {
      ...product("1c101680-836a-4fa7-aff2-f0873ac20d10", "candidate", null, "薇诺娜", "清痘修复精华液"),
      product_type: "treatment",
      catalog_image_url: "https://cdn.example/winona.webp",
    };
    const repository = createCatalogIdentityRepository(fakeSupabase([winona], []));

    await expect(repository.recallByIdentity!("薇诺娜", "清痘修复精华液")).resolves.toMatchObject({
      exact: [winona],
      plausible: [],
    });
    await expect(repository.recallByIdentity!("薇诺娜", "清痘精华液")).resolves.toEqual({
      exact: [],
      plausible: [winona],
      exact_reason: null,
    });
  });

  it("does not reconcile a same-brand product with a different core name or product type", async () => {
    const existing = {
      ...product("d9e2c05b-7403-43ed-af53-0e5b0aca45d0", "verified", null, "城野医生", "毛孔收敛爽肤水"),
      product_type: "toner",
    };
    const repository = createCatalogIdentityRepository(fakeSupabase([existing], []));

    await expect(repository.reconcileExternalIdentity!({
      original_brand_name: "城野医生",
      original_product_name: "毛孔清洁面膜",
      external_brand_name: "城野医生（Dr.Ci:Labo）",
      external_product_name: "Labo Labo毛孔清洁面膜",
      external_variant_name: null,
      external_aliases: [],
      external_product_type: "mask",
    })).resolves.toEqual([]);
    await expect(repository.reconcileExternalIdentity!({
      original_brand_name: "城野医生",
      original_product_name: "维C焕亮面霜",
      external_brand_name: "城野医生（Dr.Ci:Labo）",
      external_product_name: "Labo Labo维C焕亮面霜",
      external_variant_name: null,
      external_aliases: [],
      external_product_type: null,
    })).resolves.toEqual([]);
  });
});

function product(id: string, status: string, barcode: string | null, brand: string, name: string) {
  return { id, brand_name: brand, product_name: name, variant_name: null, barcode, category: null, subcategory: null, product_type: null, confidence: 90, status, created_at: "2026-08-28T00:00:00.000Z", updated_at: "2026-08-28T00:00:00.000Z" };
}

function researchDraft(catalogProductId: string, aliases: string[]) {
  return {
    catalog_product_id: catalogProductId,
    research_version: 1,
    status: "draft",
    research_payload: { identity: { aliases } },
  };
}

function fakeSupabase(data: Array<Record<string, unknown>> = rows, drafts: Array<Record<string, unknown>> = []) {
  return {
    from(table: string) {
      return new FakeQuery(table === "catalog_product_research_drafts" ? drafts : data);
    },
  } as unknown as SupabaseClient<Database>;
}

class FakeQuery implements PromiseLike<{ data: Array<Record<string, unknown>>; error: null }> {
  private result: Array<Record<string, unknown>>;
  constructor(rowsToQuery: Array<Record<string, unknown>>) { this.result = [...rowsToQuery]; }
  select() { return this; }
  eq(field: string, value: unknown) { this.result = this.result.filter((row) => row[field as keyof typeof row] === value); return this; }
  in(field: string, values: unknown[]) { this.result = this.result.filter((row) => values.includes(row[field as keyof typeof row])); return this; }
  order() { return this; }
  limit(value: number) { this.result = this.result.slice(0, value); return this; }
  or() { return this; }
  async maybeSingle() { return { data: this.result[0] ?? null, error: null }; }
  then<TResult1 = { data: Array<Record<string, unknown>>; error: null }, TResult2 = never>(onfulfilled?: ((value: { data: Array<Record<string, unknown>>; error: null }) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
    return Promise.resolve({ data: this.result, error: null }).then(onfulfilled, onrejected);
  }
}
