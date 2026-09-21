import { describe, expect, it, vi } from "vitest";

import type { ProductKnowledgeSnapshot } from "@/schemas/product-knowledge";
import type { ProductKnowledgeCurationInput } from "@/schemas/product-knowledge-curation";
import type {
  ProductKnowledgeCurationRepository,
  ProductKnowledgeCurationWriteReceipt,
} from "@/server/repositories/product-knowledge-curation-repository";
import type { ProductKnowledgeRepository } from "@/server/repositories/product-knowledge-repository";
import {
  createProductKnowledgeCurationService,
  ProductKnowledgeCurationPreviewError,
  ProductKnowledgeCurationReadbackError,
  ProductKnowledgeCurationValidationError,
} from "@/server/services/product-knowledge-curation-service";

const catalogProductId = "10000000-0000-4000-8000-000000000001";
const timestamp = "2026-08-24T00:00:00.000Z";

const receipt: ProductKnowledgeCurationWriteReceipt = {
  catalog_product_id: catalogProductId,
  role_assignment_ids: {
    treatment: "30000000-0000-4000-8000-000000000001",
  },
  capability_assignment_ids: {
    hydration: "40000000-0000-4000-8000-000000000001",
  },
  evidence_counts: { hydration: 0 },
};

const snapshot: ProductKnowledgeSnapshot = {
  identity: {
    catalog_product_id: catalogProductId,
    brand_name: "Beauty OS",
    product_name: "Knowledge Serum",
    variant_name: null,
    barcode: null,
    category: "skincare",
    subcategory: "face_care",
    product_type: "serum",
    primary_source_id: "20000000-0000-4000-8000-000000000001",
    identity_confidence: 98,
    catalog_status: "verified",
    created_at: timestamp,
    updated_at: timestamp,
  },
  care_roles: [
    {
      assignment_id: receipt.role_assignment_ids.treatment,
      care_role_code: "treatment",
      display_name: "针对性护理",
      definition: "承担针对性护理步骤。",
      definition_version: 1,
      assignment_kind: "primary",
      status: "verified",
      confidence: 90,
      assessment_note: null,
      source_locator: null,
      reviewed_at: timestamp,
      created_at: timestamp,
      updated_at: timestamp,
    },
  ],
  capabilities: [
    {
      product_capability_id: receipt.capability_assignment_ids.hydration,
      capability_code: "hydration",
      display_name: "补水",
      definition: "帮助皮肤补充或维持水分。",
      definition_version: 1,
      status: "candidate",
      confidence: null,
      assessment_note: null,
      reviewed_at: null,
      created_at: timestamp,
      updated_at: timestamp,
      evidence_summary: {
        total: 0,
        by_direction: { supports: 0, contradicts: 0 },
        by_review_status: { verified: 0, candidate: 0, rejected: 0 },
      },
      evidence: [],
    },
  ],
};

function validInput(): ProductKnowledgeCurationInput {
  return {
    schema_version: "product-knowledge-curation/v0.1",
    catalog_product_id: catalogProductId,
    roles: [
      {
        care_role_code: "treatment",
        assignment_kind: "primary",
        status: "verified",
        confidence: 90,
        assessment_note: null,
        source_locator: null,
        reviewed_at: timestamp,
      },
    ],
    capabilities: [
      {
        capability_code: "hydration",
        status: "candidate",
        confidence: null,
        assessment_note: null,
        reviewed_at: null,
        evidence: [],
      },
    ],
  };
}

function setup() {
  const writeRepository: ProductKnowledgeCurationRepository = {
    applyAtomically: vi.fn().mockResolvedValue(receipt),
  };
  const readRepository: ProductKnowledgeRepository = {
    findByCatalogProductId: vi.fn().mockResolvedValue(snapshot),
  };

  return {
    writeRepository,
    readRepository,
    service: createProductKnowledgeCurationService(
      writeRepository,
      readRepository,
    ),
  };
}

describe("ProductKnowledgeCurationService", () => {
  it("previews a verified catalog product without invoking the write boundary", async () => {
    const { service, writeRepository, readRepository } = setup();

    await expect(service.preview(validInput())).resolves.toEqual({
      snapshot,
      warnings: [],
    });
    expect(readRepository.findByCatalogProductId).toHaveBeenCalledWith(
      catalogProductId,
    );
    expect(writeRepository.applyAtomically).not.toHaveBeenCalled();
  });

  it("rejects preview Validator errors without reading or writing", async () => {
    const { service, writeRepository, readRepository } = setup();
    const input = validInput();
    input.capabilities[0] = {
      ...input.capabilities[0],
      status: "verified",
      confidence: 90,
    };

    await expect(service.preview(input)).rejects.toMatchObject({
      code: "PRODUCT_KNOWLEDGE_CURATION_VALIDATION_FAILED",
      writeCommitted: false,
    });
    expect(readRepository.findByCatalogProductId).not.toHaveBeenCalled();
    expect(writeRepository.applyAtomically).not.toHaveBeenCalled();
  });

  it("reports an unavailable catalog during preview without writing", async () => {
    const { service, writeRepository, readRepository } = setup();
    vi.mocked(readRepository.findByCatalogProductId).mockResolvedValue(null);

    await expect(service.preview(validInput())).rejects.toEqual(
      new ProductKnowledgeCurationPreviewError(
        "PRODUCT_KNOWLEDGE_CURATION_PREVIEW_CATALOG_UNAVAILABLE",
        catalogProductId,
      ),
    );
    expect(writeRepository.applyAtomically).not.toHaveBeenCalled();
  });

  it("reports preview read failures with writeCommitted=false", async () => {
    const { service, writeRepository, readRepository } = setup();
    const failure = new Error("PRODUCT_KNOWLEDGE_READ_FAILED");
    vi.mocked(readRepository.findByCatalogProductId).mockRejectedValue(failure);

    try {
      await service.preview(validInput());
      throw new Error("Expected preview to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ProductKnowledgeCurationPreviewError);
      expect(error).toMatchObject({
        code: "PRODUCT_KNOWLEDGE_CURATION_PREVIEW_READ_FAILED",
        catalogProductId,
        writeCommitted: false,
        cause: failure,
      });
    }
    expect(writeRepository.applyAtomically).not.toHaveBeenCalled();
  });

  it("rejects malformed input during schema parsing before database access", async () => {
    const { service, writeRepository, readRepository } = setup();

    await expect(
      service.curate({
        ...validInput(),
        catalog_product_id: "not-a-uuid",
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
    expect(writeRepository.applyAtomically).not.toHaveBeenCalled();
    expect(readRepository.findByCatalogProductId).not.toHaveBeenCalled();
  });

  it("rejects Validator errors before accessing either repository", async () => {
    const { service, writeRepository, readRepository } = setup();
    const input = validInput();
    input.capabilities[0] = {
      ...input.capabilities[0],
      status: "verified",
      confidence: 90,
    };

    await expect(service.curate(input)).rejects.toMatchObject({
      code: "PRODUCT_KNOWLEDGE_CURATION_VALIDATION_FAILED",
      errors: [
        expect.objectContaining({
          code: "VERIFIED_CAPABILITY_MISSING_VERIFIED_SUPPORTING_EVIDENCE",
        }),
      ],
    });
    expect(writeRepository.applyAtomically).not.toHaveBeenCalled();
    expect(readRepository.findByCatalogProductId).not.toHaveBeenCalled();
  });

  it("continues on warnings and returns the receipt and readback snapshot", async () => {
    const { service, writeRepository, readRepository } = setup();
    const input = validInput();
    input.roles.push({
      care_role_code: "hydration",
      assignment_kind: "primary",
      status: "candidate",
      confidence: null,
      assessment_note: null,
      source_locator: null,
      reviewed_at: null,
    });
    const hydrationAssignmentId = "30000000-0000-4000-8000-000000000002";
    const warningReceipt = {
      ...receipt,
      role_assignment_ids: {
        ...receipt.role_assignment_ids,
        hydration: hydrationAssignmentId,
      },
    };
    const warningSnapshot = {
      ...snapshot,
      care_roles: [
        ...snapshot.care_roles,
        {
          ...snapshot.care_roles[0],
          assignment_id: hydrationAssignmentId,
          care_role_code: "hydration" as const,
          assignment_kind: "primary" as const,
          status: "candidate" as const,
          confidence: null,
          reviewed_at: null,
        },
      ],
    };
    vi.mocked(writeRepository.applyAtomically).mockResolvedValue(
      warningReceipt,
    );
    vi.mocked(readRepository.findByCatalogProductId).mockResolvedValue(
      warningSnapshot,
    );

    const result = await service.curate(input);

    expect(writeRepository.applyAtomically).toHaveBeenCalledOnce();
    expect(writeRepository.applyAtomically).toHaveBeenCalledWith(input);
    expect(readRepository.findByCatalogProductId).toHaveBeenCalledWith(
      catalogProductId,
    );
    expect(result).toEqual({
      receipt: warningReceipt,
      snapshot: warningSnapshot,
      warnings: [
        expect.objectContaining({ code: "PRIMARY_ROLE_CONFLICT" }),
      ],
    });
  });

  it("propagates a write failure and does not attempt readback", async () => {
    const { service, writeRepository, readRepository } = setup();
    const failure = new Error("PRODUCT_KNOWLEDGE_CURATION_WRITE_FAILED");
    vi.mocked(writeRepository.applyAtomically).mockRejectedValue(failure);

    await expect(service.curate(validInput())).rejects.toBe(failure);
    expect(readRepository.findByCatalogProductId).not.toHaveBeenCalled();
  });

  it("reports a committed write whose readback returns no snapshot", async () => {
    const { service, readRepository } = setup();
    vi.mocked(readRepository.findByCatalogProductId).mockResolvedValue(null);

    await expect(service.curate(validInput())).rejects.toEqual(
      new ProductKnowledgeCurationReadbackError(
        "PRODUCT_KNOWLEDGE_CURATION_READBACK_NOT_FOUND",
        catalogProductId,
      ),
    );
  });

  it("preserves the cause when readback fails after the write", async () => {
    const { service, readRepository } = setup();
    const failure = new Error("PRODUCT_KNOWLEDGE_READ_FAILED");
    vi.mocked(readRepository.findByCatalogProductId).mockRejectedValue(failure);

    try {
      await service.curate(validInput());
      throw new Error("Expected readback to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ProductKnowledgeCurationReadbackError);
      expect(error).toMatchObject({
        code: "PRODUCT_KNOWLEDGE_CURATION_READBACK_FAILED",
        catalogProductId,
        cause: failure,
      });
    }
  });

  it("rejects a readback that does not contain the declared knowledge", async () => {
    const { service, readRepository } = setup();
    vi.mocked(readRepository.findByCatalogProductId).mockResolvedValue({
      ...snapshot,
      capabilities: [],
    });

    await expect(service.curate(validInput())).rejects.toEqual(
      new ProductKnowledgeCurationReadbackError(
        "PRODUCT_KNOWLEDGE_CURATION_READBACK_MISMATCH",
        catalogProductId,
      ),
    );
  });

  it("exposes stable validation error metadata", () => {
    const error = new ProductKnowledgeCurationValidationError([], []);

    expect(error).toMatchObject({
      name: "ProductKnowledgeCurationValidationError",
      code: "PRODUCT_KNOWLEDGE_CURATION_VALIDATION_FAILED",
      errors: [],
      warnings: [],
    });
  });
});
