import { describe, expect, it } from "vitest";

import {
  PRODUCT_KNOWLEDGE_CURATION_SCHEMA_VERSION,
  capabilityAssessmentInputSchema,
  capabilityEvidenceInputSchema,
  productKnowledgeCurationInputSchema,
  roleAssignmentInputSchema,
} from "@/schemas/product-knowledge-curation";

const catalogProductId = "10000000-0000-4000-8000-000000000001";

const verifiedEvidence = {
  evidence_type: "official_product_description",
  direction: "supports",
  evidence_note: "官方产品说明明确描述该护理能力。",
  source_locator: "https://example.com/products/knowledge-serum",
  confidence: 95,
  review_status: "verified",
};

describe("productKnowledgeCurationInputSchema", () => {
  it("接受包含 role、capability 和 evidence 的 v0.1 录入数据", () => {
    const result = productKnowledgeCurationInputSchema.safeParse({
      schema_version: PRODUCT_KNOWLEDGE_CURATION_SCHEMA_VERSION,
      catalog_product_id: catalogProductId,
      roles: [
        {
          care_role_code: "treatment",
          assignment_kind: "primary",
          status: "verified",
          confidence: 92,
          assessment_note: "作为功效护理步骤使用。",
          source_locator: "official-product-page",
          reviewed_at: "2026-08-24T10:00:00+08:00",
        },
      ],
      capabilities: [
        {
          capability_code: "soothing",
          status: "verified",
          confidence: 88,
          assessment_note: "官方资料支持舒缓能力。",
          reviewed_at: "2026-08-24T10:00:00+08:00",
          evidence: [verifiedEvidence],
        },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.roles[0]?.care_role_code).toBe("treatment");
    expect(result.data.capabilities[0]?.evidence).toHaveLength(1);
  });

  it("允许 candidate 和 unknown 不提供 confidence，并规范化为 null", () => {
    const result = productKnowledgeCurationInputSchema.safeParse({
      schema_version: PRODUCT_KNOWLEDGE_CURATION_SCHEMA_VERSION,
      catalog_product_id: catalogProductId,
      roles: [
        {
          care_role_code: "hydration",
          assignment_kind: "secondary",
          status: "candidate",
        },
      ],
      capabilities: [
        {
          capability_code: "barrier_support",
          status: "unknown",
        },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.roles[0]?.confidence).toBeNull();
    expect(result.data.capabilities[0]?.confidence).toBeNull();
    expect(result.data.capabilities[0]?.evidence).toEqual([]);
  });

  it("拒绝未提供 confidence 的 verified role", () => {
    const result = roleAssignmentInputSchema.safeParse({
      care_role_code: "moisturizer",
      assignment_kind: "primary",
      status: "verified",
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["confidence"] }),
      ]),
    );
  });

  it("拒绝未提供 confidence 的 verified capability", () => {
    const result = capabilityAssessmentInputSchema.safeParse({
      capability_code: "hydration",
      status: "verified",
      evidence: [verifiedEvidence],
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ["confidence"] }),
      ]),
    );
  });

  it("拒绝未知版本、非法 UUID、越界 confidence 和未知 taxonomy code", () => {
    const invalidInputs = [
      {
        schema_version: "product-knowledge-curation/v0.2",
        catalog_product_id: catalogProductId,
      },
      {
        schema_version: PRODUCT_KNOWLEDGE_CURATION_SCHEMA_VERSION,
        catalog_product_id: "not-a-uuid",
      },
      {
        care_role_code: "toner",
        assignment_kind: "primary",
        status: "candidate",
        confidence: 101,
      },
      {
        capability_code: "brightening",
        status: "candidate",
      },
    ];

    expect(productKnowledgeCurationInputSchema.safeParse(invalidInputs[0]).success)
      .toBe(false);
    expect(productKnowledgeCurationInputSchema.safeParse(invalidInputs[1]).success)
      .toBe(false);
    expect(roleAssignmentInputSchema.safeParse(invalidInputs[2]).success)
      .toBe(false);
    expect(capabilityAssessmentInputSchema.safeParse(invalidInputs[3]).success)
      .toBe(false);
  });

  it("校验 evidence 枚举、必填说明和 confidence 范围", () => {
    expect(capabilityEvidenceInputSchema.safeParse(verifiedEvidence).success)
      .toBe(true);

    expect(
      capabilityEvidenceInputSchema.safeParse({
        ...verifiedEvidence,
        direction: "neutral",
        evidence_note: " ",
        confidence: -1,
      }).success,
    ).toBe(false);
  });

  it("接受 confidence 边界值，并拒绝小数、verified null 和未知字段", () => {
    expect(
      roleAssignmentInputSchema.safeParse({
        care_role_code: "remover",
        assignment_kind: "primary",
        status: "verified",
        confidence: 0,
      }).success,
    ).toBe(true);
    expect(
      capabilityAssessmentInputSchema.safeParse({
        capability_code: "sun_protection",
        status: "verified",
        confidence: 100,
      }).success,
    ).toBe(true);
    expect(
      capabilityAssessmentInputSchema.safeParse({
        capability_code: "hydration",
        status: "candidate",
        confidence: 50.5,
      }).success,
    ).toBe(false);
    expect(
      roleAssignmentInputSchema.safeParse({
        care_role_code: "cleanser",
        assignment_kind: "primary",
        status: "verified",
        confidence: null,
      }).success,
    ).toBe(false);
    expect(
      productKnowledgeCurationInputSchema.safeParse({
        schema_version: PRODUCT_KNOWLEDGE_CURATION_SCHEMA_VERSION,
        catalog_product_id: catalogProductId,
        unknown_field: true,
      }).success,
    ).toBe(false);
  });

  it("拒绝同一产品内重复的 role 或 capability 声明", () => {
    const duplicatedRole = {
      care_role_code: "cleanser",
      assignment_kind: "primary",
      status: "candidate",
    };
    const duplicatedCapability = {
      capability_code: "oil_balance",
      status: "candidate",
    };

    const result = productKnowledgeCurationInputSchema.safeParse({
      schema_version: PRODUCT_KNOWLEDGE_CURATION_SCHEMA_VERSION,
      catalog_product_id: catalogProductId,
      roles: [duplicatedRole, duplicatedRole],
      capabilities: [duplicatedCapability, duplicatedCapability],
    });

    expect(result.success).toBe(false);
  });
});
