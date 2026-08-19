import "server-only";

import {
  productDraftIdSchema,
  type ProductDraftMatchResult,
} from "@/schemas/product-draft";
import type { KnowledgeRepository } from "@/server/repositories/knowledge-repository";
import type { ProductDraftRepository } from "@/server/repositories/product-draft-repository";
import { ProductDraftNotFoundError, ProductDraftStateError, toProductDraft } from "@/server/services/product-draft-service";

export type ProductDraftMatchingService = {
  matchDraft(userId: string, draftId: unknown): Promise<ProductDraftMatchResult>;
};

export function normalizeProductName(value: string) {
  return value.toLocaleLowerCase("en-US").normalize("NFKC").replace(/[\s\p{P}\p{S}_]+/gu, "");
}

export function createProductDraftMatchingService(drafts: ProductDraftRepository, knowledge: KnowledgeRepository): ProductDraftMatchingService {
  return {
    async matchDraft(userId, draftId) {
      const id = productDraftIdSchema.parse(draftId);
      const draft = await drafts.findById(userId, id);
      if (!draft) throw new ProductDraftNotFoundError("DRAFT_NOT_FOUND");
      if (draft.status !== "pending") throw new ProductDraftStateError("DRAFT_NOT_PENDING");

      let candidate = null;
      let matchSource: "barcode_exact" | "normalized_name_exact" | null = null;
      let status: ProductDraftMatchResult["status"] = "no_match";
      if (draft.barcode) {
        candidate = await knowledge.findVerifiedByBarcode(draft.barcode);
        if (candidate) {
          matchSource = "barcode_exact";
          status = "candidate";
        }
      }
      if (!candidate && draft.brand_name && draft.product_name) {
        const target = `${normalizeProductName(draft.brand_name)}:${normalizeProductName(draft.product_name)}`;
        const matches = (await knowledge.listVerifiedProductsForMatching()).filter(
          (item) =>
            `${normalizeProductName(item.brand_name)}:${normalizeProductName(item.product_name)}` === target,
        );
        if (matches.length === 1) {
          [candidate] = matches;
          matchSource = "normalized_name_exact";
          status = "candidate";
        } else if (matches.length > 1) {
          status = "match_conflict";
        }
      }
      const saved = await drafts.saveCandidate(
        id,
        candidate?.id ?? null,
        matchSource,
      );
      if (!saved) throw new ProductDraftNotFoundError("DRAFT_NOT_FOUND");
      return { status, draft: toProductDraft(saved) };
    },
  };
}
