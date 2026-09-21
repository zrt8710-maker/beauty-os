import "server-only";

import type { ProductType } from "@/schemas/product";
import type { ProductResearchDraft } from "@/schemas/product-research-draft";
import type { ProductKnowledgeSnapshot } from "@/schemas/product-knowledge";
import type { ProductKnowledgeRepository } from "@/server/repositories/product-knowledge-repository";
import type { ProductResearchDraftRepository } from "@/server/repositories/product-research-draft-repository";
import {
  canonicalizeIngredientName,
  ingredientKnowledgeEntryMatchesNames,
  type IngredientKnowledgePack,
  type IngredientKnowledgePackEntry,
} from "@/server/services/ingredient-knowledge-pack";

export const CARE_STEP_PURPOSES = [
  "cleansing",
  "basic_moisturization",
  "hydration_support",
  "sun_protection",
  "optional_treatment",
] as const;
export type CareStepPurpose = typeof CARE_STEP_PURPOSES[number];

export const PLANNER_PRODUCT_FACT_FIELDS = [
  "productType",
  "claims",
  "texture",
  "usage",
  "cautions",
  "ingredients",
] as const;
export type PlannerProductFactField = typeof PLANNER_PRODUCT_FACT_FIELDS[number];

export type PlannerProductEvidence = {
  productType: ProductType | null;
  claims: Array<{ text: string; evidenceRefs: string[] }>;
  usage: { instructions: string[]; cautions: string[]; evidenceRefs: string[] } | null;
  texture: { description: string; evidenceRefs: string[] } | null;
  ingredients: Array<{ normalizedName: string; evidenceRefs: string[] }>;
  /**
   * Source-referenced ingredient mentions for ordinary product-fit judgment.
   * They are intentionally separate from normalized `ingredients`: this data
   * never participates in avoid-ingredient or other hard-safety decisions.
   */
  advisoryIngredients: Array<{ name: string; evidenceRefs: string[] }>;
  /** Document-pack facts about ingredients actually present in this product. */
  ingredientKnowledge?: Array<{
    canonicalName: string;
    displayNameZh: string;
    functions: string[];
    statementZh: string;
    boundaries: string[];
  }>;
  sourceRefs: Array<{ id: string; sourceType: string; title: string }>;
  supportedPurposes: CareStepPurpose[];
  evidenceRefs: string[];
  usableSkincareEvidence: boolean;
  provenance: "formal_verified" | "draft_derived" | "unknown";
  /** Fields that are actually present in this sanitized projection. */
  knownFacts: PlannerProductFactField[];
  /** Missing means unknown—not unsafe, ineligible, or unsuitable. */
  unknownFields: PlannerProductFactField[];
  /** Compact Planner-facing descriptions of the unknown boundaries. */
  limitations: string[];
};

const HYDRATION = /hydration|moisturi[sz]|保湿|补水|水分/u;
const MOISTURE_SEALING = /moisture[\s-]?sealing|emollient|occlusive|锁水|封层|保湿收尾|面霜|乳液|emulsion|gel[\s-]?cream|凝霜/u;

/**
 * Planner-only, read-only Tier-B projection. It deliberately exposes only
 * source-referenced, conflict-free facts; it never turns draft prose into a
 * formal Product Knowledge capability.
 */
export function createPlannerProductEvidenceService(dependencies: {
  drafts: Pick<ProductResearchDraftRepository, "getLatestUsableDraft">;
  /** Formal knowledge is merged here, so the Planner has one purpose truth. */
  formal?: Pick<ProductKnowledgeRepository, "findByCatalogProductId">;
  ingredientKnowledgePack?: IngredientKnowledgePack;
}) {
  return {
    async findByCatalogProductId(catalogProductId: string, timing?: { requestId: string }): Promise<PlannerProductEvidence> {
      const productKnowledgeStartedAt = Date.now();
      const [draft, formal] = await Promise.all([
        dependencies.drafts.getLatestUsableDraft(catalogProductId, timing),
        dependencies.formal
          ? dependencies.formal.findByCatalogProductId(catalogProductId, timing).catch(() => null)
          : null,
      ]);
      logPlannerEvidenceTiming("product_knowledge_retrieval", productKnowledgeStartedAt);
      const evidence = mergeFormalKnowledge(
        draft ? projectDraft(draft) : emptyPlannerProductEvidence(),
        formal,
      );
      const productIngredientNames = [...new Set([
        ...evidence.ingredients.map((ingredient) => ingredient.normalizedName),
        ...evidence.advisoryIngredients.map((ingredient) => ingredient.name),
      ])];
      if (!dependencies.ingredientKnowledgePack || productIngredientNames.length === 0) return evidence;
      const ingredientProjectionStartedAt = Date.now();
      const facts = await dependencies.ingredientKnowledgePack.findForIngredientNames(
        productIngredientNames,
      );
      logPlannerEvidenceTiming("ingredient_knowledge_projection", ingredientProjectionStartedAt, { factCount: facts.length });
      return {
        ...evidence,
        ingredientKnowledge: projectIngredientKnowledgePack(productIngredientNames, facts),
      };
    },
  };
}

export async function projectPlannerProductEvidenceFromLoaded(
  draft: ProductResearchDraft | null,
  formal: ProductKnowledgeSnapshot | null,
  ingredientKnowledgePack?: IngredientKnowledgePack,
): Promise<PlannerProductEvidence> {
  const evidence = mergeFormalKnowledge(
    draft ? projectDraft(draft) : emptyPlannerProductEvidence(),
    formal,
  );
  const productIngredientNames = [...new Set([
    ...evidence.ingredients.map((ingredient) => ingredient.normalizedName),
    ...evidence.advisoryIngredients.map((ingredient) => ingredient.name),
  ])];
  if (!ingredientKnowledgePack || productIngredientNames.length === 0) return evidence;
  const facts = await ingredientKnowledgePack.findForIngredientNames(productIngredientNames);
  return {
    ...evidence,
    ingredientKnowledge: projectIngredientKnowledgePack(productIngredientNames, facts),
  };
}

function logPlannerEvidenceTiming(stage: string, startedAt: number, details: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV !== "development") return;
  console.info("[today-care-planner]", { stage, durationMs: Date.now() - startedAt, ...details });
}

/**
 * This is the sole Planner purpose derivation. Formal verified roles and
 * capabilities contribute only their explicit semantics; source-backed draft
 * facts contribute their own narrow purposes. Neither side reinterprets the
 * other after this merge.
 */
function mergeFormalKnowledge(
  draftEvidence: PlannerProductEvidence,
  formal: ProductKnowledgeSnapshot | null,
): PlannerProductEvidence {
  if (!formal) return draftEvidence;

  const formalPurposes = new Set<CareStepPurpose>();
  for (const role of formal.care_roles) {
    if (role.status !== "verified" || role.confidence === null) continue;
    const purpose = purposeForFormalRole(role.care_role_code);
    if (purpose) formalPurposes.add(purpose);
  }
  for (const capability of formal.capabilities) {
    if (capability.status !== "verified" || capability.confidence === null) continue;
    for (const purpose of purposesForFormalCapability(capability.capability_code)) {
      formalPurposes.add(purpose);
    }
  }

  const hasFormalDecisionFacts = formalPurposes.size > 0;
  return withFactState({
    ...draftEvidence,
    productType: draftEvidence.productType ?? formal.identity.product_type,
    supportedPurposes: [...new Set([
      ...draftEvidence.supportedPurposes,
      ...formalPurposes,
    ])],
    usableSkincareEvidence: draftEvidence.usableSkincareEvidence
      || hasFormalDecisionFacts
      || formal.identity.category === "skincare",
    // A verified catalog identity alone must not relabel draft claims as
    // formal facts. Only explicit verified role/capability semantics do that.
    provenance: hasFormalDecisionFacts ? "formal_verified" : draftEvidence.provenance,
  });
}

function purposeForFormalRole(role: string): CareStepPurpose | null {
  return ({
    remover: "cleansing",
    cleanser: "cleansing",
    hydration: "hydration_support",
    moisturizer: "basic_moisturization",
    sunscreen: "sun_protection",
    treatment: "optional_treatment",
  } as Record<string, CareStepPurpose | undefined>)[role] ?? null;
}

function purposesForFormalCapability(capability: string): CareStepPurpose[] {
  if (capability === "hydration") return ["hydration_support"];
  if (capability === "barrier_support") {
    return ["basic_moisturization", "hydration_support"];
  }
  if (capability === "sun_protection") return ["sun_protection"];
  return [];
}

function projectDraft(draft: ProductResearchDraft): PlannerProductEvidence {
  const research = draft.research_payload;
  const field = research.field_confidence;
  const usable = (score: number, conflict: boolean, refs: string[]) =>
    score >= 70 && !conflict && refs.length > 0;
  const sourceIds = new Set(research.sources.map((source) => source.source_id));
  const refs = (items: string[]) => items.filter((ref) => sourceIds.has(ref));
  const claims = usable(field.claims.score, field.claims.has_conflict, field.claims.evidence_refs)
    ? research.claims
      .filter((claim) => refs(claim.evidence_refs).length > 0)
      .map((claim) => ({ text: claim.normalized_claim ?? claim.raw_text, evidenceRefs: refs(claim.evidence_refs) }))
    : [];
  const usage = usable(field.usage.score, field.usage.has_conflict, research.usage.evidence_refs)
    ? { instructions: research.usage.instructions, cautions: research.usage.cautions, evidenceRefs: refs(research.usage.evidence_refs) }
    : null;
  const texture = research.texture && usable(field.texture.score, field.texture.has_conflict, research.texture.evidence_refs)
    ? { description: research.texture.value, evidenceRefs: refs(research.texture.evidence_refs) }
    : null;
  const type = usable(field.product_type.score, field.product_type.has_conflict, research.product_type.evidence_refs)
    && research.product_type.basis === "external_evidence"
    ? research.product_type.value
    : null;
  const ingredientEvidence = research.ingredients.status === "found" || research.ingredients.status === "partial"
    ? research.ingredients.items
      .filter((item) => item.normalized_name && (item.confidence ?? 0) >= 80 && refs(item.evidence_refs).length > 0)
      .map((item) => ({ normalizedName: item.normalized_name!, evidenceRefs: refs(item.evidence_refs) }))
    : [];
  // A research item with a name, a real source reference, and no ingredient
  // section conflict is useful context for a low-risk fit judgment even before
  // normalization is complete. Keep it out of `ingredients`, the hard-fact
  // projection consumed by safety, so the two trust levels cannot blur.
  const advisoryIngredients = (research.ingredients.status === "found" || research.ingredients.status === "partial")
    && (research.ingredients.conflicts?.length ?? 0) === 0
    ? research.ingredients.items
      .filter((item) => refs(item.evidence_refs).length > 0)
      .map((item) => ({ name: item.normalized_name ?? item.raw_name, evidenceRefs: refs(item.evidence_refs) }))
      .filter((item, index, items) => items.findIndex((other) => other.name.localeCompare(item.name, "en") === 0) === index)
      .slice(0, 24)
    : [];
  const hydrationFact = claims.some((claim) => HYDRATION.test(claim.text))
    || Boolean(usage && HYDRATION.test(usage.instructions.join(" ")));
  const moistureSealingFact = [
    ...claims.map((claim) => claim.text),
    ...(usage?.instructions ?? []),
    texture?.description ?? "",
  ].some((fact) => MOISTURE_SEALING.test(fact));
  const purposes = new Set<CareStepPurpose>();
  if (type === "cleanser") purposes.add("cleansing");
  if (type === "sunscreen") purposes.add("sun_protection");
  // Hydration claims establish water support, not necessarily a complete
  // moisture-sealing finish. A non-moisturizer needs explicit, source-backed
  // finishing/sealing evidence before it can carry the baseline purpose.
  if (type === "moisturizer" || (hydrationFact && moistureSealingFact)) {
    purposes.add("basic_moisturization");
  }
  if (type && ["toner", "essence", "serum", "moisturizer"].includes(type) && hydrationFact) {
    purposes.add("hydration_support");
  }
  const evidenceRefs = [...new Set([
    ...claims.flatMap((claim) => claim.evidenceRefs),
    ...(usage?.evidenceRefs ?? []),
    ...(texture?.evidenceRefs ?? []),
    ...ingredientEvidence.flatMap((ingredient) => ingredient.evidenceRefs),
    ...advisoryIngredients.flatMap((ingredient) => ingredient.evidenceRefs),
    ...refs(research.product_type.evidence_refs),
  ])];
  return withFactState({
    productType: type,
    claims,
    usage,
    texture,
    ingredients: ingredientEvidence,
    advisoryIngredients,
    ingredientKnowledge: [],
    sourceRefs: research.sources.filter((source) => evidenceRefs.includes(source.source_id)).map((source) => ({ id: source.source_id, sourceType: source.source_type, title: source.title })),
    supportedPurposes: [...purposes],
    evidenceRefs,
    usableSkincareEvidence: type !== null || claims.length > 0 || usage !== null || texture !== null,
    provenance: "draft_derived",
  });
}

export function emptyPlannerProductEvidence(): PlannerProductEvidence {
  return withFactState({
    productType: null,
    claims: [],
    usage: null,
    texture: null,
    ingredients: [],
    advisoryIngredients: [],
    ingredientKnowledge: [],
    sourceRefs: [],
    supportedPurposes: [],
    evidenceRefs: [],
    usableSkincareEvidence: false,
    provenance: "unknown",
  });
}

/**
 * This boundary proves only membership and trust status, then keeps a compact
 * fact set. It intentionally does not infer which fact fits today's skin:
 * that comparison remains the Planner's judgment.
 */
export function projectIngredientKnowledgePack(
  productIngredientNames: readonly string[],
  facts: IngredientKnowledgePackEntry[],
): PlannerProductEvidence["ingredientKnowledge"] {
  const normalizedProductIngredientNames = new Set(
    productIngredientNames.map(canonicalizeIngredientName),
  );
  return facts
    .filter((fact) => ingredientKnowledgeEntryMatchesNames(fact, normalizedProductIngredientNames))
    .filter(distinctIngredientKnowledgeFunctions)
    .slice(0, 3)
    .map((fact) => ({
      canonicalName: fact.canonical_name,
      displayNameZh: fact.display_name_zh,
      functions: fact.functions,
      statementZh: fact.statement_zh,
      boundaries: fact.boundary,
    }));
}

/**
 * Keep the Planner's advisory context compact without creating an
 * ingredient-to-skin score: a later fact adds value only when it introduces
 * a function label not already represented for this same product.
 */
function distinctIngredientKnowledgeFunctions() {
  const representedFunctions = new Set<string>();
  return (fact: IngredientKnowledgePackEntry) => {
    const newFunctions = fact.functions.filter((item) => !representedFunctions.has(item));
    if (newFunctions.length === 0) return false;
    fact.functions.forEach((item) => representedFunctions.add(item));
    return true;
  };
}

function withFactState(input: Omit<
  PlannerProductEvidence,
  "knownFacts" | "unknownFields" | "limitations"
>): PlannerProductEvidence {
  const knownFacts: PlannerProductFactField[] = [
    ...(input.productType ? ["productType" as const] : []),
    ...(input.claims.length > 0 ? ["claims" as const] : []),
    ...(input.texture ? ["texture" as const] : []),
    ...(input.usage ? ["usage" as const] : []),
    ...(input.usage?.cautions.length ? ["cautions" as const] : []),
    ...(input.ingredients.length > 0 || input.advisoryIngredients.length > 0 ? ["ingredients" as const] : []),
  ];
  const unknownFields = PLANNER_PRODUCT_FACT_FIELDS.filter(
    (field) => !knownFacts.includes(field),
  );
  return {
    ...input,
    knownFacts,
    unknownFields,
    limitations: unknownFields.map((field) => `${field}_unknown`),
  };
}
