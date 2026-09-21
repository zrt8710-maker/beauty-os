import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/db/database.types";
import { createProductKnowledgeRepository } from "@/server/repositories/product-knowledge-repository";

const catalogProductId = "10000000-0000-4000-8000-000000000001";
const timestamp = "2026-08-22T00:00:00.000Z";

const identity = {
  id: catalogProductId,
  brand_name: "Beauty OS",
  product_name: "Knowledge Serum",
  variant_name: null,
  barcode: "12345678",
  category: "skincare",
  subcategory: "face_care",
  product_type: "serum",
  primary_source_id: "20000000-0000-4000-8000-000000000001",
  confidence: 98,
  status: "verified",
  created_at: timestamp,
  updated_at: timestamp,
};

function careRole(
  code: "hydration" | "treatment" | "moisturizer",
  status: "verified" | "candidate" | "unknown",
  assignmentKind: "primary" | "secondary",
  index: number,
) {
  return {
    id: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    catalog_product_id: catalogProductId,
    care_role_code: code,
    assignment_kind: assignmentKind,
    status,
    confidence: status === "verified" ? 95 : null,
    assessment_note: `${code} assessment`,
    source_locator: "official-product-page",
    reviewed_at: status === "verified" ? timestamp : null,
    created_at: timestamp,
    updated_at: timestamp,
    care_role: {
      code,
      display_name: code,
      definition: `${code} role definition`,
      definition_version: 1,
    },
  };
}

function capability(
  code: "hydration" | "barrier_support" | "soothing",
  status: "verified" | "candidate" | "unknown",
  index: number,
  evidence: ReturnType<typeof capabilityEvidence>[] = [],
) {
  return {
    id: `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    catalog_product_id: catalogProductId,
    capability_code: code,
    status,
    confidence: status === "verified" ? 92 : null,
    assessment_note: `${code} assessment`,
    reviewed_at: status === "verified" ? timestamp : null,
    created_at: timestamp,
    updated_at: timestamp,
    capability: {
      code,
      display_name: code,
      definition: `${code} capability definition`,
      definition_version: 1,
    },
    evidence,
  };
}

function capabilityEvidence(
  direction: "supports" | "contradicts",
  reviewStatus: "verified" | "candidate" | "rejected",
  index: number,
) {
  return {
    id: `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    product_capability_id: "40000000-0000-4000-8000-000000000001",
    evidence_type: index === 1
      ? "official_product_description"
      : "manual_curation",
    direction,
    evidence_note: `${direction} evidence`,
    source_locator: "official-product-page",
    confidence: 90,
    review_status: reviewStatus,
    created_at: `2026-08-22T00:00:0${index}.000Z`,
  };
}

describe("ProductKnowledgeRepository", () => {
  it("loads multiple formal snapshots with three deterministic batch queries", async () => {
    const secondId = "10000000-0000-4000-8000-000000000002";
    const ids = [catalogProductId, secondId];
    const identityEq = vi.fn().mockResolvedValue({
      data: [identity, { ...identity, id: secondId, product_name: "Second" }],
      error: null,
    });
    const identityIn = vi.fn().mockReturnValue({ eq: identityEq });
    const roleIn = vi.fn().mockResolvedValue({
      data: [
        careRole("hydration", "verified", "primary", 1),
        { ...careRole("treatment", "verified", "primary", 2), catalog_product_id: secondId },
      ],
      error: null,
    });
    const capabilityIn = vi.fn().mockResolvedValue({ data: [], error: null });
    const from = vi.fn((table: string) => ({
      select: vi.fn().mockReturnValue(table === "catalog_products"
        ? { in: identityIn }
        : { in: table === "catalog_product_care_roles" ? roleIn : capabilityIn }),
    }));
    const repository = createProductKnowledgeRepository(
      { from } as unknown as SupabaseClient<Database>,
    );

    const result = await repository.findByCatalogProductIds!(ids);

    expect(from).toHaveBeenCalledTimes(3);
    expect(identityIn).toHaveBeenCalledWith("id", ids);
    expect(roleIn).toHaveBeenCalledWith("catalog_product_id", ids);
    expect(capabilityIn).toHaveBeenCalledWith("catalog_product_id", ids);
    expect(result.get(catalogProductId)?.care_roles[0]?.care_role_code).toBe("hydration");
    expect(result.get(secondId)?.care_roles[0]?.care_role_code).toBe("treatment");
  });

  it("returns a snapshot with care role data when capability data is absent", async () => {
    const { repository } = setup({
      careRoles: [careRole("hydration", "verified", "primary", 1)],
    });

    const snapshot = await repository.findByCatalogProductId(catalogProductId);

    expect(snapshot?.identity).toMatchObject({
      catalog_product_id: catalogProductId,
      product_type: "serum",
      catalog_status: "verified",
    });
    expect(snapshot?.care_roles).toEqual([
      expect.objectContaining({
        care_role_code: "hydration",
        assignment_kind: "primary",
        status: "verified",
      }),
    ]);
    expect(snapshot?.capabilities).toEqual([]);
  });

  it("returns capability data when care role data is absent", async () => {
    const { repository } = setup({
      capabilities: [capability("soothing", "candidate", 1)],
    });

    const snapshot = await repository.findByCatalogProductId(catalogProductId);

    expect(snapshot?.care_roles).toEqual([]);
    expect(snapshot?.capabilities).toEqual([
      expect.objectContaining({
        capability_code: "soothing",
        status: "candidate",
        evidence_summary: {
          total: 0,
          by_direction: { supports: 0, contradicts: 0 },
          by_review_status: { verified: 0, candidate: 0, rejected: 0 },
        },
      }),
    ]);
  });

  it("preserves multiple roles, capabilities, and every assessment status", async () => {
    const { repository, roleCatalogEq, capabilityCatalogEq } = setup({
      careRoles: [
        careRole("moisturizer", "unknown", "secondary", 3),
        careRole("hydration", "candidate", "secondary", 2),
        careRole("treatment", "verified", "primary", 1),
      ],
      capabilities: [
        capability("soothing", "unknown", 3),
        capability("barrier_support", "candidate", 2),
        capability("hydration", "verified", 1, [
          capabilityEvidence("supports", "verified", 1),
          capabilityEvidence("supports", "candidate", 2),
          capabilityEvidence("contradicts", "rejected", 3),
        ]),
      ],
    });

    const snapshot = await repository.findByCatalogProductId(catalogProductId);

    expect(snapshot?.care_roles.map((role) => [
      role.care_role_code,
      role.assignment_kind,
      role.status,
    ])).toEqual([
      ["treatment", "primary", "verified"],
      ["hydration", "secondary", "candidate"],
      ["moisturizer", "secondary", "unknown"],
    ]);
    expect(snapshot?.capabilities.map((item) => [
      item.capability_code,
      item.status,
    ])).toEqual([
      ["barrier_support", "candidate"],
      ["hydration", "verified"],
      ["soothing", "unknown"],
    ]);

    const hydration = snapshot?.capabilities.find(
      (item) => item.capability_code === "hydration",
    );
    expect(hydration?.evidence_summary).toEqual({
      total: 3,
      by_direction: { supports: 2, contradicts: 1 },
      by_review_status: { verified: 1, candidate: 1, rejected: 1 },
    });
    expect(hydration?.evidence.map((item) => item.review_status)).toEqual([
      "verified",
      "candidate",
      "rejected",
    ]);
    expect(roleCatalogEq).toHaveBeenCalledWith(
      "catalog_product_id",
      catalogProductId,
    );
    expect(capabilityCatalogEq).toHaveBeenCalledWith(
      "catalog_product_id",
      catalogProductId,
    );
    expect(roleCatalogEq).toHaveBeenCalledTimes(1);
    expect(capabilityCatalogEq).toHaveBeenCalledTimes(1);
  });

  it("returns null without querying relations when verified identity is absent", async () => {
    const { repository, from } = setup({ identity: null });

    await expect(
      repository.findByCatalogProductId(catalogProductId),
    ).resolves.toBeNull();
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("catalog_products");
  });
});

function setup(options: {
  identity?: typeof identity | null;
  careRoles?: ReturnType<typeof careRole>[];
  capabilities?: ReturnType<typeof capability>[];
} = {}) {
  const identityMaybeSingle = vi.fn().mockResolvedValue({
    data: options.identity === undefined ? identity : options.identity,
    error: null,
  });
  const identityStatusEq = vi.fn().mockReturnValue({
    maybeSingle: identityMaybeSingle,
  });
  const identityIdEq = vi.fn().mockReturnValue({ eq: identityStatusEq });
  const identitySelect = vi.fn().mockReturnValue({ eq: identityIdEq });

  const roleCatalogEq = vi.fn().mockResolvedValue({
    data: options.careRoles ?? [],
    error: null,
  });
  const roleSelect = vi.fn().mockReturnValue({ eq: roleCatalogEq });

  const capabilityCatalogEq = vi.fn().mockResolvedValue({
    data: options.capabilities ?? [],
    error: null,
  });
  const capabilitySelect = vi.fn().mockReturnValue({
    eq: capabilityCatalogEq,
  });

  const from = vi.fn((table: string) => {
    if (table === "catalog_products") return { select: identitySelect };
    if (table === "catalog_product_care_roles") {
      return { select: roleSelect };
    }
    if (table === "catalog_product_capabilities") {
      return { select: capabilitySelect };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  const client = { from } as unknown as SupabaseClient<Database>;
  return {
    from,
    roleCatalogEq,
    capabilityCatalogEq,
    repository: createProductKnowledgeRepository(client),
  };
}
