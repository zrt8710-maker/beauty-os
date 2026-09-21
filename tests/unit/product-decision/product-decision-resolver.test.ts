import { describe, expect, it, vi } from "vitest";

import type {
  ProductKnowledgeCapability,
  ProductKnowledgeCareRole,
  ProductKnowledgeSnapshot,
} from "@/schemas/product-knowledge";
import {
  resolveProductDecisionProfile,
  type ProductDecisionProduct,
} from "@/server/domain/product-decision";
import { createProductDecisionResolverService } from "@/server/services/product-decision-resolver-service";

describe("Product Decision Resolver domain", () => {
  it("creates a usable unknown-knowledge profile from product_type only", () => {
    expect(resolveProductDecisionProfile({
      product: product({ product_type: "serum", catalog_product_id: null }),
      knowledge: null,
    })).toEqual({
      product_id: PRODUCT_ID,
      catalog_product_id: null,
      primary_role: "treatment",
      primary_role_source: "product_type_fallback",
      secondary_roles: [],
      capabilities: [],
      period_eligibility: ["am", "pm"],
      caution_codes: [],
      knowledge_status: "unknown",
      confidence: null,
    });
  });

  it("uses verified roles and capabilities to enhance the fallback", () => {
    const resolved = resolveProductDecisionProfile({
      product: product(),
      knowledge: snapshot({
        care_roles: [
          role({
            care_role_code: "cleanser",
            assignment_kind: "primary",
            status: "verified",
            confidence: 92,
          }),
          role({
            care_role_code: "remover",
            assignment_kind: "secondary",
            status: "verified",
            confidence: 84,
          }),
          role({
            care_role_code: "hydration",
            assignment_kind: "secondary",
            status: "candidate",
            confidence: 75,
          }),
        ],
        capabilities: [
          capability({
            capability_code: "soothing",
            status: "verified",
            confidence: 88,
          }),
          capability({
            capability_code: "hydration",
            status: "candidate",
            confidence: 70,
          }),
        ],
      }),
    });

    expect(resolved).toMatchObject({
      primary_role: "cleanser",
      primary_role_source: "verified_knowledge",
      secondary_roles: ["remover"],
      capabilities: [{ code: "soothing", confidence: 88 }],
      period_eligibility: ["am", "pm"],
      knowledge_status: "verified",
      confidence: 84,
    });
  });

  it("does not let candidate knowledge change fallback decisions", () => {
    const resolved = resolveProductDecisionProfile({
      product: product(),
      knowledge: snapshot({
        care_roles: [role({
          care_role_code: "cleanser",
          assignment_kind: "primary",
          status: "candidate",
          confidence: 70,
        })],
        capabilities: [capability({
          capability_code: "soothing",
          status: "candidate",
          confidence: 70,
        })],
      }),
    });

    expect(resolved).toMatchObject({
      primary_role: "treatment",
      primary_role_source: "product_type_fallback",
      capabilities: [],
      knowledge_status: "candidate",
      confidence: null,
    });
  });

  it("keeps unsupported product types explicit instead of inventing a role", () => {
    expect(resolveProductDecisionProfile({
      product: product({ product_type: "foundation" }),
      knowledge: null,
    })).toMatchObject({
      primary_role: null,
      period_eligibility: [],
      knowledge_status: "unknown",
    });
  });

  it("copies only positive safety matches and never infers safety from absence", () => {
    const unknown = resolveProductDecisionProfile({
      product: product(),
      knowledge: null,
    });
    const matched = resolveProductDecisionProfile({
      product: product(),
      knowledge: null,
      safetySignals: { cautionCodes: ["AVOID_INGREDIENT_MATCH"] },
    });

    expect(unknown.caution_codes).toEqual([]);
    expect(unknown.knowledge_status).toBe("unknown");
    expect(matched.caution_codes).toEqual(["AVOID_INGREDIENT_MATCH"]);
  });
});

describe("Product Decision Resolver service", () => {
  it("does not query Product Knowledge without a catalog link", async () => {
    const findByCatalogProductId = vi.fn();
    const resolver = createProductDecisionResolverService({
      findByCatalogProductId,
    });

    const resolved = await resolver.resolve(product({
      catalog_product_id: null,
    }));

    expect(findByCatalogProductId).not.toHaveBeenCalled();
    expect(resolved.primary_role).toBe("treatment");
    expect(resolved.knowledge_status).toBe("unknown");
  });

  it("isolates knowledge repository errors and preserves fallback", async () => {
    const resolver = createProductDecisionResolverService({
      findByCatalogProductId: vi.fn().mockRejectedValue(
        new Error("KNOWLEDGE_UNAVAILABLE"),
      ),
    });

    await expect(resolver.resolve(product())).resolves.toMatchObject({
      primary_role: "treatment",
      primary_role_source: "product_type_fallback",
      knowledge_status: "unknown",
    });
  });

  it("resolves a mixed product collection without blocking unknown products", async () => {
    const resolver = createProductDecisionResolverService({
      findByCatalogProductId: vi.fn().mockResolvedValue(snapshot({
        care_roles: [role({
          care_role_code: "moisturizer",
          assignment_kind: "primary",
          status: "verified",
          confidence: 95,
        })],
      })),
    });

    const profiles = await resolver.resolveMany([
      product(),
      product({ id: SECOND_PRODUCT_ID, catalog_product_id: null }),
    ]);

    expect(profiles).toHaveLength(2);
    expect(profiles[0]).toMatchObject({
      primary_role: "moisturizer",
      knowledge_status: "verified",
    });
    expect(profiles[1]).toMatchObject({
      product_id: SECOND_PRODUCT_ID,
      primary_role: "treatment",
      knowledge_status: "unknown",
    });
  });
});

const PRODUCT_ID = "20000000-0000-4000-8000-000000000001";
const SECOND_PRODUCT_ID = "20000000-0000-4000-8000-000000000002";
const CATALOG_PRODUCT_ID = "10000000-0000-4000-8000-000000000001";

function product(
  patch: Partial<ProductDecisionProduct> = {},
): ProductDecisionProduct {
  return {
    id: PRODUCT_ID,
    product_type: "serum",
    catalog_product_id: CATALOG_PRODUCT_ID,
    ...patch,
  };
}

function snapshot(
  patch: Partial<ProductKnowledgeSnapshot> = {},
): ProductKnowledgeSnapshot {
  return {
    identity: {
      catalog_product_id: CATALOG_PRODUCT_ID,
      brand_name: "Beauty OS",
      product_name: "Decision Product",
      variant_name: null,
      barcode: null,
      category: "skincare",
      subcategory: "face_care",
      product_type: "serum",
      primary_source_id: "30000000-0000-4000-8000-000000000001",
      identity_confidence: 95,
      catalog_status: "verified",
      created_at: "2026-08-24T00:00:00.000Z",
      updated_at: "2026-08-24T00:00:00.000Z",
    },
    care_roles: [],
    capabilities: [],
    ...patch,
  };
}

function role(
  patch: Partial<ProductKnowledgeCareRole> = {},
): ProductKnowledgeCareRole {
  return {
    assignment_id: "40000000-0000-4000-8000-000000000001",
    care_role_code: "treatment",
    display_name: "针对性护理",
    definition: "承担针对性护理步骤。",
    definition_version: 1,
    assignment_kind: "primary",
    status: "unknown",
    confidence: null,
    assessment_note: null,
    source_locator: null,
    reviewed_at: null,
    created_at: "2026-08-24T00:00:00.000Z",
    updated_at: "2026-08-24T00:00:00.000Z",
    ...patch,
  };
}

function capability(
  patch: Partial<ProductKnowledgeCapability> = {},
): ProductKnowledgeCapability {
  return {
    product_capability_id: "50000000-0000-4000-8000-000000000001",
    capability_code: "hydration",
    display_name: "补水",
    definition: "帮助皮肤补充或维持水分。",
    definition_version: 1,
    status: "unknown",
    confidence: null,
    assessment_note: null,
    reviewed_at: null,
    created_at: "2026-08-24T00:00:00.000Z",
    updated_at: "2026-08-24T00:00:00.000Z",
    evidence_summary: {
      total: 0,
      by_direction: { supports: 0, contradicts: 0 },
      by_review_status: { verified: 0, candidate: 0, rejected: 0 },
    },
    evidence: [],
    ...patch,
  };
}
