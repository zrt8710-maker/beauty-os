import "server-only";

import {
  productDraftConfirmResultSchema,
  productDraftConfirmationSchema,
  productDraftConfirmSchema,
  productDraftContentSchema,
  productDraftCreateSchema,
  productDraftIdSchema,
  productDraftListQuerySchema,
  productDraftSchema,
  productDraftUpdateSchema,
  type ProductDraft,
  type ProductDraftConfirmResult,
} from "@/schemas/product-draft";
import type {
  ProductDraftRepository,
  ProductDraftRow,
} from "@/server/repositories/product-draft-repository";
import type { UploadRepository } from "@/server/repositories/upload-repository";

export class ProductDraftNotFoundError extends Error {
  constructor(public readonly code: "DRAFT_NOT_FOUND" | "UPLOAD_NOT_FOUND") {
    super(code);
    this.name = "ProductDraftNotFoundError";
  }
}

export class ProductDraftStateError extends Error {
  constructor(
    public readonly code:
      | "DRAFT_NOT_PENDING"
      | "DRAFT_INCOMPLETE"
      | "UPLOAD_NOT_READY"
      | "UPLOAD_ALREADY_LINKED",
  ) {
    super(code);
    this.name = "ProductDraftStateError";
  }
}

export function toProductDraft(row: ProductDraftRow): ProductDraft {
  return productDraftSchema.parse({
    id: row.id,
    upload_asset_id: row.upload_asset_id,
    brand_name: row.brand_name,
    product_name: row.product_name,
    category: row.category,
    subcategory: row.subcategory,
    product_type: row.product_type,
    notes: row.notes,
    barcode: row.barcode,
    source: row.source,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    candidate_catalog_product_id: row.candidate_catalog_product_id,
    match_source: row.match_source,
    match_confidence: row.match_confidence,
    match_evidence: row.match_evidence,
    knowledge_confirmed_at: row.knowledge_confirmed_at,
  });
}

function draftContent(row: ProductDraftRow) {
  return {
    brand_name: row.brand_name,
    product_name: row.product_name,
    category: row.category,
    subcategory: row.subcategory,
    product_type: row.product_type,
    notes: row.notes,
    barcode: row.barcode,
  };
}

export type ProductDraftService = {
  createDraft(userId: string, input: unknown): Promise<ProductDraft>;
  listDrafts(userId: string, query: unknown): Promise<ProductDraft[]>;
  updateDraft(
    userId: string,
    draftId: unknown,
    input: unknown,
  ): Promise<ProductDraft>;
  confirmDraft(
    userId: string,
    draftId: unknown,
    input: unknown,
  ): Promise<ProductDraftConfirmResult>;
  rejectDraft(userId: string, draftId: unknown): Promise<void>;
};

export function createProductDraftService(
  drafts: ProductDraftRepository,
  uploads: UploadRepository,
): ProductDraftService {
  async function getPendingDraft(userId: string, draftId: string) {
    const draft = await drafts.findById(userId, draftId);

    if (!draft) {
      throw new ProductDraftNotFoundError("DRAFT_NOT_FOUND");
    }

    if (draft.status !== "pending") {
      throw new ProductDraftStateError("DRAFT_NOT_PENDING");
    }

    return draft;
  }

  return {
    async createDraft(userId, input) {
      const validated = productDraftCreateSchema.parse(input);
      const upload = await uploads.findById(userId, validated.upload_asset_id);

      if (!upload) {
        throw new ProductDraftNotFoundError("UPLOAD_NOT_FOUND");
      }

      if (upload.status !== "ready") {
        throw new ProductDraftStateError("UPLOAD_NOT_READY");
      }

      if (upload.product_id !== null) {
        throw new ProductDraftStateError("UPLOAD_ALREADY_LINKED");
      }

      return toProductDraft(
        await drafts.create(userId, validated.upload_asset_id),
      );
    },

    async listDrafts(userId, query) {
      const validated = productDraftListQuerySchema.parse(query);
      return (await drafts.listByUserId(userId, validated)).map(toProductDraft);
    },

    async updateDraft(userId, draftId, input) {
      const validatedId = productDraftIdSchema.parse(draftId);
      const validatedUpdate = productDraftUpdateSchema.parse(input);
      const existing = await getPendingDraft(userId, validatedId);

      productDraftContentSchema.parse({
        ...draftContent(existing),
        ...validatedUpdate,
      });

      const updated = await drafts.update(userId, validatedId, {
        ...validatedUpdate,
        updated_at: new Date().toISOString(),
      });

      if (!updated) {
        throw new ProductDraftNotFoundError("DRAFT_NOT_FOUND");
      }

      return toProductDraft(updated);
    },

    async confirmDraft(userId, draftId, input) {
      const validatedId = productDraftIdSchema.parse(draftId);
      const confirmation = productDraftConfirmSchema.parse(input);
      const existing = await getPendingDraft(userId, validatedId);

      const validation = productDraftConfirmationSchema.safeParse(
        draftContent(existing),
      );

      if (!validation.success) {
        throw new ProductDraftStateError("DRAFT_INCOMPLETE");
      }

      const catalogProductId = confirmation.confirmation === "link_candidate"
        ? existing.candidate_catalog_product_id
        : null;
      if (confirmation.confirmation === "link_candidate" && !catalogProductId) {
        throw new ProductDraftStateError("DRAFT_INCOMPLETE");
      }
      const result = await drafts.confirmTransaction(validatedId, catalogProductId);
      return productDraftConfirmResultSchema.parse({
        product_id: result.created_product_id,
        owned_product_id: result.created_owned_product_id,
      });
    },

    async rejectDraft(userId, draftId) {
      const validatedId = productDraftIdSchema.parse(draftId);
      await getPendingDraft(userId, validatedId);
      const rejected = await drafts.reject(
        userId,
        validatedId,
        new Date().toISOString(),
      );

      if (!rejected) {
        throw new ProductDraftNotFoundError("DRAFT_NOT_FOUND");
      }
    },
  };
}
