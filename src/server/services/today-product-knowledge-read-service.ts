import "server-only";

import type { ProductSafetyIngredientData } from "@/server/domain/product-safety";
import type { KnowledgeRepository } from "@/server/repositories/knowledge-repository";
import type { ProductKnowledgeRepository } from "@/server/repositories/product-knowledge-repository";
import type { ProductResearchDraftRepository } from "@/server/repositories/product-research-draft-repository";
import type { IngredientKnowledgePack } from "@/server/services/ingredient-knowledge-pack";
import {
  projectPlannerProductEvidenceFromLoaded,
  type PlannerProductEvidence,
} from "@/server/services/planner-product-evidence-service";
import {
  runtimeAvailableProductKnowledgeFromLoaded,
  trustedDraftIngredientsFromLoaded,
  type RuntimeAvailableProductKnowledge,
} from "@/server/services/product-knowledge-runtime-availability-service";

export type TodayProductKnowledgeReadBundle = {
  plannerEvidenceByCatalogId: ReadonlyMap<string, PlannerProductEvidence>;
  runtimeKnowledgeByCatalogId: ReadonlyMap<string, RuntimeAvailableProductKnowledge>;
  safetyIngredientsByCatalogId: ReadonlyMap<string, ProductSafetyIngredientData>;
};

export type TodayProductKnowledgeReadService = {
  load(
    catalogProductIds: string[],
    timing: { requestId: string },
  ): Promise<TodayProductKnowledgeReadBundle>;
};

/**
 * One request-scoped read model shared by safety, Planner evidence, and the
 * deterministic fallback. It performs no cross-request caching.
 */
export function createTodayProductKnowledgeReadService(dependencies: {
  formal: { findByCatalogProductIds: NonNullable<ProductKnowledgeRepository["findByCatalogProductIds"]> };
  drafts: { getLatestUsableDrafts: NonNullable<ProductResearchDraftRepository["getLatestUsableDrafts"]> };
  ingredients: { listVerifiedProductIngredientsByProductIds: NonNullable<KnowledgeRepository["listVerifiedProductIngredientsByProductIds"]> };
  ingredientKnowledgePack?: IngredientKnowledgePack;
}): TodayProductKnowledgeReadService {
  // This service is constructed per authenticated request. Only complete,
  // successful reads are reused between early validation and regeneration.
  const loaded = new Set<string>();
  const planner = new Map<string, PlannerProductEvidence>();
  const runtime = new Map<string, RuntimeAvailableProductKnowledge>();
  const safety = new Map<string, ProductSafetyIngredientData>();
  const reader: TodayProductKnowledgeReadService = {
    async load(catalogProductIds, timing) {
      const ids = [...new Set(catalogProductIds)];
      if (ids.length === 0) {
        return {
          plannerEvidenceByCatalogId: new Map(),
          runtimeKnowledgeByCatalogId: new Map(),
          safetyIngredientsByCatalogId: new Map(),
        };
      }

      // All three reads are independent. A rejection aborts the bundle so a
      // partial batch can never be interpreted as safe or complete knowledge.
      const sharedReadsStartedAt = Date.now();
      const [formalById, draftsById, verifiedIngredientsById] = await Promise.all([
        dependencies.formal.findByCatalogProductIds(ids, {
          ...timing,
          queryKind: "formal_knowledge_batch",
        }),
        dependencies.drafts.getLatestUsableDrafts(ids, timing),
        dependencies.ingredients.listVerifiedProductIngredientsByProductIds(ids, {
          ...timing,
          queryKind: "safety_ingredient_batch",
        }),
      ]);
      const safetyIngredientsByCatalogId = new Map<string, ProductSafetyIngredientData>();
      for (const catalogProductId of ids) {
        const verifiedRows = formalById.has(catalogProductId)
          ? verifiedIngredientsById.get(catalogProductId) ?? []
          : [];
        if (verifiedRows.length > 0) {
          safetyIngredientsByCatalogId.set(catalogProductId, {
            reliable: true,
            ingredients: verifiedRows.map((row) => ({
              inciName: row.ingredient.inci_name,
              displayName: row.ingredient.display_name,
              aliases: [...row.ingredient.aliases],
            })),
          });
          continue;
        }
        if (formalById.has(catalogProductId)) continue;
        const draftIngredients = trustedDraftIngredientsFromLoaded(
          draftsById.get(catalogProductId) ?? null,
          catalogProductId,
        );
        if (draftIngredients.length > 0) {
          safetyIngredientsByCatalogId.set(catalogProductId, {
            reliable: true,
            ingredients: draftIngredients,
          });
        }
      }
      logTodayKnowledgeTiming("safety_total", timing.requestId, sharedReadsStartedAt, {
        catalogProductCount: ids.length,
      });

      const plannerEntries = await Promise.all(ids.map(async (catalogProductId) => [
        catalogProductId,
        await projectPlannerProductEvidenceFromLoaded(
          draftsById.get(catalogProductId) ?? null,
          formalById.get(catalogProductId) ?? null,
          dependencies.ingredientKnowledgePack,
        ),
      ] as const));
      logTodayKnowledgeTiming("planner_evidence_total", timing.requestId, sharedReadsStartedAt, {
        catalogProductCount: ids.length,
      });
      const runtimeKnowledgeByCatalogId = new Map(ids.map((catalogProductId) => [
        catalogProductId,
        runtimeAvailableProductKnowledgeFromLoaded(
          formalById.get(catalogProductId) ?? null,
          draftsById.get(catalogProductId) ?? null,
          catalogProductId,
        ),
      ] as const));

      return {
        plannerEvidenceByCatalogId: new Map(plannerEntries),
        runtimeKnowledgeByCatalogId,
        safetyIngredientsByCatalogId,
      };
    },
  };

  return {
    async load(catalogProductIds, timing) {
      const ids = [...new Set(catalogProductIds)];
      const missing = ids.filter((id) => !loaded.has(id));
      if (missing.length > 0) {
        const bundle = await reader.load(missing, timing);
        // Commit only after all queries and projections have succeeded. A
        // failed load can be retried and never becomes an empty safety result.
        for (const id of missing) {
          const evidence = bundle.plannerEvidenceByCatalogId.get(id);
          const knowledge = bundle.runtimeKnowledgeByCatalogId.get(id);
          const ingredients = bundle.safetyIngredientsByCatalogId.get(id);
          if (evidence) planner.set(id, evidence);
          if (knowledge) runtime.set(id, knowledge);
          if (ingredients) safety.set(id, ingredients);
          loaded.add(id);
        }
      }
      return {
        plannerEvidenceByCatalogId: selectEntries(planner, ids),
        runtimeKnowledgeByCatalogId: selectEntries(runtime, ids),
        safetyIngredientsByCatalogId: selectEntries(safety, ids),
      };
    },
  };
}

function selectEntries<T>(source: ReadonlyMap<string, T>, ids: string[]): Map<string, T> {
  return new Map(ids.flatMap((id) => source.has(id) ? [[id, source.get(id)!] as const] : []));
}

function logTodayKnowledgeTiming(
  stage: string,
  requestId: string,
  startedAt: number,
  details: Record<string, unknown>,
) {
  if (process.env.NODE_ENV !== "development") return;
  console.info("[today-care-planner]", {
    stage,
    requestId,
    durationMs: Date.now() - startedAt,
    ...details,
  });
}
