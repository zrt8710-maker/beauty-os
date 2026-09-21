import { readFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/db/database.types";

const migrationPath = path.join(
  process.cwd(),
  "supabase/migrations/20260824000000_create_product_knowledge_curation_rpc.sql",
);

describe("product knowledge curation RPC migration contract", () => {
  let sql: string;

  beforeAll(async () => {
    sql = (await readFile(migrationPath, "utf8")).toLowerCase();
  });

  it("exposes one jsonb transaction boundary with a fixed receipt", () => {
    expect(sql).toContain(
      "create function public.apply_product_knowledge_curation_v01(\n  p_input jsonb",
    );
    expect(sql).toContain("returns jsonb");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("set search_path = ''");

    for (const receiptField of [
      "catalog_product_id",
      "role_assignment_ids",
      "capability_assignment_ids",
      "evidence_counts",
    ]) {
      expect(sql).toContain(`'${receiptField}'`);
    }
  });

  it("locks the target catalog product and requires verified status", () => {
    expect(sql).toMatch(
      /from public\.catalog_products[\s\S]*where catalog_product\.id = v_catalog_product_id[\s\S]*for update;/,
    );
    expect(sql).toContain("catalog_product_not_found");
    expect(sql).toContain("catalog_product_not_verified");
    expect(sql).toContain("if v_catalog_status <> 'verified'");
  });

  it("requires active role and capability taxonomy rows", () => {
    expect(sql).toMatch(
      /from public\.care_roles[\s\S]*code = v_care_role_code[\s\S]*is_active = true/,
    );
    expect(sql).toMatch(
      /from public\.capabilities[\s\S]*code = v_capability_code[\s\S]*is_active = true/,
    );
    expect(sql).toContain("active_care_role_not_found");
    expect(sql).toContain("active_capability_not_found");
  });

  it("defends verified role and capability invariants inside the transaction", () => {
    expect(sql).toContain("verified_care_role_confidence_required");
    expect(sql).toContain("verified_capability_confidence_required");
    expect(sql).toContain("verified_capability_supporting_evidence_required");
    expect(sql).toContain(
      "evidence_item.value ->> 'direction' = 'supports'",
    );
    expect(sql).toContain(
      "evidence_item.value ->> 'review_status' = 'verified'",
    );
  });

  it("upserts only declared assignments and replaces evidence only for declared capabilities", () => {
    expect(sql).toContain("insert into public.catalog_product_care_roles");
    expect(sql).toContain("insert into public.catalog_product_capabilities");
    expect(sql).toContain("insert into public.product_capability_evidence");
    expect(sql).toContain("delete from public.product_capability_evidence");
    expect(sql).toContain(
      "where product_capability_id = v_product_capability_id",
    );
    expect(sql).not.toContain("delete from public.catalog_product_care_roles");
    expect(sql).not.toContain("delete from public.catalog_product_capabilities");
  });

  it("does not write identity, inventory, or taxonomy tables", () => {
    for (const table of [
      "catalog_products",
      "products",
      "user_owned_products",
      "care_roles",
      "capabilities",
    ]) {
      expect(sql).not.toMatch(
        new RegExp(`(?:insert into|delete from|update)\\s+public\\.${table}\\b`),
      );
    }
  });

  it("lets every exception roll back and restricts execution to service_role", () => {
    expect(sql).not.toContain("when others");
    expect(sql).toMatch(
      /revoke all on function public\.apply_product_knowledge_curation_v01\(jsonb\)[\s\S]*from public, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.apply_product_knowledge_curation_v01\(jsonb\)[\s\S]*to service_role;/,
    );
    expect(sql).not.toMatch(
      /grant execute on function public\.apply_product_knowledge_curation_v01\(jsonb\)[\s\S]*to (?:public|anon|authenticated);/,
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

describeServiceRoleLive(
  "product knowledge curation RPC (live service role)",
  () => {
    let client!: SupabaseClient<Database>;
    const sourceId = crypto.randomUUID();
    const verifiedCatalogProductId = crypto.randomUUID();
    const candidateCatalogProductId = crypto.randomUUID();
    const fixtureSuffix = crypto.randomUUID();

    beforeAll(async () => {
      client = createClient<Database>(
        serviceRoleEnvironment.url!,
        serviceRoleEnvironment.key!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );

      const sourceResult = await client.from("knowledge_sources").insert({
        id: sourceId,
        source_type: "official_brand",
        name: `Curation RPC test ${fixtureSuffix}`,
      });
      if (sourceResult.error) throw sourceResult.error;

      const catalogResult = await client.from("catalog_products").insert([
        catalogFixture(
          verifiedCatalogProductId,
          sourceId,
          `Verified Curation ${fixtureSuffix}`,
          "verified",
        ),
        catalogFixture(
          candidateCatalogProductId,
          sourceId,
          `Candidate Curation ${fixtureSuffix}`,
          "candidate",
        ),
      ]);
      if (catalogResult.error) throw catalogResult.error;
    });

    afterAll(async () => {
      if (!client) return;
      await client
        .from("catalog_products")
        .delete()
        .in("id", [verifiedCatalogProductId, candidateCatalogProductId]);
      await client.from("knowledge_sources").delete().eq("id", sourceId);
    });

    it("writes verified assignments and returns the fixed receipt", async () => {
      const result = await applyCuration(
        client,
        curationInput(verifiedCatalogProductId, {
          roles: [verifiedRole("moisturizer")],
          capabilities: [
            capability("hydration", "verified", [
              evidence("official_product_description", "First source"),
              evidence("manual_curation", "Second source"),
            ]),
          ],
        }),
      );

      expect(result.error).toBeNull();
      expect(result.data).toMatchObject({
        catalog_product_id: verifiedCatalogProductId,
        role_assignment_ids: { moisturizer: expect.any(String) },
        capability_assignment_ids: { hydration: expect.any(String) },
        evidence_counts: { hydration: 2 },
      });

      const roles = await client
        .from("catalog_product_care_roles")
        .select("care_role_code, status, confidence")
        .eq("catalog_product_id", verifiedCatalogProductId);
      const capabilities = await client
        .from("catalog_product_capabilities")
        .select("id, capability_code, status, confidence")
        .eq("catalog_product_id", verifiedCatalogProductId);

      expect(roles.data).toEqual([
        { care_role_code: "moisturizer", status: "verified", confidence: 95 },
      ]);
      expect(capabilities.data).toEqual([
        expect.objectContaining({
          capability_code: "hydration",
          status: "verified",
          confidence: 90,
        }),
      ]);
    });

    it("rejects missing and non-verified catalog products", async () => {
      const missingId = crypto.randomUUID();
      const missingResult = await applyCuration(
        client,
        curationInput(missingId, { roles: [verifiedRole("cleanser")] }),
      );
      const candidateResult = await applyCuration(
        client,
        curationInput(candidateCatalogProductId, {
          roles: [verifiedRole("cleanser")],
        }),
      );

      expect(missingResult.error?.message).toContain(
        "CATALOG_PRODUCT_NOT_FOUND",
      );
      expect(candidateResult.error?.message).toContain(
        "CATALOG_PRODUCT_NOT_VERIFIED",
      );

      const candidateAssignments = await client
        .from("catalog_product_care_roles")
        .select("id")
        .eq("catalog_product_id", candidateCatalogProductId);
      expect(candidateAssignments.data).toEqual([]);
    });

    it("rejects missing taxonomy and verified capability without supporting evidence", async () => {
      const missingTaxonomy = await applyCuration(
        client,
        curationInput(verifiedCatalogProductId, {
          roles: [
            {
              ...verifiedRole("cleanser"),
              care_role_code: "not_a_role",
            },
          ],
        }),
      );
      const missingCapabilityTaxonomy = await applyCuration(
        client,
        curationInput(verifiedCatalogProductId, {
          capabilities: [
            capability("not_a_capability", "candidate", []),
          ],
        }),
      );
      const missingEvidence = await applyCuration(
        client,
        curationInput(verifiedCatalogProductId, {
          roles: [verifiedRole("treatment")],
          capabilities: [capability("soothing", "verified", [])],
        }),
      );

      expect(missingTaxonomy.error?.message).toContain(
        "ACTIVE_CARE_ROLE_NOT_FOUND",
      );
      expect(missingCapabilityTaxonomy.error?.message).toContain(
        "ACTIVE_CAPABILITY_NOT_FOUND",
      );
      expect(missingEvidence.error?.message).toContain(
        "VERIFIED_CAPABILITY_SUPPORTING_EVIDENCE_REQUIRED",
      );

      const treatmentRole = await client
        .from("catalog_product_care_roles")
        .select("id")
        .eq("catalog_product_id", verifiedCatalogProductId)
        .eq("care_role_code", "treatment");
      const soothingCapability = await client
        .from("catalog_product_capabilities")
        .select("id")
        .eq("catalog_product_id", verifiedCatalogProductId)
        .eq("capability_code", "soothing");
      expect(treatmentRole.data).toEqual([]);
      expect(soothingCapability.data).toEqual([]);
    });

    it("rolls back earlier writes when an evidence insert fails", async () => {
      const result = await applyCuration(
        client,
        curationInput(verifiedCatalogProductId, {
          roles: [verifiedRole("treatment")],
          capabilities: [
            capability("soothing", "candidate", [
              {
                ...evidence("manual_curation", "Invalid evidence"),
                evidence_type: "invalid_evidence_type",
              },
            ]),
          ],
        }),
      );

      expect(result.error).not.toBeNull();

      const treatmentRole = await client
        .from("catalog_product_care_roles")
        .select("id")
        .eq("catalog_product_id", verifiedCatalogProductId)
        .eq("care_role_code", "treatment");
      const soothingCapability = await client
        .from("catalog_product_capabilities")
        .select("id")
        .eq("catalog_product_id", verifiedCatalogProductId)
        .eq("capability_code", "soothing");
      expect(treatmentRole.data).toEqual([]);
      expect(soothingCapability.data).toEqual([]);
    });

    it("replaces declared evidence, preserves omitted knowledge, and is state-idempotent", async () => {
      const existingCapability = await client
        .from("catalog_product_capabilities")
        .select("id")
        .eq("catalog_product_id", verifiedCatalogProductId)
        .eq("capability_code", "hydration")
        .single();
      const existingRole = await client
        .from("catalog_product_care_roles")
        .select("id")
        .eq("catalog_product_id", verifiedCatalogProductId)
        .eq("care_role_code", "moisturizer")
        .single();

      const replacement = curationInput(verifiedCatalogProductId, {
        capabilities: [
          capability("hydration", "verified", [
            evidence("official_product_description", "Replacement source"),
          ]),
        ],
      });
      const firstResult = await applyCuration(client, replacement);
      const secondResult = await applyCuration(client, replacement);

      expect(firstResult.error).toBeNull();
      expect(secondResult.error).toBeNull();
      expect(firstResult.data).toMatchObject({
        capability_assignment_ids: { hydration: existingCapability.data!.id },
        evidence_counts: { hydration: 1 },
      });
      expect(secondResult.data).toMatchObject({
        capability_assignment_ids: { hydration: existingCapability.data!.id },
        evidence_counts: { hydration: 1 },
      });

      const evidenceRows = await client
        .from("product_capability_evidence")
        .select("evidence_note")
        .eq("product_capability_id", existingCapability.data!.id);
      const preservedRole = await client
        .from("catalog_product_care_roles")
        .select("id")
        .eq("catalog_product_id", verifiedCatalogProductId)
        .eq("care_role_code", "moisturizer")
        .single();

      expect(evidenceRows.data).toEqual([
        { evidence_note: "Replacement source" },
      ]);
      expect(preservedRole.data?.id).toBe(existingRole.data!.id);
    });
  },
);

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
  "product knowledge curation RPC permissions (live authenticated)",
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

    it("does not allow an authenticated user to execute the curation RPC", async () => {
      const result = await applyCuration(
        client,
        curationInput(crypto.randomUUID(), {}),
      );

      expect(result.error?.code).toBe("42501");
      expect(result.error?.message.toLowerCase()).toContain("permission denied");
    });
  },
);

function catalogFixture(
  id: string,
  sourceId: string,
  productName: string,
  status: "verified" | "candidate",
) {
  return {
    id,
    brand_name: "Beauty OS Curation Test",
    product_name: productName,
    category: "skincare",
    subcategory: "face_care",
    product_type: "serum",
    primary_source_id: sourceId,
    confidence: 100,
    status,
  };
}

function curationInput(
  catalogProductId: string,
  input: {
    roles?: Record<string, unknown>[];
    capabilities?: Record<string, unknown>[];
  },
) {
  return {
    schema_version: "product-knowledge-curation/v0.1",
    catalog_product_id: catalogProductId,
    roles: input.roles ?? [],
    capabilities: input.capabilities ?? [],
  };
}

function verifiedRole(careRoleCode: string) {
  return {
    care_role_code: careRoleCode,
    assignment_kind: "primary",
    status: "verified",
    confidence: 95,
    assessment_note: "Live RPC test role",
    source_locator: "live-test",
    reviewed_at: "2026-08-24T00:00:00.000Z",
  };
}

function capability(
  capabilityCode: string,
  status: "verified" | "candidate" | "unknown",
  evidenceItems: Record<string, unknown>[],
) {
  return {
    capability_code: capabilityCode,
    status,
    confidence: status === "verified" ? 90 : null,
    assessment_note: "Live RPC test capability",
    reviewed_at: "2026-08-24T00:00:00.000Z",
    evidence: evidenceItems,
  };
}

function evidence(evidenceType: string, evidenceNote: string) {
  return {
    evidence_type: evidenceType,
    direction: "supports",
    evidence_note: evidenceNote,
    source_locator: "https://example.com/live-rpc-test",
    confidence: 90,
    review_status: "verified",
  };
}

function applyCuration(
  client: SupabaseClient<Database>,
  input: Record<string, unknown>,
) {
  return client.rpc("apply_product_knowledge_curation_v01", {
    p_input: input,
  } as never);
}
