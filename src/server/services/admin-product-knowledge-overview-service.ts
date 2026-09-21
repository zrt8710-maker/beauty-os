import "server-only";

import { z } from "zod";

import type {
  CatalogIdentityProduct,
  CatalogIdentityRepository,
} from "@/server/repositories/catalog-identity-repository";
import type { ProductResearchDraft } from "@/schemas/product-research-draft";
import type { ProductResearchDraftRepository } from "@/server/repositories/product-research-draft-repository";
import type { KnowledgeRepository } from "@/server/repositories/knowledge-repository";
import {
  createProductKnowledgeCompletenessService,
  type ProductKnowledgeCompleteness,
} from "@/server/services/product-knowledge-completeness-service";
import { missingProductResearchSections } from "@/server/services/effective-product-research-draft";

export type AdminProductKnowledgeOverview = {
  product: CatalogIdentityProduct;
  identity_status: "confirmed";
  runtime_verified: boolean;
  knowledge_status: "not_researched" | "research_available" | "research_partial";
  overall_confidence: number | null;
  latest_snapshot: ProductResearchDraft | null;
  completeness: ProductKnowledgeCompleteness;
  formalIngredientReadError: FormalIngredientReadError | null;
  updated_at: string;
};

export type FormalIngredientReadError = {
  code: string | null;
  message: string | null;
  details: string | null;
  hint: string | null;
};

export type AdminProductKnowledgeOverviewService = {
  list(): Promise<AdminProductKnowledgeOverview[]>;
  get(catalogProductId: string): Promise<AdminProductKnowledgeOverview | null>;
};

export function createAdminProductKnowledgeOverviewService(dependencies: {
  identities: CatalogIdentityRepository;
  drafts: ProductResearchDraftRepository;
  ingredients: Pick<KnowledgeRepository, "listVerifiedProductIngredients">;
}): AdminProductKnowledgeOverviewService {
  const completeness = createProductKnowledgeCompletenessService();
  return {
    async list() {
      const [products, drafts] = await Promise.all([
        dependencies.identities.listIdentityProducts({ limit: 100 }),
        dependencies.drafts.listUsableDrafts(),
      ]);
      const latestByProduct = selectLatestUsableSnapshots(drafts);
      return Promise.all(products.map(async (product) =>
        toOverview(product, latestByProduct.get(product.id) ?? null, await readFormalIngredientStatus(
          dependencies.ingredients,
          product.id,
        ), completeness)
      ));
    },

    async get(catalogProductId) {
      const id = z.uuid().parse(catalogProductId);
      const [product, snapshot] = await Promise.all([
        dependencies.identities.findById(id),
        dependencies.drafts.getLatestUsableDraft(id),
      ]);
      if (!product) return null;
      return toOverview(
        product,
        snapshot,
        await readFormalIngredientStatus(dependencies.ingredients, product.id),
        completeness,
      );
    },
  };
}

export function selectLatestUsableSnapshots(drafts: ProductResearchDraft[]) {
  const latest = new Map<string, ProductResearchDraft>();
  for (const draft of drafts) {
    if (!["draft", "review_pending", "approved"].includes(draft.status)) continue;
    const current = latest.get(draft.catalog_product_id);
    if (!current || draft.research_version > current.research_version) {
      latest.set(draft.catalog_product_id, draft);
    }
  }
  return latest;
}

function toOverview(
  product: CatalogIdentityProduct,
  latestSnapshot: ProductResearchDraft | null,
  formalIngredients: FormalIngredientReadResult,
  completenessService: ReturnType<typeof createProductKnowledgeCompletenessService>,
): AdminProductKnowledgeOverview {
  return {
    product,
    identity_status: "confirmed",
    runtime_verified: product.status === "verified",
    knowledge_status: knowledgeStatus(latestSnapshot),
    overall_confidence: latestSnapshot?.overall_confidence ?? null,
    latest_snapshot: latestSnapshot,
    formalIngredientReadError: formalIngredients.error,
    completeness: completenessService.assess({
      product,
      latest_snapshot: latestSnapshot,
    }),
    updated_at: latestSnapshot && latestSnapshot.updated_at > product.updated_at
      ? latestSnapshot.updated_at
      : product.updated_at,
  };
}

function knowledgeStatus(
  snapshot: ProductResearchDraft | null,
): AdminProductKnowledgeOverview["knowledge_status"] {
  if (!snapshot) return "not_researched";
  return missingProductResearchSections(snapshot).length > 0
    ? "research_partial"
    : "research_available";
}

type FormalIngredientReadResult = {
  error: FormalIngredientReadError | null;
};

async function readFormalIngredientStatus(
  ingredients: Pick<KnowledgeRepository, "listVerifiedProductIngredients">,
  catalogProductId: string,
): Promise<FormalIngredientReadResult> {
  try {
    await ingredients.listVerifiedProductIngredients(catalogProductId);
    return { error: null };
  } catch (error) {
    const formalIngredientReadError = supabaseErrorDetails(error);
    console.error("ADMIN_FORMAL_INGREDIENT_READ_FAILED", {
      catalog_product_id: catalogProductId,
      ...formalIngredientReadError,
    });
    return { error: formalIngredientReadError };
  }
}

function supabaseErrorDetails(error: unknown): FormalIngredientReadError {
  const cause = error instanceof Error ? error.cause : error;
  const value = cause && typeof cause === "object" ? cause as Record<string, unknown> : {};
  return {
    code: stringOrNull(value.code),
    message: stringOrNull(value.message) ?? (error instanceof Error ? error.message : null),
    details: stringOrNull(value.details),
    hint: stringOrNull(value.hint),
  };
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}
