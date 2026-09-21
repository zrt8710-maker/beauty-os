import "server-only";

import { z } from "zod";

import {
  productResearchDraftCreateSchema,
  productResearchDraftReviewUpdateSchema,
  type ProductResearchDraft,
} from "@/schemas/product-research-draft";
import type { ProductResearchDraftRepository } from "@/server/repositories/product-research-draft-repository";

const draftIdSchema = z.uuid();

const transitions = {
  draft: ["review_pending", "superseded"],
  review_pending: ["approved", "rejected", "superseded"],
  approved: ["superseded"],
  rejected: ["superseded"],
  superseded: [],
} as const;

export class ProductResearchDraftTransitionError extends Error {
  readonly code = "PRODUCT_RESEARCH_DRAFT_INVALID_TRANSITION";

  constructor() {
    super("PRODUCT_RESEARCH_DRAFT_INVALID_TRANSITION");
    this.name = "ProductResearchDraftTransitionError";
  }
}

export class ProductResearchDraftNotFoundError extends Error {
  readonly code = "PRODUCT_RESEARCH_DRAFT_NOT_FOUND";

  constructor() {
    super("PRODUCT_RESEARCH_DRAFT_NOT_FOUND");
    this.name = "ProductResearchDraftNotFoundError";
  }
}

export type ProductResearchDraftService = {
  createDraft(input: unknown): Promise<ProductResearchDraft>;
  getLatestDraft(catalogProductId: string): Promise<ProductResearchDraft | null>;
  getLatestUsableDraft(catalogProductId: string): Promise<ProductResearchDraft | null>;
  listDrafts(catalogProductId: string): Promise<ProductResearchDraft[]>;
  listRecentDrafts(): Promise<ProductResearchDraft[]>;
  getDraft(id: string): Promise<ProductResearchDraft | null>;
  updatePayload(id: string, payload: unknown): Promise<ProductResearchDraft>;
  updateReviewStatus(id: string, input: unknown): Promise<ProductResearchDraft>;
};

export function createProductResearchDraftService(
  repository: ProductResearchDraftRepository,
): ProductResearchDraftService {
  return {
    async createDraft(input) {
      return repository.createDraft(productResearchDraftCreateSchema.parse(input));
    },
    getLatestDraft(catalogProductId) {
      return repository.getLatestDraft(draftIdSchema.parse(catalogProductId));
    },
    getLatestUsableDraft(catalogProductId) {
      return repository.getLatestUsableDraft(draftIdSchema.parse(catalogProductId));
    },
    listDrafts(catalogProductId) {
      return repository.listDrafts(draftIdSchema.parse(catalogProductId));
    },
    listRecentDrafts() { return repository.listRecentDrafts(); },
    getDraft(id) { return repository.getDraft(draftIdSchema.parse(id)); },
    async updatePayload(id, payload) {
      const current = await repository.getDraft(draftIdSchema.parse(id));
      if (!current) throw new ProductResearchDraftNotFoundError();
      if (current.status !== "draft") throw new ProductResearchDraftTransitionError();
      const updated = await repository.updatePayload(current.id, productResearchDraftCreateSchema.shape.research_payload.parse(payload));
      if (!updated) throw new ProductResearchDraftNotFoundError();
      return updated;
    },
    async updateReviewStatus(id, input) {
      const draftId = draftIdSchema.parse(id);
      const update = productResearchDraftReviewUpdateSchema.parse(input);
      const current = await repository.getDraft(draftId);
      if (!current) throw new ProductResearchDraftNotFoundError();

      if (!transitions[current.status].includes(
        update.status as never,
      )) {
        throw new ProductResearchDraftTransitionError();
      }

      const requiresReviewer = update.status === "approved" || update.status === "rejected";
      if (requiresReviewer !== (update.reviewed_by !== null && update.reviewed_at !== null)) {
        throw new ProductResearchDraftTransitionError();
      }
      if (!requiresReviewer && (update.reviewed_by !== null || update.reviewed_at !== null)) {
        throw new ProductResearchDraftTransitionError();
      }

      const updateForPersistence = update.status === "superseded"
        ? {
          ...update,
          reviewed_by: current.reviewed_by,
          reviewed_at: current.reviewed_at,
        }
        : update;
      const updated = await repository.updateReviewStatus(
        draftId,
        updateForPersistence,
      );
      if (!updated) throw new ProductResearchDraftNotFoundError();
      return updated;
    },
  };
}
