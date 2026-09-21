import { describe, expect, it } from "vitest";

import {
  PRODUCT_KNOWLEDGE_CURATION_SCHEMA_VERSION,
  productKnowledgeCurationInputSchema,
} from "@/schemas/product-knowledge-curation";
import { validateProductKnowledgeCuration } from "@/server/domain/product-knowledge-curation";

const catalogProductId = "10000000-0000-4000-8000-000000000001";

describe("validateProductKnowledgeCuration", () => {
  it("接受具备 verified supporting evidence 的 verified capability", () => {
    const result = validate({
      capabilities: [
        capability("hydration", "verified", [
          evidence({
            direction: "supports",
            review_status: "verified",
          }),
        ]),
      ],
    });

    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it.each([
    ["没有 evidence", []],
    ["只有 candidate supporting evidence", [evidence({
      direction: "supports",
      review_status: "candidate",
    })]],
    ["只有 rejected supporting evidence", [evidence({
      direction: "supports",
      review_status: "rejected",
    })]],
    ["只有 verified contradicting evidence", [evidence({
      direction: "contradicts",
      review_status: "verified",
    })]],
  ])("拒绝%s的 verified capability", (_case, evidenceItems) => {
    const result = validate({
      capabilities: [capability("barrier_support", "verified", evidenceItems)],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain(
      "VERIFIED_CAPABILITY_MISSING_VERIFIED_SUPPORTING_EVIDENCE",
    );
  });

  it("保持 evidence confidence 的 nullable 语义", () => {
    const result = validate({
      capabilities: [
        capability("soothing", "candidate", [
          evidence({
            evidence_type: "manual_curation",
            review_status: "verified",
            confidence: null,
            source_locator: null,
          }),
        ]),
      ],
    });

    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it.each([
    "official_product_description",
    "external_dataset",
  ] as const)("要求 %s evidence 提供 source_locator", (evidenceType) => {
    const result = validate({
      capabilities: [
        capability("oil_balance", "candidate", [
          evidence({
            evidence_type: evidenceType,
            review_status: "candidate",
            confidence: null,
            source_locator: null,
          }),
        ]),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "EVIDENCE_SOURCE_LOCATOR_REQUIRED",
        path: ["capabilities", 0, "evidence", 0, "source_locator"],
      }),
    ]);
  });

  it("允许 manual curation evidence 不提供 source_locator", () => {
    const result = validate({
      capabilities: [
        capability("soothing", "candidate", [
          evidence({
            evidence_type: "manual_curation",
            review_status: "candidate",
            confidence: null,
            source_locator: null,
          }),
        ]),
      ],
    });

    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it("将多个非 unknown primary role 报告为 warning，但不使结果失效", () => {
    const result = validate({
      roles: [
        role("hydration", "primary", "verified"),
        role("treatment", "primary", "candidate"),
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "PRIMARY_ROLE_CONFLICT",
        path: ["roles"],
      }),
    ]);
  });

  it("unknown primary role 不参与 primary 冲突判断", () => {
    const result = validate({
      roles: [
        role("cleanser", "primary", "verified"),
        role("remover", "primary", "unknown"),
      ],
    });

    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it("要求人工说明 verified capability 的 verified 反向证据", () => {
    const result = validate({
      capabilities: [
        capability("hydration", "verified", [
          evidence({ direction: "supports", review_status: "verified" }),
          evidence({ direction: "contradicts", review_status: "verified" }),
        ]),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "VERIFIED_CAPABILITY_CONTRADICTION_UNRESOLVED",
        path: ["capabilities", 0, "assessment_note"],
      }),
    ]);
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "VERIFIED_CAPABILITY_HAS_VERIFIED_CONTRADICTING_EVIDENCE",
    );
  });

  it("已记录人工裁决时保留反向证据 warning，但不阻断录入", () => {
    const result = validate({
      capabilities: [
        capability("hydration", "verified", [
          evidence({ direction: "supports", review_status: "verified" }),
          evidence({ direction: "contradicts", review_status: "verified" }),
        ], "已复核反向证据，官方说明仍足以支持该结论。"),
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "VERIFIED_CAPABILITY_HAS_VERIFIED_CONTRADICTING_EVIDENCE",
    );
  });

  it("保持 candidate/unknown 语义，不要求 supporting evidence 或自动修改状态", () => {
    const input = parseInput({
      capabilities: [
        capability("barrier_support", "candidate", []),
        capability("soothing", "unknown", []),
      ],
    });
    const before = structuredClone(input);

    const result = validateProductKnowledgeCuration(input);

    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
    expect(input).toEqual(before);
    expect(input.capabilities.map((item) => item.status)).toEqual([
      "candidate",
      "unknown",
    ]);
  });

  it("不从 role 推导 capability，也不从 capability 推导 role", () => {
    const roleOnly = validate({
      roles: [role("moisturizer", "primary", "verified")],
    });
    const capabilityOnly = validate({
      capabilities: [capability("barrier_support", "candidate", [])],
    });

    expect(roleOnly).toEqual({ valid: true, errors: [], warnings: [] });
    expect(capabilityOnly).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it("secondary role 不产生 primary 冲突 warning", () => {
    const result = validate({
      roles: [
        role("hydration", "primary", "verified"),
        role("treatment", "secondary", "verified"),
      ],
    });

    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });
});

type RawCurationInput = Parameters<typeof parseInput>[0];

function validate(input: RawCurationInput) {
  return validateProductKnowledgeCuration(parseInput(input));
}

function parseInput(
  input: Partial<{
    roles: ReturnType<typeof role>[];
    capabilities: ReturnType<typeof capability>[];
  }>,
) {
  return productKnowledgeCurationInputSchema.parse({
    schema_version: PRODUCT_KNOWLEDGE_CURATION_SCHEMA_VERSION,
    catalog_product_id: catalogProductId,
    ...input,
  });
}

function role(
  careRoleCode:
    | "remover"
    | "cleanser"
    | "hydration"
    | "treatment"
    | "moisturizer",
  assignmentKind: "primary" | "secondary",
  status: "verified" | "candidate" | "unknown",
) {
  return {
    care_role_code: careRoleCode,
    assignment_kind: assignmentKind,
    status,
    confidence: status === "verified" ? 90 : null,
  } as const;
}

function capability(
  capabilityCode:
    | "hydration"
    | "barrier_support"
    | "soothing"
    | "oil_balance",
  status: "verified" | "candidate" | "unknown",
  evidenceItems: ReturnType<typeof evidence>[],
  assessmentNote: string | null = null,
) {
  return {
    capability_code: capabilityCode,
    status,
    confidence: status === "verified" ? 90 : null,
    assessment_note: assessmentNote,
    evidence: evidenceItems,
  } as const;
}

function evidence(
  override: Partial<{
    evidence_type:
      | "official_product_description"
      | "manual_curation"
      | "external_dataset";
    direction: "supports" | "contradicts";
    source_locator: string | null;
    confidence: number | null;
    review_status: "verified" | "candidate" | "rejected";
  }> = {},
) {
  return {
    evidence_type: "official_product_description",
    direction: "supports",
    evidence_note: "人工核对后的证据摘要。",
    source_locator: "https://example.com/products/source",
    confidence: 90,
    review_status: "verified",
    ...override,
  } as const;
}
