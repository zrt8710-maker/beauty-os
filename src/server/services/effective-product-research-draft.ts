import "server-only";

import type { ProductResearchDraft } from "@/schemas/product-research-draft";

export const PRODUCT_RESEARCH_ENRICHMENT_SECTIONS = [
  "product_type",
  "ingredients",
  "claims",
  "texture",
  "usage",
  "cautions",
  "reliable_sources",
] as const;

export type ProductResearchEnrichmentSection =
  typeof PRODUCT_RESEARCH_ENRICHMENT_SECTIONS[number];

type Payload = ProductResearchDraft["research_payload"];

/**
 * Facts from a newer draft win when they are usable. A merely absent section
 * may inherit the newest earlier usable section; a newly reported conflict
 * deliberately does not inherit an older apparent answer.
 */
export function effectiveProductResearchDraft(
  drafts: readonly ProductResearchDraft[],
): ProductResearchDraft | null {
  const usable = drafts
    .filter((draft) => ["draft", "review_pending", "approved"].includes(draft.status))
    .sort((left, right) => right.research_version - left.research_version);
  const latest = usable[0];
  if (!latest) return null;

  let payload = structuredClone(latest.research_payload);
  for (const older of usable.slice(1)) {
    const candidate = remapPayloadSources(older.research_payload, payload.sources);
    payload = inheritMissingSections(payload, candidate);
  }
  return { ...latest, research_payload: payload };
}

export function missingProductResearchSections(
  draft: ProductResearchDraft | null,
): ProductResearchEnrichmentSection[] {
  if (!draft) return [...PRODUCT_RESEARCH_ENRICHMENT_SECTIONS];
  const payload = draft.research_payload;
  return PRODUCT_RESEARCH_ENRICHMENT_SECTIONS.filter((section) => !sectionUsable(payload, section));
}

export function hasCompleteEnoughProductResearch(draft: ProductResearchDraft | null) {
  return missingProductResearchSections(draft).length === 0;
}

function inheritMissingSections(current: Payload, older: Payload): Payload {
  const output = structuredClone(current);
  if (!sectionConflicted(output, "ingredients")) {
    if (hasIngredientFacts(output) && hasIngredientFacts(older)) mergeIngredients(output, older);
    else if (!hasIngredientFacts(output) && hasIngredientFacts(older)) copySection(output, older, "ingredients");
  }
  if (!sectionConflicted(output, "claims")) {
    if (hasClaimFacts(output) && hasClaimFacts(older)) mergeClaims(output, older);
    else if (!hasClaimFacts(output) && hasClaimFacts(older)) copySection(output, older, "claims");
  }
  if (!sectionConflicted(output, "usage")) {
    if (hasUsageFacts(output) && hasUsageFacts(older)) mergeUsage(output, older);
    else if (!hasUsageFacts(output) && hasUsageFacts(older)) copySection(output, older, "usage");
  }
  if (!output.texture && !sectionConflicted(output, "texture") && older.texture) copySection(output, older, "texture");
  if (output.product_type.value === null && !sectionConflicted(output, "product_type")
    && older.product_type.value !== null) copySection(output, older, "product_type");
  mergeInterpretationCandidates(output, older);
  output.sources = deduplicateSources([...output.sources, ...older.sources]);
  return output;
}

function hasIngredientFacts(payload: Payload) {
  return payload.ingredients.items.length > 0 || payload.ingredients.raw_text.length > 0;
}

function hasClaimFacts(payload: Payload) {
  return payload.claims.length > 0;
}

function hasUsageFacts(payload: Payload) {
  const usage = payload.usage;
  return usage.instructions.length > 0 || usage.cautions.length > 0 || usage.am_pm.length > 0
    || usage.frequency !== null || usage.routine_order !== null
    || usage.leave_on !== null || usage.rinse_off !== null;
}

function mergeInterpretationCandidates(target: Payload, source: Payload) {
  target.care_role_candidates = mergeByKey(
    target.care_role_candidates,
    source.care_role_candidates,
    (item) => item.code,
  );
  target.capability_candidates = mergeByKey(
    target.capability_candidates,
    source.capability_candidates,
    (item) => item.code,
  );
  target.risk_cautions = mergeByKey(
    target.risk_cautions,
    source.risk_cautions,
    (item) => `${normalizeFact(item.code_or_label)}:${normalizeFact(item.description)}`,
  );
  if (source.care_role_candidates.length > 0) {
    target.field_confidence.care_role = mergeConfidence(
      target.field_confidence.care_role,
      source.field_confidence.care_role,
    );
  }
  if (source.capability_candidates.length > 0) {
    target.field_confidence.capability = mergeConfidence(
      target.field_confidence.capability,
      source.field_confidence.capability,
    );
  }
  if (source.risk_cautions.length > 0) {
    target.field_confidence.risk = mergeConfidence(
      target.field_confidence.risk,
      source.field_confidence.risk,
    );
  }
}

function mergeByKey<T extends { evidence_refs: string[]; confidence: number | null }>(
  current: T[],
  older: T[],
  key: (item: T) => string,
) {
  const merged = structuredClone(current);
  for (const item of older) {
    const existing = merged.find((candidate) => key(candidate) === key(item));
    if (!existing) merged.push(structuredClone(item));
    else {
      existing.evidence_refs = [...new Set([...existing.evidence_refs, ...item.evidence_refs])];
      existing.confidence = maxNullable(existing.confidence, item.confidence);
    }
  }
  return merged;
}

function mergeIngredients(target: Payload, source: Payload) {
  target.ingredients.items = mergeIngredientFacts(target.ingredients.items, source.ingredients.items);
  target.ingredients.raw_text = uniqueBy(
    [...target.ingredients.raw_text, ...source.ingredients.raw_text],
    normalizeFact,
  );
  target.ingredients.confidence = maxNullable(target.ingredients.confidence, source.ingredients.confidence);
  if (target.ingredients.status !== "found" && source.ingredients.status === "found") target.ingredients.status = "found";
  target.field_confidence.ingredients = mergeConfidence(target.field_confidence.ingredients, source.field_confidence.ingredients);
}

function mergeClaims(target: Payload, source: Payload) {
  target.claims = mergeClaimFacts(target.claims, source.claims);
  target.field_confidence.claims = mergeConfidence(target.field_confidence.claims, source.field_confidence.claims);
}

function mergeIngredientFacts(current: Payload["ingredients"]["items"], older: Payload["ingredients"]["items"]) {
  const merged = structuredClone(current);
  for (const item of older) {
    const key = normalizeFact(item.normalized_name ?? item.raw_name);
    const existing = merged.find((candidate) => normalizeFact(candidate.normalized_name ?? candidate.raw_name) === key);
    if (!existing) merged.push(structuredClone(item));
    else {
      existing.evidence_refs = [...new Set([...existing.evidence_refs, ...item.evidence_refs])];
      existing.confidence = maxNullable(existing.confidence, item.confidence);
      existing.normalized_name ??= item.normalized_name;
      existing.ingredient_order ??= item.ingredient_order;
    }
  }
  return merged;
}

function mergeClaimFacts(current: Payload["claims"], older: Payload["claims"]) {
  const merged = structuredClone(current);
  for (const claim of older) {
    const key = normalizeFact(claim.normalized_claim ?? claim.raw_text);
    const existing = merged.find((candidate) => normalizeFact(candidate.normalized_claim ?? candidate.raw_text) === key);
    if (!existing) merged.push(structuredClone(claim));
    else {
      existing.evidence_refs = [...new Set([...existing.evidence_refs, ...claim.evidence_refs])];
      existing.confidence = maxNullable(existing.confidence, claim.confidence);
      existing.normalized_claim ??= claim.normalized_claim;
    }
  }
  return merged;
}

function mergeUsage(target: Payload, source: Payload) {
  target.usage.instructions = uniqueBy([...target.usage.instructions, ...source.usage.instructions], normalizeFact);
  target.usage.cautions = uniqueBy([...target.usage.cautions, ...source.usage.cautions], normalizeFact);
  target.usage.am_pm = [...new Set([...target.usage.am_pm, ...source.usage.am_pm])];
  target.usage.frequency ??= source.usage.frequency;
  target.usage.routine_order ??= source.usage.routine_order;
  target.usage.leave_on ??= source.usage.leave_on;
  target.usage.rinse_off ??= source.usage.rinse_off;
  target.usage.confidence = maxNullable(target.usage.confidence, source.usage.confidence);
  target.usage.evidence_refs = [...new Set([...target.usage.evidence_refs, ...source.usage.evidence_refs])];
  target.field_confidence.usage = mergeConfidence(target.field_confidence.usage, source.field_confidence.usage);
}

function mergeConfidence<T extends Payload["field_confidence"][keyof Payload["field_confidence"]]>(current: T, older: T): T {
  return {
    ...current,
    score: Math.max(current.score, older.score),
    evidence_refs: [...new Set([...current.evidence_refs, ...older.evidence_refs])],
    reasons: uniqueBy([...current.reasons, ...older.reasons], normalizeFact).slice(0, 20),
    includes_ai_inference: current.includes_ai_inference || older.includes_ai_inference,
  };
}

function maxNullable(left: number | null, right: number | null) {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function uniqueBy<T>(values: T[], key: (value: T) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = key(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function normalizeFact(value: string) {
  return value.trim().toLocaleLowerCase("zh-CN").replace(/[\s\p{P}\p{S}]+/gu, "");
}

function copySection(target: Payload, source: Payload, section: ProductResearchEnrichmentSection) {
  if (section === "cautions") {
    target.usage = { ...target.usage, cautions: [...source.usage.cautions] };
    target.field_confidence.usage = structuredClone(source.field_confidence.usage);
    return;
  }
  if (section === "reliable_sources") return;
  if (section === "ingredients") {
    target.ingredients = structuredClone(source.ingredients);
    target.field_confidence.ingredients = structuredClone(source.field_confidence.ingredients);
    return;
  }
  if (section === "claims") {
    target.claims = structuredClone(source.claims);
    target.field_confidence.claims = structuredClone(source.field_confidence.claims);
    return;
  }
  if (section === "texture") {
    target.texture = structuredClone(source.texture);
    target.field_confidence.texture = structuredClone(source.field_confidence.texture);
    return;
  }
  if (section === "usage") {
    target.usage = structuredClone(source.usage);
    target.field_confidence.usage = structuredClone(source.field_confidence.usage);
    return;
  }
  target.product_type = structuredClone(source.product_type);
  target.field_confidence.product_type = structuredClone(source.field_confidence.product_type);
}

function sectionUsable(payload: Payload, section: ProductResearchEnrichmentSection) {
  // This is an enrichment-stop signal, not a product-fact or safety gate.
  // Historical/imported Research Packs can retain auditable provenance
  // (source type, title, tier and retrieval time) without a public URL. Do
  // not make such otherwise complete drafts rerun Agent3 indefinitely.
  if (section === "reliable_sources") return payload.sources.some(isReliableResearchSource);
  if (section === "ingredients") {
    // Partial ingredients remain usable evidence, but they are not an
    // enrichment stop signal. Keep asking Agent3 for the complete, exact-SKU
    // ingredient list in a later durable worker round.
    return payload.ingredients.status === "found"
      && payload.ingredients.items.length > 0
      && payload.ingredients.conflicts.length === 0;
  }
  if (section === "claims") return fieldUsable(payload, "claims") && payload.claims.length > 0;
  if (section === "texture") return fieldUsable(payload, "texture") && payload.texture !== null;
  if (section === "usage") return fieldUsable(payload, "usage") && payload.usage.instructions.length > 0;
  // A source-backed usage section can establish that no product-specific
  // caution was found. Requiring a non-empty caution list would turn every
  // ordinary product page into an endless enrichment target.
  if (section === "cautions") return fieldUsable(payload, "usage") && payload.usage.cautions.length > 0;
  return fieldUsable(payload, "product_type")
    && payload.product_type.value !== null
    && payload.product_type.basis === "external_evidence";
}

/**
 * Completeness accepts only a finite, auditable source taxonomy. It is
 * intentionally separate from ingredient safety, whose projection continues
 * to require its own official-source and ingredient-level evidence checks.
 */
function isReliableResearchSource(source: Payload["sources"][number]) {
  return source.title.trim().length > 0
    && RELIABLE_RESEARCH_SOURCE_TYPES.has(source.source_type)
    && (source.authority_tier === null || source.authority_tier <= 3);
}

const RELIABLE_RESEARCH_SOURCE_TYPES = new Set([
  "official_brand",
  "brand_owner",
  "official_product_page",
  "official_website",
  "official_retailer",
  "official_store",
  "regulatory_record",
  "open_dataset",
  "package_label",
  "user_submitted",
]);

function sectionConflicted(payload: Payload, section: ProductResearchEnrichmentSection) {
  if (section === "ingredients") return payload.ingredients.status === "conflicted" || payload.ingredients.conflicts.length > 0;
  if (section === "claims" || section === "texture" || section === "product_type") {
    return payload.field_confidence[section].has_conflict;
  }
  if (section === "usage" || section === "cautions") return payload.field_confidence.usage.has_conflict;
  return false;
}

function fieldUsable(
  payload: Payload,
  field: "claims" | "texture" | "usage" | "product_type",
) {
  const confidence = payload.field_confidence[field];
  return confidence.score >= 70 && !confidence.has_conflict && confidence.evidence_refs.length > 0;
}

function remapPayloadSources(payload: Payload, occupiedSources: Payload["sources"]): Payload {
  const occupied = new Set(occupiedSources.map((source) => source.source_id));
  const map = new Map<string, string>();
  const sources = payload.sources.map((source) => {
    let id = source.source_id;
    if (occupied.has(id)) id = `v${source.retrieved_at.slice(0, 10).replaceAll("-", "")}_${id}`;
    while (occupied.has(id)) id = `prior_${id}`;
    occupied.add(id);
    map.set(source.source_id, id);
    return { ...source, source_id: id };
  });
  const refs = (items: string[]) => items.map((item) => map.get(item) ?? item);
  const clone = structuredClone(payload);
  clone.sources = sources;
  clone.identity.evidence_refs = refs(clone.identity.evidence_refs);
  clone.identity.uncertainties.forEach((item) => { item.evidence_refs = refs(item.evidence_refs); });
  clone.ingredients.items.forEach((item) => { item.evidence_refs = refs(item.evidence_refs); });
  clone.ingredients.conflicts.forEach((item) => { item.evidence_refs = refs(item.evidence_refs); });
  clone.claims.forEach((item) => { item.evidence_refs = refs(item.evidence_refs); });
  if (clone.texture) clone.texture.evidence_refs = refs(clone.texture.evidence_refs);
  clone.usage.evidence_refs = refs(clone.usage.evidence_refs);
  clone.product_type.evidence_refs = refs(clone.product_type.evidence_refs);
  clone.care_role_candidates.forEach((item) => { item.evidence_refs = refs(item.evidence_refs); });
  clone.capability_candidates.forEach((item) => { item.evidence_refs = refs(item.evidence_refs); });
  clone.risk_cautions.forEach((item) => { item.evidence_refs = refs(item.evidence_refs); });
  Object.values(clone.field_confidence).forEach((item) => { item.evidence_refs = refs(item.evidence_refs); });
  clone.uncertainties.forEach((item) => { item.evidence_refs = refs(item.evidence_refs); });
  clone.conflicts.forEach((item) => { item.evidence_refs = refs(item.evidence_refs); });
  return clone;
}

function deduplicateSources(sources: Payload["sources"]) {
  return sources.filter((source, index) => sources.findIndex((candidate) => candidate.source_id === source.source_id) === index);
}

export type ProductResearchDelta = {
  added_fact_count: number;
  preserved_fact_count: number;
  invalidated_fact_count: number;
  newly_completed_sections: ProductResearchEnrichmentSection[];
  remaining_sections: ProductResearchEnrichmentSection[];
};

export function productResearchDelta(
  before: ProductResearchDraft | null,
  after: ProductResearchDraft | null,
): ProductResearchDelta {
  const beforeFacts = researchFactKeys(before);
  const afterFacts = researchFactKeys(after);
  const beforeMissing = new Set(missingProductResearchSections(before));
  const remainingSections = missingProductResearchSections(after);
  return {
    added_fact_count: [...afterFacts].filter((fact) => !beforeFacts.has(fact)).length,
    preserved_fact_count: [...afterFacts].filter((fact) => beforeFacts.has(fact)).length,
    invalidated_fact_count: [...beforeFacts].filter((fact) => !afterFacts.has(fact)).length,
    newly_completed_sections: PRODUCT_RESEARCH_ENRICHMENT_SECTIONS.filter((section) => beforeMissing.has(section) && !remainingSections.includes(section)),
    remaining_sections: remainingSections,
  };
}

function researchFactKeys(draft: ProductResearchDraft | null) {
  if (!draft) return new Set<string>();
  const payload = draft.research_payload;
  return new Set([
    ...payload.ingredients.items.map((item) => `ingredient:${normalizeFact(item.normalized_name ?? item.raw_name)}`),
    ...payload.claims.map((claim) => `claim:${normalizeFact(claim.normalized_claim ?? claim.raw_text)}`),
    ...(payload.texture ? [`texture:${normalizeFact(payload.texture.value)}`] : []),
    ...payload.usage.instructions.map((item) => `usage:${normalizeFact(item)}`),
    ...payload.usage.cautions.map((item) => `caution:${normalizeFact(item)}`),
    ...(payload.product_type.value ? [`product_type:${payload.product_type.value}`] : []),
  ]);
}
