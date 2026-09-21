import type {
  CapabilityAssessmentInput,
  CapabilityEvidenceInput,
  ProductKnowledgeCurationInput,
} from "@/schemas/product-knowledge-curation";

import type {
  ProductKnowledgeCurationError,
  ProductKnowledgeCurationValidationResult,
  ProductKnowledgeCurationWarning,
} from "./types";

const EVIDENCE_TYPES_REQUIRING_SOURCE = new Set<
  CapabilityEvidenceInput["evidence_type"]
>([
  "official_product_description",
  "external_dataset",
]);

export function validateProductKnowledgeCuration(
  input: ProductKnowledgeCurationInput,
): ProductKnowledgeCurationValidationResult {
  const errors: ProductKnowledgeCurationError[] = [];
  const warnings: ProductKnowledgeCurationWarning[] = [];

  validatePrimaryRoles(input, warnings);

  input.capabilities.forEach((capability, capabilityIndex) => {
    validateCapability(capability, capabilityIndex, errors, warnings);
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function validatePrimaryRoles(
  input: ProductKnowledgeCurationInput,
  warnings: ProductKnowledgeCurationWarning[],
) {
  const primaryRoles = input.roles.filter(
    (role) => role.assignment_kind === "primary" && role.status !== "unknown",
  );

  if (primaryRoles.length <= 1) return;

  warnings.push({
    code: "PRIMARY_ROLE_CONFLICT",
    message: `存在多个非 unknown primary role：${primaryRoles
      .map((role) => role.care_role_code)
      .join("、")}。`,
    path: ["roles"],
  });
}

function validateCapability(
  capability: CapabilityAssessmentInput,
  capabilityIndex: number,
  errors: ProductKnowledgeCurationError[],
  warnings: ProductKnowledgeCurationWarning[],
) {
  const verifiedSupportingEvidence = capability.evidence.some(
    (evidence) =>
      evidence.direction === "supports"
      && evidence.review_status === "verified",
  );

  if (capability.status === "verified" && !verifiedSupportingEvidence) {
    errors.push({
      code: "VERIFIED_CAPABILITY_MISSING_VERIFIED_SUPPORTING_EVIDENCE",
      message: `verified capability ${capability.capability_code} 必须至少有一条 verified supporting evidence。`,
      path: ["capabilities", capabilityIndex, "evidence"],
    });
  }

  const hasVerifiedContradictingEvidence = capability.evidence.some(
    (evidence) =>
      evidence.direction === "contradicts"
      && evidence.review_status === "verified",
  );

  if (
    capability.status === "verified"
    && hasVerifiedContradictingEvidence
  ) {
    if (capability.assessment_note === null) {
      errors.push({
        code: "VERIFIED_CAPABILITY_CONTRADICTION_UNRESOLVED",
        message: `verified capability ${capability.capability_code} 存在 verified contradicting evidence，必须在 assessment_note 中记录人工裁决。`,
        path: ["capabilities", capabilityIndex, "assessment_note"],
      });
    }

    warnings.push({
      code: "VERIFIED_CAPABILITY_HAS_VERIFIED_CONTRADICTING_EVIDENCE",
      message: `verified capability ${capability.capability_code} 同时存在 verified contradicting evidence，请人工复核结论。`,
      path: ["capabilities", capabilityIndex, "evidence"],
    });
  }

  capability.evidence.forEach((evidence, evidenceIndex) => {
    validateEvidence(
      evidence,
      capabilityIndex,
      evidenceIndex,
      errors,
    );
  });
}

function validateEvidence(
  evidence: CapabilityEvidenceInput,
  capabilityIndex: number,
  evidenceIndex: number,
  errors: ProductKnowledgeCurationError[],
) {
  const path = ["capabilities", capabilityIndex, "evidence", evidenceIndex];

  if (
    EVIDENCE_TYPES_REQUIRING_SOURCE.has(evidence.evidence_type)
    && evidence.source_locator === null
  ) {
    errors.push({
      code: "EVIDENCE_SOURCE_LOCATOR_REQUIRED",
      message: `${evidence.evidence_type} evidence 必须提供 source_locator。`,
      path: [...path, "source_locator"],
    });
  }
}
