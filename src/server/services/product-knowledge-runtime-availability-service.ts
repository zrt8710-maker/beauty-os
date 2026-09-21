import "server-only";

import type { ProductKnowledgeSnapshot } from "@/schemas/product-knowledge";
import type { ProductResearchDraft } from "@/schemas/product-research-draft";
import { deriveRuntimeProductKnowledge } from "@/server/domain/product-knowledge-derivation";
import type { ProductKnowledgeRepository } from "@/server/repositories/product-knowledge-repository";
import type { ProductResearchDraftRepository } from "@/server/repositories/product-research-draft-repository";

export type RuntimeAvailableProductKnowledge = {
  provenance: "formal_verified" | "draft_derived" | "unknown";
  care_roles: Array<Pick<ProductKnowledgeSnapshot["care_roles"][number], "care_role_code" | "assignment_kind" | "status" | "confidence">>;
  capabilities: Array<Pick<ProductKnowledgeSnapshot["capabilities"][number], "capability_code" | "status" | "confidence">>;
};
export type RuntimeDraftIngredients = Array<{ inciName: string; displayName: string | null; aliases: string[] }>;

export function trustedDraftIngredientsFromLoaded(
  draft: ProductResearchDraft | null,
  catalogProductId: string,
): RuntimeDraftIngredients {
  if (!draft || draft.catalog_product_id !== catalogProductId) return [];
  const research = normalizeSourceTypes(draft.research_payload);
  if ((research.ingredients.status !== "found" && research.ingredients.status !== "partial") || research.ingredients.conflicts.length > 0) return [];
  const official = new Set(research.sources.filter((source) => /^(official_brand|brand_owner|official_retailer|official_store)$/.test(source.source_type)).map((source) => source.source_id));
  return research.ingredients.items
    .filter((item) => (item.confidence ?? 0) >= 80 && item.evidence_refs.some((ref) => official.has(ref)))
    .map((item) => ({ inciName: item.normalized_name ?? item.raw_name, displayName: item.raw_name, aliases: item.normalized_name ? [item.raw_name] : [] }));
}

export function runtimeAvailableProductKnowledgeFromLoaded(
  formal: ProductKnowledgeSnapshot | null,
  draft: ProductResearchDraft | null,
  catalogProductId: string,
): RuntimeAvailableProductKnowledge {
  const derived = draft && draft.catalog_product_id === catalogProductId
    && draft.research_payload.product_type.value
    ? deriveRuntimeProductKnowledge({
        catalogProductId,
        productType: draft.research_payload.product_type.value,
        research: normalizeSourceTypes(draft.research_payload),
        reviewedAt: draft.updated_at,
      })
    : null;
  const roles: RuntimeAvailableProductKnowledge["care_roles"] = (formal?.care_roles ?? []).map((role) => ({
    care_role_code: role.care_role_code,
    assignment_kind: role.assignment_kind,
    status: role.status,
    confidence: role.confidence,
  }));
  const capabilities: RuntimeAvailableProductKnowledge["capabilities"] = (formal?.capabilities ?? []).map((capability) => ({
    capability_code: capability.capability_code,
    status: capability.status,
    confidence: capability.confidence,
  }));
  for (const role of derived?.roles ?? []) {
    if (!roles.some((item) => item.care_role_code === role.care_role_code)) roles.push(role);
  }
  for (const capability of derived?.capabilities ?? []) {
    if (!capabilities.some((item) => item.capability_code === capability.capability_code)) capabilities.push(capability);
  }
  return {
    provenance: formal ? "formal_verified" : derived ? "draft_derived" : "unknown",
    care_roles: roles,
    capabilities,
  };
}

/**
 * Read-only bridge. Formal knowledge always wins per field; a usable draft can
 * only fill fields which formal knowledge has not supplied.
 */
export function createProductKnowledgeRuntimeAvailabilityService(dependencies: {
  formal: Pick<ProductKnowledgeRepository, "findByCatalogProductId">;
  drafts: Pick<ProductResearchDraftRepository, "getLatestUsableDraft">;
}) {
  return {
    async findTrustedDraftIngredients(catalogProductId: string): Promise<RuntimeDraftIngredients> {
      const draft = await dependencies.drafts.getLatestUsableDraft(catalogProductId);
      return trustedDraftIngredientsFromLoaded(draft, catalogProductId);
    },
    async findByCatalogProductId(catalogProductId: string): Promise<RuntimeAvailableProductKnowledge> {
      const formal = await dependencies.formal.findByCatalogProductId(catalogProductId);
      const draft = await dependencies.drafts.getLatestUsableDraft(catalogProductId);
      return runtimeAvailableProductKnowledgeFromLoaded(formal, draft, catalogProductId);
    },
  };
}

/** Explicit, finite source taxonomy bridge; never keyword-matches arbitrary text. */
function normalizeSourceTypes<T extends { sources: Array<{ source_type: string }> }>(research: T): T {
  return {
    ...research,
    sources: research.sources.map((source) => ({
      ...source,
      source_type: source.source_type === "品牌官网产品中心" ? "official_brand" : source.source_type,
    })),
  };
}
