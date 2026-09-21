import type { KnowledgeCandidate } from "@/schemas/knowledge-candidate";
import type { ProductKnowledgeReview } from "@/schemas/product-knowledge-review";

import type {
  ProductKnowledgeReviewIssue,
  ProductKnowledgeReviewValidationResult,
} from "./types";

export function validateProductKnowledgeReview(
  candidate: KnowledgeCandidate,
  review: ProductKnowledgeReview,
): ProductKnowledgeReviewValidationResult {
  const errors: ProductKnowledgeReviewIssue[] = [];
  const warnings: ProductKnowledgeReviewIssue[] = [];
  const requireTrue = (
    condition: boolean,
    code: string,
    message: string,
    path: string[],
  ) => {
    if (!condition) errors.push({ code, message, path });
  };

  requireTrue(
    review.candidate_id === candidate.candidate_id,
    "REVIEW_CANDIDATE_MISMATCH",
    "Review Manifest 与 Candidate 的 candidate_id 不一致。",
    ["candidate_id"],
  );
  requireTrue(
    review.identity_review.approved,
    "REVIEW_IDENTITY_NOT_APPROVED",
    "产品身份尚未整体批准。",
    ["identity_review", "approved"],
  );
  requireTrue(
    review.identity_review.brand_name_confirmed,
    "REVIEW_BRAND_NAME_NOT_CONFIRMED",
    "brand_name 尚未人工确认。",
    ["identity_review", "brand_name_confirmed"],
  );
  requireTrue(
    review.identity_review.product_name_confirmed,
    "REVIEW_PRODUCT_NAME_NOT_CONFIRMED",
    "product_name 尚未人工确认。",
    ["identity_review", "product_name_confirmed"],
  );
  requireTrue(
    review.identity_review.variant_confirmed,
    "REVIEW_VARIANT_NOT_CONFIRMED",
    "variant（包括确认无 variant）尚未人工确认。",
    ["identity_review", "variant_confirmed"],
  );

  if (candidate.identity_candidate.brand_name === null) {
    errors.push({
      code: "REVIEW_BRAND_NAME_MISSING",
      message: "Candidate 缺少 brand_name，当前 v0.1 不能编译 verified identity。",
      path: ["identity_candidate", "brand_name"],
    });
  }
  if (candidate.identity_candidate.product_name === null) {
    errors.push({
      code: "REVIEW_PRODUCT_NAME_MISSING",
      message: "Candidate 缺少 product_name，当前 v0.1 不能编译 verified identity。",
      path: ["identity_candidate", "product_name"],
    });
  }
  if (review.identity_review.confidence === null) {
    errors.push({
      code: "REVIEW_IDENTITY_CONFIDENCE_MISSING",
      message: "已审核 identity 必须填写 confidence。",
      path: ["identity_review", "confidence"],
    });
  }

  const reviewedProductType = review.classification_review.product_type;
  requireTrue(
    reviewedProductType.approved,
    "REVIEW_PRODUCT_TYPE_NOT_APPROVED",
    "product_type 尚未人工批准。",
    ["classification_review", "product_type", "approved"],
  );
  if (reviewedProductType.value === null) {
    errors.push({
      code: "REVIEW_PRODUCT_TYPE_MISSING",
      message: "必须选择一个 product_type。",
      path: ["classification_review", "product_type", "value"],
    });
  }

  const reviewedRole = review.decision_review.primary_role;
  requireTrue(
    reviewedRole.approved,
    "REVIEW_PRIMARY_ROLE_NOT_APPROVED",
    "primary_role 尚未人工批准。",
    ["decision_review", "primary_role", "approved"],
  );
  if (reviewedRole.value === null) {
    errors.push({
      code: "REVIEW_PRIMARY_ROLE_MISSING",
      message: "必须选择一个 primary_role。",
      path: ["decision_review", "primary_role", "value"],
    });
  }
  if (reviewedRole.confidence === null) {
    errors.push({
      code: "REVIEW_PRIMARY_ROLE_CONFIDENCE_MISSING",
      message: "已审核 primary_role 必须填写 confidence。",
      path: ["decision_review", "primary_role", "confidence"],
    });
  }
  if (reviewedRole.evidence_source === null) {
    errors.push({
      code: "REVIEW_PRIMARY_ROLE_EVIDENCE_MISSING",
      message: "已审核 primary_role 必须填写 evidence_source。",
      path: ["decision_review", "primary_role", "evidence_source"],
    });
  }
  if (review.review_metadata.reviewed_by === null) {
    errors.push({
      code: "REVIEWER_MISSING",
      message: "必须记录 reviewed_by。",
      path: ["review_metadata", "reviewed_by"],
    });
  }
  if (review.review_metadata.reviewed_at === null) {
    errors.push({
      code: "REVIEW_TIMESTAMP_MISSING",
      message: "必须记录 reviewed_at。",
      path: ["review_metadata", "reviewed_at"],
    });
  }

  if (
    reviewedProductType.value !== null
    && candidate.classification_candidate.product_type !== null
    && reviewedProductType.value !== candidate.classification_candidate.product_type
  ) {
    warnings.push({
      code: "REVIEW_PRODUCT_TYPE_OVERRIDES_CANDIDATE",
      message: "人工确认的 product_type 覆盖了 Candidate 建议。",
      path: ["classification_review", "product_type", "value"],
    });
  }
  if (
    reviewedRole.value !== null
    && candidate.decision_candidate.primary_role.value !== null
    && reviewedRole.value !== candidate.decision_candidate.primary_role.value
  ) {
    warnings.push({
      code: "REVIEW_PRIMARY_ROLE_OVERRIDES_CANDIDATE",
      message: "人工确认的 primary_role 覆盖了 Candidate 建议。",
      path: ["decision_review", "primary_role", "value"],
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}
