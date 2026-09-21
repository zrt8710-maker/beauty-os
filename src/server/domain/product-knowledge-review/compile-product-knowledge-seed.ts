import {
  CATALOG_SEED_SCHEMA_VERSION,
  catalogSeedInputSchema,
} from "@/schemas/catalog-seed";
import type { ExternalProductFact } from "@/schemas/external-product-fact";
import type { KnowledgeCandidate } from "@/schemas/knowledge-candidate";
import { PRODUCT_TYPE_META } from "@/schemas/product";
import {
  PRODUCT_KNOWLEDGE_CURATION_SCHEMA_VERSION,
  productKnowledgeCurationInputSchema,
} from "@/schemas/product-knowledge-curation";
import type { ProductKnowledgeReview } from "@/schemas/product-knowledge-review";
import { validateCatalogSeed } from "@/server/domain/catalog-seed";
import { validateProductKnowledgeCuration } from "@/server/domain/product-knowledge-curation";

import type { CompiledProductKnowledgeSeed } from "./types";
import { validateProductKnowledgeReview } from "./validate-product-knowledge-review";

export class ProductKnowledgeReviewValidationError extends Error {
  constructor(
    public readonly errors: ReturnType<
      typeof validateProductKnowledgeReview
    >["errors"],
  ) {
    super(errors.map((issue) => issue.message).join("；"));
    this.name = "ProductKnowledgeReviewValidationError";
  }
}

export function compileProductKnowledgeSeed(input: {
  candidate: KnowledgeCandidate;
  review: ProductKnowledgeReview;
  fact: ExternalProductFact;
}): CompiledProductKnowledgeSeed {
  const validation = validateProductKnowledgeReview(
    input.candidate,
    input.review,
  );
  if (!validation.valid) {
    throw new ProductKnowledgeReviewValidationError(validation.errors);
  }
  if (input.fact.fact_id !== input.candidate.input_fact.fact_id) {
    throw new Error("Candidate 引用的 fact_id 与 facts 文件不一致。");
  }
  if (input.fact.schema_version !== input.candidate.input_fact.schema_version) {
    throw new Error("Candidate 引用的 External Fact Schema 与 facts 文件不一致。");
  }

  // The review gate proves these values are non-null. Keep the explicit checks
  // so this compiler remains safe if validation rules are changed later.
  const brandName = input.candidate.identity_candidate.brand_name;
  const productName = input.candidate.identity_candidate.product_name;
  const productType = input.review.classification_review.product_type.value;
  const identityConfidence = input.review.identity_review.confidence;
  const primaryRole = input.review.decision_review.primary_role;
  const reviewedAt = input.review.review_metadata.reviewed_at;
  if (
    brandName === null
    || productName === null
    || productType === null
    || identityConfidence === null
    || primaryRole.value === null
    || primaryRole.confidence === null
    || primaryRole.evidence_source === null
    || reviewedAt === null
  ) {
    throw new Error("Review Gate 通过后仍存在不可编译字段。");
  }

  const productTypeMeta = PRODUCT_TYPE_META[productType];
  const identitySeed = catalogSeedInputSchema.parse({
    schema_version: CATALOG_SEED_SCHEMA_VERSION,
    catalog_product_id: input.review.seed_target.catalog_product_id,
    source: {
      source_id: input.review.seed_target.source_id,
      source_type: input.fact.source.source_type,
      name: input.fact.source.source_name,
      source_url: input.fact.source.source_url,
      license_note: input.fact.source.license,
      retrieved_at: input.fact.source.retrieved_at,
    },
    identity: {
      brand_name: brandName,
      product_name: productName,
      variant_name: input.candidate.identity_candidate.variant_name,
      barcode: input.candidate.identity_candidate.barcode,
      category: productTypeMeta.category,
      subcategory: productTypeMeta.subcategory,
      product_type: productType,
      confidence: identityConfidence,
      status: "verified",
    },
  });
  const assessmentNote = primaryRole.notes.length > 0
    ? primaryRole.notes
    : `人工审核确认 Candidate：${input.candidate.candidate_id}`;
  const knowledgeSeed = productKnowledgeCurationInputSchema.parse({
    schema_version: PRODUCT_KNOWLEDGE_CURATION_SCHEMA_VERSION,
    catalog_product_id: input.review.seed_target.catalog_product_id,
    roles: [{
      care_role_code: primaryRole.value,
      assignment_kind: "primary",
      status: "verified",
      confidence: primaryRole.confidence,
      assessment_note: assessmentNote,
      source_locator: primaryRole.evidence_source,
      reviewed_at: reviewedAt,
    }],
    capabilities: [],
  });

  const catalogValidation = validateCatalogSeed(identitySeed);
  if (!catalogValidation.valid) {
    throw new Error(
      `编译后的 Identity Seed 未通过现有校验：${catalogValidation.errors
        .map((issue) => issue.message)
        .join("；")}`,
    );
  }
  const knowledgeValidation = validateProductKnowledgeCuration(knowledgeSeed);
  if (!knowledgeValidation.valid) {
    throw new Error(
      `编译后的 Knowledge Seed 未通过现有校验：${knowledgeValidation.errors
        .map((issue) => issue.message)
        .join("；")}`,
    );
  }

  return { identitySeed, knowledgeSeed };
}
