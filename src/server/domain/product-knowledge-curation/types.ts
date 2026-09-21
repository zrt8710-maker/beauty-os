export const PRODUCT_KNOWLEDGE_CURATION_ERROR_CODES = [
  "VERIFIED_CAPABILITY_MISSING_VERIFIED_SUPPORTING_EVIDENCE",
  "VERIFIED_CAPABILITY_CONTRADICTION_UNRESOLVED",
  "EVIDENCE_SOURCE_LOCATOR_REQUIRED",
] as const;

export const PRODUCT_KNOWLEDGE_CURATION_WARNING_CODES = [
  "PRIMARY_ROLE_CONFLICT",
  "VERIFIED_CAPABILITY_HAS_VERIFIED_CONTRADICTING_EVIDENCE",
] as const;

export type ProductKnowledgeCurationErrorCode =
  (typeof PRODUCT_KNOWLEDGE_CURATION_ERROR_CODES)[number];

export type ProductKnowledgeCurationWarningCode =
  (typeof PRODUCT_KNOWLEDGE_CURATION_WARNING_CODES)[number];

export type ProductKnowledgeCurationIssuePath = Array<string | number>;

export type ProductKnowledgeCurationError = {
  code: ProductKnowledgeCurationErrorCode;
  message: string;
  path: ProductKnowledgeCurationIssuePath;
};

export type ProductKnowledgeCurationWarning = {
  code: ProductKnowledgeCurationWarningCode;
  message: string;
  path: ProductKnowledgeCurationIssuePath;
};

export type ProductKnowledgeCurationValidationResult = {
  valid: boolean;
  errors: ProductKnowledgeCurationError[];
  warnings: ProductKnowledgeCurationWarning[];
};
