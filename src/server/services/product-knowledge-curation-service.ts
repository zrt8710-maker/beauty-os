import "server-only";

import {
  productKnowledgeCurationInputSchema,
  type ProductKnowledgeCurationInput,
} from "@/schemas/product-knowledge-curation";
import type { ProductKnowledgeSnapshot } from "@/schemas/product-knowledge";
import {
  validateProductKnowledgeCuration,
  type ProductKnowledgeCurationError,
  type ProductKnowledgeCurationWarning,
} from "@/server/domain/product-knowledge-curation";
import type {
  ProductKnowledgeCurationRepository,
  ProductKnowledgeCurationWriteReceipt,
} from "@/server/repositories/product-knowledge-curation-repository";
import type { ProductKnowledgeRepository } from "@/server/repositories/product-knowledge-repository";

export class ProductKnowledgeCurationValidationError extends Error {
  readonly code = "PRODUCT_KNOWLEDGE_CURATION_VALIDATION_FAILED";
  readonly writeCommitted = false;

  constructor(
    public readonly errors: ProductKnowledgeCurationError[],
    public readonly warnings: ProductKnowledgeCurationWarning[],
  ) {
    super("PRODUCT_KNOWLEDGE_CURATION_VALIDATION_FAILED");
    this.name = "ProductKnowledgeCurationValidationError";
  }
}

export type ProductKnowledgeCurationReadbackErrorCode =
  | "PRODUCT_KNOWLEDGE_CURATION_READBACK_FAILED"
  | "PRODUCT_KNOWLEDGE_CURATION_READBACK_NOT_FOUND"
  | "PRODUCT_KNOWLEDGE_CURATION_READBACK_MISMATCH";

export class ProductKnowledgeCurationReadbackError extends Error {
  readonly writeCommitted = true;

  constructor(
    public readonly code: ProductKnowledgeCurationReadbackErrorCode,
    public readonly catalogProductId: string,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "ProductKnowledgeCurationReadbackError";
  }
}

export type ProductKnowledgeCurationPreviewErrorCode =
  | "PRODUCT_KNOWLEDGE_CURATION_PREVIEW_CATALOG_UNAVAILABLE"
  | "PRODUCT_KNOWLEDGE_CURATION_PREVIEW_READ_FAILED";

export class ProductKnowledgeCurationPreviewError extends Error {
  readonly writeCommitted = false;

  constructor(
    public readonly code: ProductKnowledgeCurationPreviewErrorCode,
    public readonly catalogProductId: string,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "ProductKnowledgeCurationPreviewError";
  }
}

export type ProductKnowledgeCurationResult = {
  receipt: ProductKnowledgeCurationWriteReceipt;
  snapshot: ProductKnowledgeSnapshot;
  warnings: ProductKnowledgeCurationWarning[];
};

export type ProductKnowledgeCurationPreviewResult = {
  snapshot: ProductKnowledgeSnapshot;
  warnings: ProductKnowledgeCurationWarning[];
};

export type ProductKnowledgeCurationService = {
  preview(
    input: ProductKnowledgeCurationInput,
  ): Promise<ProductKnowledgeCurationPreviewResult>;
  curate(
    input: ProductKnowledgeCurationInput,
  ): Promise<ProductKnowledgeCurationResult>;
};

export function createProductKnowledgeCurationService(
  writeRepository: ProductKnowledgeCurationRepository,
  readRepository: ProductKnowledgeRepository,
): ProductKnowledgeCurationService {
  return {
    async preview(input) {
      const { parsed, warnings } = parseAndValidate(input);
      let snapshot: ProductKnowledgeSnapshot | null;

      try {
        snapshot = await readRepository.findByCatalogProductId(
          parsed.catalog_product_id,
        );
      } catch (cause) {
        throw new ProductKnowledgeCurationPreviewError(
          "PRODUCT_KNOWLEDGE_CURATION_PREVIEW_READ_FAILED",
          parsed.catalog_product_id,
          { cause },
        );
      }

      if (!snapshot) {
        throw new ProductKnowledgeCurationPreviewError(
          "PRODUCT_KNOWLEDGE_CURATION_PREVIEW_CATALOG_UNAVAILABLE",
          parsed.catalog_product_id,
        );
      }

      return { snapshot, warnings };
    },

    async curate(input) {
      const { parsed, warnings } = parseAndValidate(input);

      const receipt = await writeRepository.applyAtomically(parsed);
      let snapshot: ProductKnowledgeSnapshot | null;

      try {
        snapshot = await readRepository.findByCatalogProductId(
          parsed.catalog_product_id,
        );
      } catch (cause) {
        throw new ProductKnowledgeCurationReadbackError(
          "PRODUCT_KNOWLEDGE_CURATION_READBACK_FAILED",
          parsed.catalog_product_id,
          { cause },
        );
      }

      if (!snapshot) {
        throw new ProductKnowledgeCurationReadbackError(
          "PRODUCT_KNOWLEDGE_CURATION_READBACK_NOT_FOUND",
          parsed.catalog_product_id,
        );
      }

      if (
        !readbackMatches(parsed, receipt, snapshot)
      ) {
        throw new ProductKnowledgeCurationReadbackError(
          "PRODUCT_KNOWLEDGE_CURATION_READBACK_MISMATCH",
          parsed.catalog_product_id,
        );
      }

      return {
        receipt,
        snapshot,
        warnings,
      };
    },
  };
}

function parseAndValidate(input: ProductKnowledgeCurationInput): {
  parsed: ProductKnowledgeCurationInput;
  warnings: ProductKnowledgeCurationWarning[];
} {
  const parsed = productKnowledgeCurationInputSchema.parse(input);
  const validation = validateProductKnowledgeCuration(parsed);

  if (!validation.valid) {
    throw new ProductKnowledgeCurationValidationError(
      validation.errors,
      validation.warnings,
    );
  }

  return { parsed, warnings: validation.warnings };
}

function readbackMatches(
  input: ProductKnowledgeCurationInput,
  receipt: ProductKnowledgeCurationWriteReceipt,
  snapshot: ProductKnowledgeSnapshot,
) {
  if (
    receipt.catalog_product_id !== input.catalog_product_id
    || snapshot.identity.catalog_product_id !== input.catalog_product_id
  ) {
    return false;
  }

  const rolesMatch = input.roles.every((expected) => {
    const actual = snapshot.care_roles.find(
      (role) => role.care_role_code === expected.care_role_code,
    );

    return Boolean(
      actual
      && actual.assignment_id
        === receipt.role_assignment_ids[expected.care_role_code]
      && actual.assignment_kind === expected.assignment_kind
      && actual.status === expected.status
      && actual.confidence === expected.confidence
      && actual.assessment_note === expected.assessment_note
      && actual.source_locator === expected.source_locator,
    );
  });

  if (!rolesMatch) return false;

  return input.capabilities.every((expected) => {
    const actual = snapshot.capabilities.find(
      (capability) => capability.capability_code === expected.capability_code,
    );

    if (
      !actual
      || actual.product_capability_id
        !== receipt.capability_assignment_ids[expected.capability_code]
      || actual.status !== expected.status
      || actual.confidence !== expected.confidence
      || actual.assessment_note !== expected.assessment_note
      || receipt.evidence_counts[expected.capability_code]
        !== expected.evidence.length
      || actual.evidence.length !== expected.evidence.length
    ) {
      return false;
    }

    const expectedEvidence = expected.evidence
      .map(evidenceFingerprint)
      .sort();
    const actualEvidence = actual.evidence
      .map(evidenceFingerprint)
      .sort();

    return expectedEvidence.every(
      (fingerprint, index) => fingerprint === actualEvidence[index],
    );
  });
}

function evidenceFingerprint(evidence: {
  evidence_type: string;
  direction: string;
  evidence_note: string;
  source_locator: string | null;
  confidence: number | null;
  review_status: string;
}) {
  return JSON.stringify([
    evidence.evidence_type,
    evidence.direction,
    evidence.evidence_note,
    evidence.source_locator,
    evidence.confidence,
    evidence.review_status,
  ]);
}
