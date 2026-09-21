import "server-only";

import type { CatalogIdentityProduct } from "@/server/repositories/catalog-identity-repository";
import type { ProductResearchDraft } from "@/schemas/product-research-draft";

export const PRODUCT_KNOWLEDGE_COMPLETENESS_STATES = [
  "complete",
  "partial",
  "missing",
  "uncertain",
] as const;

export const PRODUCT_KNOWLEDGE_SOURCE_QUALITY_STATES = [
  "strong",
  "mixed",
  "weak",
  "unknown",
] as const;

export const PRODUCT_KNOWLEDGE_COMPLETENESS_OVERALL_STATES = [
  "complete",
  "usable",
  "incomplete",
  "needs_attention",
] as const;

export const PRODUCT_KNOWLEDGE_COMPLETENESS_ACTIONS = [
  "rerun_research",
  "confirm_variant",
  "add_ingredients",
  "add_usage",
  "review_source_quality",
  "no_action",
] as const;

export type ProductKnowledgeCompletenessState =
  typeof PRODUCT_KNOWLEDGE_COMPLETENESS_STATES[number];
export type ProductKnowledgeSourceQuality =
  typeof PRODUCT_KNOWLEDGE_SOURCE_QUALITY_STATES[number];
export type ProductKnowledgeCompletenessOverall =
  typeof PRODUCT_KNOWLEDGE_COMPLETENESS_OVERALL_STATES[number];
export type ProductKnowledgeCompletenessAction =
  typeof PRODUCT_KNOWLEDGE_COMPLETENESS_ACTIONS[number];

export type ProductKnowledgeCompleteness = {
  overall: ProductKnowledgeCompletenessOverall;
  fields: {
    identity: ProductKnowledgeCompletenessState;
    variant: ProductKnowledgeCompletenessState;
    product_type: ProductKnowledgeCompletenessState;
    ingredients: ProductKnowledgeCompletenessState;
    claims: ProductKnowledgeCompletenessState;
    texture: ProductKnowledgeCompletenessState;
    usage: ProductKnowledgeCompletenessState;
    cautions: ProductKnowledgeCompletenessState;
    uncertainties_conflicts: ProductKnowledgeCompletenessState;
  };
  source_quality: ProductKnowledgeSourceQuality;
  suggested_actions: ProductKnowledgeCompletenessAction[];
};

export type ProductKnowledgeCompletenessInput = {
  product: CatalogIdentityProduct;
  latest_snapshot: ProductResearchDraft | null;
};

export type ProductKnowledgeCompletenessService = {
  assess(input: ProductKnowledgeCompletenessInput): ProductKnowledgeCompleteness;
};

/**
 * Read-time Product Database completeness only. It deliberately does not
 * assess Beauty OS interpretation (roles/capabilities) or routine readiness.
 */
export function createProductKnowledgeCompletenessService(): ProductKnowledgeCompletenessService {
  return { assess };
}

function assess(input: ProductKnowledgeCompletenessInput): ProductKnowledgeCompleteness {
  const snapshot = input.latest_snapshot;
  const payload = snapshot?.research_payload;
  const variantUncertain = hasVariantUncertainty(payload);
  const fields = {
    // A user-confirmed candidate is an identity-complete Catalog record.
    identity: input.product.brand_name.trim() && input.product.product_name.trim()
      ? "complete"
      : "missing",
    variant: variantUncertain
      ? "uncertain"
      : input.product.variant_name
        ? "complete"
        : payload?.identity.variant_name
          ? "partial"
          // A null Catalog variant is the existing read-time representation
          // of a product with no meaningful version/size distinction. Only
          // explicit evidence of a SKU/version conflict needs follow-up.
          : "complete",
    product_type: productTypeState(input.product, payload),
    ingredients: ingredientState(payload),
    claims: payload?.claims.length ? "complete" : "missing",
    texture: payload?.texture ? "complete" : "missing",
    usage: usageState(payload),
    cautions: payload?.usage.cautions.length ? "complete" : "missing",
    uncertainties_conflicts: uncertaintyConflictState(payload),
  } satisfies ProductKnowledgeCompleteness["fields"];
  const sourceQuality = sourceQualityState(payload, variantUncertain);
  const suggestedActions = suggestedActionsFor(fields, sourceQuality, snapshot);

  return {
    overall: overallState(fields, sourceQuality),
    fields,
    source_quality: sourceQuality,
    suggested_actions: suggestedActions,
  };
}

function productTypeState(
  product: CatalogIdentityProduct,
  payload: ProductResearchDraft["research_payload"] | undefined,
): ProductKnowledgeCompletenessState {
  if (product.product_type) return "complete";
  if (!payload?.product_type.value) return "missing";
  return payload.product_type.basis === "external_evidence" ? "complete" : "uncertain";
}

function ingredientState(
  payload: ProductResearchDraft["research_payload"] | undefined,
): ProductKnowledgeCompletenessState {
  if (!payload) return "missing";
  const ingredients = payload.ingredients;
  if (ingredients.status === "conflicted" || ingredients.conflicts.length > 0
    || payload.field_confidence.ingredients.has_conflict) return "uncertain";
  if (ingredients.status !== "found" && ingredients.status !== "partial") return "missing";
  if (ingredients.items.length === 0) return "missing";
  const sourceIds = new Set(payload.sources.map((source) => source.source_id));
  return ingredients.items.every((item) => item.evidence_refs.some((ref) => sourceIds.has(ref)))
    ? "complete"
    : "partial";
}

function usageState(
  payload: ProductResearchDraft["research_payload"] | undefined,
): ProductKnowledgeCompletenessState {
  if (!payload) return "missing";
  if (!payload.usage.instructions.length) {
    return payload.usage.am_pm.length || payload.usage.frequency || payload.usage.routine_order
      ? "partial"
      : "missing";
  }
  return payload.usage.am_pm.length || payload.usage.frequency || payload.usage.routine_order
    || payload.usage.leave_on !== null || payload.usage.rinse_off !== null
    ? "complete"
    : "partial";
}

function uncertaintyConflictState(
  payload: ProductResearchDraft["research_payload"] | undefined,
): ProductKnowledgeCompletenessState {
  if (!payload) return "missing";
  return payload.conflicts.length || payload.uncertainties.length || payload.ingredients.conflicts.length
    || payload.identity.uncertainties.length
    ? "uncertain"
    : "complete";
}

function hasVariantUncertainty(payload: ProductResearchDraft["research_payload"] | undefined) {
  if (!payload) return false;
  return [...payload.identity.uncertainties, ...payload.uncertainties]
    .some((item) => /variant|version|generation|sku|版本|代际|型号/u.test(`${item.field} ${item.description}`))
    || payload.conflicts.some((item) => /variant|version|generation|sku|版本|代际|型号/u.test(item.field));
}

function sourceQualityState(
  payload: ProductResearchDraft["research_payload"] | undefined,
  variantUncertain: boolean,
): ProductKnowledgeSourceQuality {
  if (!payload || variantUncertain) return variantUncertain ? "weak" : "unknown";
  const referenced = new Set([
    ...payload.identity.evidence_refs,
    ...payload.ingredients.items.flatMap((item) => item.evidence_refs),
    ...payload.claims.flatMap((item) => item.evidence_refs),
    ...(payload.texture?.evidence_refs ?? []),
    ...payload.usage.evidence_refs,
    ...payload.product_type.evidence_refs,
  ]);
  const sources = payload.sources.filter((source) => referenced.has(source.source_id));
  if (!sources.length) return "unknown";
  const types = sources.map((source) => source.source_type.toLowerCase());
  if (types.some((type) => /official|brand_owner|brand/.test(type))) return "strong";
  if (types.some((type) => /retail|store|retailer/.test(type))) return "mixed";
  return "weak";
}

function overallState(
  fields: ProductKnowledgeCompleteness["fields"],
  sourceQuality: ProductKnowledgeSourceQuality,
): ProductKnowledgeCompletenessOverall {
  if (fields.identity === "uncertain" || fields.variant === "uncertain"
    || fields.product_type === "uncertain" || fields.ingredients === "uncertain"
    || fields.uncertainties_conflicts === "uncertain" || sourceQuality === "weak") {
    return "needs_attention";
  }

  // V1's usable bar is identity, supported taxonomy and at least one
  // product-specific source. Claims, texture, usage and cautions are useful
  // enrichment, not publication-style gates. In particular, an empty caution
  // list does not prove the database is incomplete.
  if (fields.identity !== "complete" || fields.product_type === "missing" || sourceQuality === "unknown") {
    return "incomplete";
  }

  if (fields.ingredients === "complete" && fields.claims === "complete"
    && fields.texture === "complete" && fields.usage === "complete") {
    return "complete";
  }

  return "usable";
}

function suggestedActionsFor(
  fields: ProductKnowledgeCompleteness["fields"],
  sourceQuality: ProductKnowledgeSourceQuality,
  snapshot: ProductResearchDraft | null,
): ProductKnowledgeCompletenessAction[] {
  const actions: ProductKnowledgeCompletenessAction[] = [];
  if (!snapshot) actions.push("rerun_research");
  if (fields.variant === "uncertain") actions.push("confirm_variant");
  if (fields.ingredients === "missing" || fields.ingredients === "partial" || fields.ingredients === "uncertain") actions.push("add_ingredients");
  if (fields.usage === "missing" || fields.usage === "partial") actions.push("add_usage");
  if (sourceQuality === "weak" || sourceQuality === "unknown") actions.push("review_source_quality");
  return actions.length ? actions : ["no_action"];
}

export const PRODUCT_KNOWLEDGE_COMPLETENESS_LABELS: Record<
  ProductKnowledgeCompletenessState,
  string
> = {
  complete: "完整",
  partial: "部分获取",
  missing: "暂未获取",
  uncertain: "待确认",
};

export const PRODUCT_KNOWLEDGE_COMPLETENESS_OVERALL_LABELS: Record<
  ProductKnowledgeCompletenessOverall,
  string
> = {
  complete: "资料完整",
  usable: "资料较完整",
  incomplete: "资料不完整",
  needs_attention: "需要关注",
};
