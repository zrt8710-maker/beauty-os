import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database, Json } from "@/db/database.types";
import { PRODUCT_TYPE_META } from "@/schemas/product";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260824010000_apply_catalog_seed_v01.sql",
);

describe("catalog seed write RPC migration contract", () => {
  let sql: string;

  beforeAll(async () => {
    sql = (await readFile(migrationPath, "utf8")).toLowerCase();
  });

  it("defines one service-role JSON transaction boundary", () => {
    expect(sql).toContain(
      "create function public.apply_catalog_seed_v01(\n  p_input jsonb",
    );
    expect(sql).toContain("returns jsonb");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain(
      "lock table public.knowledge_sources in share row exclusive mode",
    );
    expect(sql).toContain(
      "lock table public.catalog_products in share row exclusive mode",
    );
    expect(sql).not.toContain("when others");
  });

  it("checks every identity conflict without filtering out non-verified rows", () => {
    for (const conflictCode of [
      "catalog_seed_source_id_conflict",
      "catalog_seed_stable_id_conflict",
      "catalog_seed_catalog_status_conflict",
      "catalog_seed_barcode_conflict",
      "catalog_seed_raw_identity_conflict",
      "catalog_seed_normalized_identity_conflict",
    ]) {
      expect(sql).toContain(conflictCode);
    }

    expect(sql).toContain(
      "public.normalize_product_match_text(catalog_product.brand_name)",
    );
    expect(sql).toContain(
      "public.normalize_product_match_text(catalog_product.product_name)",
    );
    expect(sql).not.toContain(
      "create function public.normalize_product_match_text",
    );
    expect(sql).not.toMatch(
      /normalize_product_match_text\(catalog_product\.brand_name\)[\s\S]{0,500}catalog_product\.status\s*=\s*'verified'/,
    );
  });

  it("validates the product classification mapping inside the RPC", () => {
    expect(sql).toContain("catalog_seed_classification_mismatch");
    expect(sql).toContain("invalid_catalog_seed_product_type");

    for (const [productType, metadata] of Object.entries(PRODUCT_TYPE_META)) {
      expect(sql).toContain(
        `('${productType}', '${metadata.category}', '${metadata.subcategory}')`,
      );
    }
  });

  it("inserts only identity/source rows and never overwrites or infers knowledge", () => {
    expect(sql).toContain("insert into public.knowledge_sources");
    expect(sql).toContain("insert into public.catalog_products");
    expect(sql).not.toContain("on conflict");
    expect(sql).not.toMatch(/update\s+public\.catalog_products/);
    expect(sql).not.toMatch(/update\s+public\.knowledge_sources/);

    for (const forbiddenTable of [
      "catalog_product_care_roles",
      "catalog_product_capabilities",
      "product_capability_evidence",
      "products",
      "user_owned_products",
    ]) {
      expect(sql).not.toMatch(new RegExp(`public\\.${forbiddenTable}\\b`));
    }
  });

  it("returns explicit created/existing receipt semantics", () => {
    for (const field of [
      "outcome",
      "catalog_product_id",
      "source_id",
      "source_created",
      "catalog_product_created",
      "status",
    ]) {
      expect(sql).toContain(`'${field}'`);
    }
    expect(sql).toContain("'outcome', 'created'");
    expect(sql).toContain("'outcome', 'existing'");
    expect(sql).toContain("'status', 'verified'");
  });

  it("allows only service_role to execute the RPC", () => {
    expect(sql).toMatch(
      /revoke all on function public\.apply_catalog_seed_v01\(jsonb\)[\s\S]*from public, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.apply_catalog_seed_v01\(jsonb\)[\s\S]*to service_role;/,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.apply_catalog_seed_v01\(jsonb\)[\s\S]*to (?:public|anon|authenticated);/,
    );
  });
});

const serviceRoleEnvironment = {
  url: process.env.SUPABASE_TEST_URL,
  key: process.env.SUPABASE_TEST_SERVICE_ROLE_KEY,
};
const describeServiceRoleLive = Object.values(serviceRoleEnvironment).every(
  Boolean,
)
  ? describe
  : describe.skip;

describeServiceRoleLive("catalog seed RPC (live service role)", () => {
  let client!: SupabaseClient<Database>;
  const catalogProductIds = new Set<string>();
  const sourceIds = new Set<string>();

  beforeAll(() => {
    client = createClient<Database>(
      serviceRoleEnvironment.url!,
      serviceRoleEnvironment.key!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  });

  afterAll(async () => {
    if (!client) return;
    if (catalogProductIds.size > 0) {
      await client
        .from("catalog_products")
        .delete()
        .in("id", [...catalogProductIds]);
    }
    if (sourceIds.size > 0) {
      await client
        .from("knowledge_sources")
        .delete()
        .in("id", [...sourceIds]);
    }
  });

  it("atomically creates a verified source and catalog product without knowledge rows", async () => {
    const input = seedInput();
    track(input);

    const result = await applySeed(client, input);

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      outcome: "created",
      catalog_product_id: input.catalog_product_id,
      source_id: input.source.source_id,
      source_created: true,
      catalog_product_created: true,
      status: "verified",
    });

    const source = await client
      .from("knowledge_sources")
      .select("id, source_type, name")
      .eq("id", input.source.source_id)
      .single();
    const catalog = await client
      .from("catalog_products")
      .select("id, primary_source_id, brand_name, product_name, status")
      .eq("id", input.catalog_product_id)
      .single();
    const roles = await client
      .from("catalog_product_care_roles")
      .select("id")
      .eq("catalog_product_id", input.catalog_product_id);
    const capabilities = await client
      .from("catalog_product_capabilities")
      .select("id")
      .eq("catalog_product_id", input.catalog_product_id);

    expect(source.data).toMatchObject({
      id: input.source.source_id,
      source_type: input.source.source_type,
      name: input.source.name,
    });
    expect(catalog.data).toMatchObject({
      id: input.catalog_product_id,
      primary_source_id: input.source.source_id,
      brand_name: input.identity.brand_name,
      product_name: input.identity.product_name,
      status: "verified",
    });
    expect(roles.data).toEqual([]);
    expect(capabilities.data).toEqual([]);
  });

  it("returns existing for an identical seed and keeps one row of each", async () => {
    const input = seedInput();
    track(input);

    const first = await applySeed(client, input);
    const second = await applySeed(client, input);

    expect(first.data).toMatchObject({ outcome: "created" });
    expect(second.error).toBeNull();
    expect(second.data).toEqual({
      outcome: "existing",
      catalog_product_id: input.catalog_product_id,
      source_id: input.source.source_id,
      source_created: false,
      catalog_product_created: false,
      status: "verified",
    });

    const catalogRows = await client
      .from("catalog_products")
      .select("id")
      .eq("id", input.catalog_product_id);
    const sourceRows = await client
      .from("knowledge_sources")
      .select("id")
      .eq("id", input.source.source_id);
    expect(catalogRows.data).toHaveLength(1);
    expect(sourceRows.data).toHaveLength(1);
  });

  it("rejects stable-id content changes without altering the original", async () => {
    const input = seedInput();
    track(input);
    const first = await applySeed(client, input);
    if (first.error) throw first.error;

    const changed = {
      ...input,
      identity: {
        ...input.identity,
        product_name: `${input.identity.product_name} Changed`,
      },
    };
    const conflict = await applySeed(client, changed);

    expect(conflict.error?.message).toContain(
      "CATALOG_SEED_STABLE_ID_CONFLICT",
    );
    const catalog = await client
      .from("catalog_products")
      .select("product_name")
      .eq("id", input.catalog_product_id)
      .single();
    expect(catalog.data?.product_name).toBe(input.identity.product_name);
  });

  it("rejects a barcode already owned by another catalog product", async () => {
    const first = seedInput();
    const second = seedInput({ barcode: first.identity.barcode });
    track(first);
    track(second);
    const created = await applySeed(client, first);
    if (created.error) throw created.error;

    const conflict = await applySeed(client, second);

    expect(conflict.error?.message).toContain(
      "CATALOG_SEED_BARCODE_CONFLICT",
    );
    const secondSource = await client
      .from("knowledge_sources")
      .select("id")
      .eq("id", second.source.source_id)
      .maybeSingle();
    expect(secondSource.data).toBeNull();
  });

  it("rejects a normalized identity owned by another product", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const first = seedInput({
      brandName: `Beauty-OS ${suffix}`,
      productName: "Normalized Serum",
    });
    const second = seedInput({
      brandName: `Beauty OS ${suffix}`,
      productName: "NormalizedSerum",
    });
    track(first);
    track(second);
    const created = await applySeed(client, first);
    if (created.error) throw created.error;

    const conflict = await applySeed(client, second);

    expect(conflict.error?.message).toContain(
      "CATALOG_SEED_NORMALIZED_IDENTITY_CONFLICT",
    );
    const secondCatalog = await client
      .from("catalog_products")
      .select("id")
      .eq("id", second.catalog_product_id)
      .maybeSingle();
    expect(secondCatalog.data).toBeNull();
  });

  it("never upgrades candidate or deprecated rows", async () => {
    const candidate = seedInput({ productName: "Candidate Seed" });
    const deprecated = seedInput({ productName: "Deprecated Seed" });
    track(candidate);
    track(deprecated);

    for (const [input, status] of [
      [candidate, "candidate"],
      [deprecated, "deprecated"],
    ] as const) {
      const sourceInsert = await client.from("knowledge_sources").insert({
        id: input.source.source_id,
        source_type: input.source.source_type,
        name: input.source.name,
        source_url: input.source.source_url,
        license_note: input.source.license_note,
        retrieved_at: input.source.retrieved_at,
      });
      if (sourceInsert.error) throw sourceInsert.error;
      const catalogInsert = await client.from("catalog_products").insert({
        id: input.catalog_product_id,
        brand_name: input.identity.brand_name,
        product_name: input.identity.product_name,
        variant_name: input.identity.variant_name,
        barcode: input.identity.barcode,
        category: input.identity.category,
        subcategory: input.identity.subcategory,
        product_type: input.identity.product_type,
        primary_source_id: input.source.source_id,
        confidence: input.identity.confidence,
        status,
      });
      if (catalogInsert.error) throw catalogInsert.error;

      const result = await applySeed(client, input);
      expect(result.error?.message).toContain(
        "CATALOG_SEED_CATALOG_STATUS_CONFLICT",
      );
      const row = await client
        .from("catalog_products")
        .select("status")
        .eq("id", input.catalog_product_id)
        .single();
      expect(row.data?.status).toBe(status);
    }
  });

  it("rolls back a newly inserted source when catalog insertion fails", async () => {
    const input = seedInput();
    track(input);
    const invalidInput = {
      ...input,
      identity: { ...input.identity, confidence: 101 },
    };

    const result = await applySeed(client, invalidInput);

    expect(result.error).not.toBeNull();
    const source = await client
      .from("knowledge_sources")
      .select("id")
      .eq("id", input.source.source_id)
      .maybeSingle();
    const catalog = await client
      .from("catalog_products")
      .select("id")
      .eq("id", input.catalog_product_id)
      .maybeSingle();
    expect(source.data).toBeNull();
    expect(catalog.data).toBeNull();
  });

  function track(input: CatalogSeedRpcInput) {
    catalogProductIds.add(input.catalog_product_id);
    sourceIds.add(input.source.source_id);
  }
});

const authenticatedEnvironment = {
  url: process.env.SUPABASE_TEST_URL,
  key: process.env.SUPABASE_TEST_PUBLISHABLE_KEY,
  email: process.env.SUPABASE_TEST_USER_A_EMAIL,
  password: process.env.SUPABASE_TEST_USER_A_PASSWORD,
};
const describeAuthenticatedLive = Object.values(authenticatedEnvironment).every(
  Boolean,
)
  ? describe
  : describe.skip;

describeAuthenticatedLive(
  "catalog seed RPC permissions (live authenticated)",
  () => {
    let client!: SupabaseClient<Database>;

    beforeAll(async () => {
      client = createClient<Database>(
        authenticatedEnvironment.url!,
        authenticatedEnvironment.key!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const session = await client.auth.signInWithPassword({
        email: authenticatedEnvironment.email!,
        password: authenticatedEnvironment.password!,
      });
      if (session.error) throw session.error;
    });

    afterAll(async () => {
      await client?.auth.signOut();
    });

    it("denies authenticated execution", async () => {
      const result = await applySeed(client, seedInput());

      expect(result.error?.code).toBe("42501");
      expect(result.error?.message.toLowerCase()).toContain(
        "permission denied",
      );
    });
  },
);

type CatalogSeedRpcInput = ReturnType<typeof seedInput>;

function seedInput(options: {
  barcode?: string | null;
  brandName?: string;
  productName?: string;
} = {}) {
  const token = crypto.randomUUID().replaceAll("-", "");
  return {
    schema_version: "catalog-seed/v0.1",
    catalog_product_id: crypto.randomUUID(),
    source: {
      source_id: crypto.randomUUID(),
      source_type: "official_brand",
      name: `Catalog Seed RPC ${token}`,
      source_url: `https://example.com/catalog-seed/${token}`,
      license_note: "Catalog seed live transaction test",
      retrieved_at: "2026-08-24T00:00:00.000Z",
    },
    identity: {
      brand_name: options.brandName ?? `Beauty OS ${token}`,
      product_name: options.productName ?? `Catalog Serum ${token}`,
      variant_name: null,
      barcode: options.barcode === undefined ? token.slice(0, 12) : options.barcode,
      category: "skincare",
      subcategory: "face_care",
      product_type: "serum",
      confidence: 98,
      status: "verified",
    },
  };
}

function applySeed(
  client: SupabaseClient<Database>,
  input: Record<string, unknown>,
) {
  return client.rpc("apply_catalog_seed_v01", {
    p_input: input as Json,
  });
}
