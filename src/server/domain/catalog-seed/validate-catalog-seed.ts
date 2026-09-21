import { catalogSeedInputSchema } from "@/schemas/catalog-seed";
import { PRODUCT_TYPE_META } from "@/schemas/product";

import type {
  CatalogSeedValidationError,
  CatalogSeedValidationIssuePath,
  CatalogSeedValidationResult,
  CatalogSeedValidationWarning,
} from "./types";

export function validateCatalogSeed(input: unknown): CatalogSeedValidationResult {
  const parsed = catalogSeedInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      valid: false,
      input: null,
      errors: parsed.error.issues.map((issue) => ({
        code: "CATALOG_SEED_SCHEMA_INVALID",
        message: issue.message,
        path: toIssuePath(issue.path),
      })),
      warnings: [],
    };
  }

  const validatedInput = parsed.data;
  const errors: CatalogSeedValidationError[] = [];
  const warnings: CatalogSeedValidationWarning[] = [];
  const expectedProductType = PRODUCT_TYPE_META[
    validatedInput.identity.product_type
  ];

  if (validatedInput.identity.category !== expectedProductType.category) {
    errors.push({
      code: "CATALOG_SEED_PRODUCT_TYPE_CATEGORY_MISMATCH",
      message:
        `product_type ${validatedInput.identity.product_type} 的 category 必须为 ${expectedProductType.category}。`,
      path: ["identity", "category"],
    });
  }

  if (
    validatedInput.identity.subcategory !== expectedProductType.subcategory
  ) {
    errors.push({
      code: "CATALOG_SEED_PRODUCT_TYPE_SUBCATEGORY_MISMATCH",
      message:
        `product_type ${validatedInput.identity.product_type} 的 subcategory 必须为 ${expectedProductType.subcategory}。`,
      path: ["identity", "subcategory"],
    });
  }

  if (
    validatedInput.identity.status === "verified"
    && validatedInput.source.source_type === "ai_candidate"
  ) {
    errors.push({
      code: "CATALOG_SEED_VERIFIED_AI_CANDIDATE_SOURCE_FORBIDDEN",
      message: "verified catalog product 不能以 ai_candidate 作为来源。",
      path: ["source", "source_type"],
    });
  }

  if (validatedInput.identity.barcode === null) {
    warnings.push({
      code: "CATALOG_SEED_BARCODE_MISSING",
      message: "缺少 barcode，产品无法通过条码精确匹配。",
      path: ["identity", "barcode"],
    });
  }

  if (validatedInput.source.source_url === null) {
    warnings.push({
      code: "CATALOG_SEED_SOURCE_URL_MISSING",
      message: "缺少 source_url，来源可追溯性不足。",
      path: ["source", "source_url"],
    });
  }

  if (validatedInput.source.source_type !== "official_brand") {
    warnings.push({
      code: "CATALOG_SEED_NON_OFFICIAL_BRAND_SOURCE",
      message: "来源不是 official_brand，录入前应人工复核产品身份。",
      path: ["source", "source_type"],
    });
  }

  return {
    valid: errors.length === 0,
    input: validatedInput,
    errors,
    warnings,
  };
}

function toIssuePath(path: PropertyKey[]): CatalogSeedValidationIssuePath {
  return path.map((segment) =>
    typeof segment === "number" ? segment : String(segment));
}
