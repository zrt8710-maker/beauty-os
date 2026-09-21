import type { CatalogSeedInput } from "@/schemas/catalog-seed";

export const CATALOG_SEED_VALIDATION_ERROR_CODES = [
  "CATALOG_SEED_SCHEMA_INVALID",
  "CATALOG_SEED_PRODUCT_TYPE_CATEGORY_MISMATCH",
  "CATALOG_SEED_PRODUCT_TYPE_SUBCATEGORY_MISMATCH",
  "CATALOG_SEED_VERIFIED_AI_CANDIDATE_SOURCE_FORBIDDEN",
] as const;

export const CATALOG_SEED_VALIDATION_WARNING_CODES = [
  "CATALOG_SEED_BARCODE_MISSING",
  "CATALOG_SEED_SOURCE_URL_MISSING",
  "CATALOG_SEED_NON_OFFICIAL_BRAND_SOURCE",
] as const;

export type CatalogSeedValidationErrorCode =
  (typeof CATALOG_SEED_VALIDATION_ERROR_CODES)[number];

export type CatalogSeedValidationWarningCode =
  (typeof CATALOG_SEED_VALIDATION_WARNING_CODES)[number];

export type CatalogSeedValidationIssuePath = Array<string | number>;

export type CatalogSeedValidationError = {
  code: CatalogSeedValidationErrorCode;
  message: string;
  path: CatalogSeedValidationIssuePath;
};

export type CatalogSeedValidationWarning = {
  code: CatalogSeedValidationWarningCode;
  message: string;
  path: CatalogSeedValidationIssuePath;
};

export type CatalogSeedValidationResult = {
  valid: boolean;
  input: CatalogSeedInput | null;
  errors: CatalogSeedValidationError[];
  warnings: CatalogSeedValidationWarning[];
};
