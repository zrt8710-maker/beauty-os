import type { CatalogSeedInput } from "@/schemas/catalog-seed";
import type { ProductKnowledgeCurationInput } from "@/schemas/product-knowledge-curation";

export type ProductKnowledgeReviewIssue = {
  code: string;
  message: string;
  path: Array<string | number>;
};

export type ProductKnowledgeReviewValidationResult = {
  valid: boolean;
  errors: ProductKnowledgeReviewIssue[];
  warnings: ProductKnowledgeReviewIssue[];
};

export type CompiledProductKnowledgeSeed = {
  identitySeed: CatalogSeedInput;
  knowledgeSeed: ProductKnowledgeCurationInput;
};
