import "server-only";

import { z } from "zod";

import {
  adminProductKnowledgeEditSchema,
  type AdminProductKnowledgeEdit,
} from "@/schemas/admin-product-knowledge";
import {
  productResearchDraftCreateSchema,
  productResearchPayloadSchema,
  type ProductResearchDraft,
} from "@/schemas/product-research-draft";
import type { ProductResearchDraftRepository } from "@/server/repositories/product-research-draft-repository";

export class AdminProductKnowledgeNotFoundError extends Error {
  readonly code = "ADMIN_PRODUCT_KNOWLEDGE_NOT_FOUND";
  constructor() { super("ADMIN_PRODUCT_KNOWLEDGE_NOT_FOUND"); }
}

export type AdminProductKnowledgeMaintenanceService = {
  save(catalogProductId: string, input: unknown): Promise<ProductResearchDraft>;
};

/**
 * Admin edits never overwrite an Agent3 snapshot. They clone the latest
 * usable snapshot into the next draft version with created_by=admin.
 */
export function createAdminProductKnowledgeMaintenanceService(
  drafts: ProductResearchDraftRepository,
): AdminProductKnowledgeMaintenanceService {
  return {
    async save(rawCatalogProductId, rawInput) {
      const catalogProductId = z.uuid().parse(rawCatalogProductId);
      const input = adminProductKnowledgeEditSchema.parse(rawInput);
      const current = await drafts.getLatestUsableDraft(catalogProductId);
      if (!current) throw new AdminProductKnowledgeNotFoundError();

      const nextPayload = productResearchPayloadSchema.parse(
        applyAdminEdits(current.research_payload, input),
      );
      return drafts.createDraft(productResearchDraftCreateSchema.parse({
        catalog_product_id: catalogProductId,
        research_version: current.research_version + 1,
        research_payload: nextPayload,
        overall_confidence: input.overall_confidence,
        created_by: "admin",
        research_model: null,
        research_run_id: null,
      }));
    },
  };
}

function applyAdminEdits(
  current: ProductResearchDraft["research_payload"],
  input: AdminProductKnowledgeEdit,
) {
  return {
    ...current,
    ingredients: {
      ...current.ingredients,
      status: input.ingredients.status,
      raw_text: input.ingredients.raw_text,
      items: input.ingredients.item_names.map((rawName) => {
        const existing = current.ingredients.items.find((item) => item.raw_name === rawName);
        return existing ?? {
          raw_name: rawName,
          normalized_name: null,
          ingredient_order: null,
          confidence: null,
          evidence_refs: [],
        };
      }),
    },
    claims: input.claims.map((rawText) => {
      const existing = current.claims.find((claim) => claim.raw_text === rawText);
      return existing ?? {
        raw_text: rawText,
        normalized_claim: null,
        confidence: null,
        evidence_refs: [],
      };
    }),
    product_type: input.product_type === current.product_type.value
      ? current.product_type
      : {
        value: input.product_type,
        confidence: null,
        basis: "unknown" as const,
        evidence_refs: [],
      },
    texture: input.texture === null
      ? null
      : input.texture === current.texture?.value
        ? current.texture
        : {
          value: input.texture,
          confidence: null,
          basis: "unknown" as const,
          evidence_refs: [],
        },
    usage: {
      ...current.usage,
      ...input.usage,
    },
  };
}
