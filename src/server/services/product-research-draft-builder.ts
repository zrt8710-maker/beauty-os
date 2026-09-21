import "server-only";

import { PRODUCT_TYPES } from "@/schemas/product";
import {
  PRODUCT_KNOWLEDGE_CAPABILITY_CODES,
  PRODUCT_KNOWLEDGE_CARE_ROLE_CODES,
} from "@/schemas/product-knowledge-curation";
import {
  productResearchProviderResultSchema,
  type Agent3ResearchResult,
  type ProductResearchInput,
  type ProductResearchProviderResult,
} from "@/schemas/product-research";

type RecordValue = Record<string, unknown>;
const draftConfidenceFields = ["identity", "ingredients", "claims", "texture", "usage", "product_type", "care_role", "capability"] as const;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function asTextArray(value: unknown): unknown { return Array.isArray(value) ? value : []; }
function trimmedStrings(value: unknown): string[] {
  return asArray(value).flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []);
}
function textList(value: unknown): unknown {
  if (typeof value === "string") return [value];
  return value;
}
function block(payload: RecordValue, field: string): RecordValue {
  return isRecord(payload[field]) ? payload[field] : {};
}
function normalizeConfidence(value: unknown): unknown {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  return Math.max(0, Math.min(100, Math.round(value)));
}
function refs(value: RecordValue): unknown { return asTextArray(value.evidence_refs); }
function reasons(value: RecordValue): unknown { return asTextArray(value.reasons); }
function flag(value: RecordValue, key: "has_conflict" | "includes_ai_inference"): unknown {
  return typeof value[key] === "boolean" ? value[key] : false;
}
function mapUncertainties(value: unknown): unknown {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") {
      const description = item.trim();
      return description ? [{ field: "general", description, evidence_refs: [] }] : [];
    }
    if (!isRecord(item) || !hasOnlyKeys(item, ["field", "description", "evidence_refs"])) return [];
    const description = typeof item.description === "string" ? item.description.trim() : "";
    if (!description) return [];
    const field = typeof item.field === "string" && item.field.trim() ? item.field.trim() : "general";
    return [{ field, description, evidence_refs: asTextArray(item.evidence_refs) }];
  });
}
function mapConflicts(value: unknown): unknown {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || !hasOnlyKeys(item, ["field", "values", "severity", "evidence_refs"])) return [];
    const field = typeof item.field === "string" ? item.field.trim() : "";
    const values = trimmedStrings(item.values);
    const severity = item.severity;
    if (!field || values.length < 2 || !["blocking", "review_required", "informational"].includes(String(severity))) return [];
    return [{ field, values, severity, evidence_refs: asTextArray(item.evidence_refs) }];
  });
}
function hasOnlyKeys(value: RecordValue, allowedKeys: readonly string[]) {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}
function mapSources(value: unknown): unknown {
  return asArray(value).map((item) => isRecord(item) ? ({
    source_id: item.source_id,
    url: item.url ?? item.URL,
    title: item.title,
    source_type: item.source_type,
    authority_tier: item.authority_tier,
    retrieved_at: item.retrieved_at,
  }) : item);
}
function mapIngredientStatus(value: unknown): unknown {
  // Agent3 and the persisted draft share these four established states.
  return value === "found" || value === "partial" || value === "conflicted" || value === "unknown"
    ? value
    : "unknown";
}
function mapIngredientRawText(value: unknown): unknown {
  // Draft raw_text is a collection of verbatim source declarations, not a
  // parsed ingredient-name list. Keep a single declaration intact rather
  // than splitting punctuation whose meaning may be source-specific.
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  return trimmedStrings(value);
}
function mapIngredientItems(value: unknown, sectionEvidenceRefs: unknown): unknown {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") {
      const rawName = item.trim();
      return rawName ? [{
        raw_name: rawName,
        normalized_name: null,
        ingredient_order: null,
        confidence: null,
        evidence_refs: sectionEvidenceRefs,
      }] : [];
    }
    if (!isRecord(item)) return [];
    const rawName = typeof item.raw_name === "string" ? item.raw_name.trim() : typeof item.name === "string" ? item.name.trim() : "";
    if (!rawName) return [];
    return [{
      raw_name: rawName,
      normalized_name: item.normalized_name ?? null,
      ingredient_order: item.ingredient_order ?? null,
      confidence: typeof item.confidence === "number" && Number.isFinite(item.confidence) ? normalizeConfidence(item.confidence) : null,
      evidence_refs: item.evidence_refs ?? sectionEvidenceRefs,
    }];
  });
}
function mapIngredients(section: RecordValue): RecordValue {
  const value = isRecord(section.value) ? section.value : null;
  let status = value === null ? "unknown" : mapIngredientStatus(value.status);
  const sectionEvidenceRefs = refs(section);
  const rawText = value?.raw_text === undefined ? [] : mapIngredientRawText(value.raw_text);
  const items = value?.items === undefined ? [] : mapIngredientItems(value.items, sectionEvidenceRefs);
  if (status === "found" && Array.isArray(items) && items.length === 0) {
    status = Array.isArray(rawText) && rawText.length > 0 ? "partial" : "unknown";
  }
  return {
    status,
    raw_text: rawText,
    items,
    conflicts: mapConflicts(value?.conflicts),
    confidence: normalizeConfidence(section.confidence),
  };
}
function mapClaims(section: RecordValue): unknown {
  if (section.value === null || section.value === undefined) return [];
  if (!Array.isArray(section.value)) return [];
  const sectionEvidenceRefs = refs(section);
  return section.value.flatMap((item) => {
    if (typeof item === "string") {
      const rawText = item.trim();
      return rawText ? [{
        raw_text: rawText,
        normalized_claim: null,
        confidence: null,
        evidence_refs: sectionEvidenceRefs,
      }] : [];
    }
    if (!isRecord(item) || typeof item.raw_text !== "string" || !item.raw_text.trim()) return [];
    return [{
      raw_text: item.raw_text.trim(),
      normalized_claim: item.normalized_claim ?? null,
      confidence: typeof item.confidence === "number" && Number.isFinite(item.confidence) ? normalizeConfidence(item.confidence) : null,
      evidence_refs: item.evidence_refs ?? sectionEvidenceRefs,
    }];
  });
}
function mapTexture(section: RecordValue): unknown {
  if (section.value === null || section.value === undefined) return null;
  const evidenceRefs = refs(section);
  if (typeof section.value !== "string" || !section.value.trim() || !Array.isArray(evidenceRefs) || evidenceRefs.length === 0) return null;
  return {
    value: section.value.trim(),
    basis: "external_evidence",
    confidence: normalizeConfidence(section.confidence),
    evidence_refs: evidenceRefs,
  };
}
function mapUsage(section: RecordValue): RecordValue {
  const value = isRecord(section.value) ? section.value : {};
  const instructions = typeof section.value === "string"
    ? trimmedStrings([section.value])
    : value.instructions === undefined || value.instructions === null ? [] : trimmedStrings(textList(value.instructions));
  const amPm = value.am_pm === undefined || value.am_pm === null
    ? []
    : trimmedStrings(textList(value.am_pm)).filter((value): value is "am" | "pm" => value === "am" || value === "pm");
  const cautions = value.cautions === undefined || value.cautions === null ? [] : trimmedStrings(textList(value.cautions));
  return {
    instructions,
    am_pm: amPm,
    frequency: typeof value.frequency === "string" && value.frequency.trim() ? value.frequency.trim() : null,
    routine_order: typeof value.routine_order === "string" && value.routine_order.trim() ? value.routine_order.trim() : null,
    leave_on: typeof value.leave_on === "boolean" ? value.leave_on : null,
    rinse_off: typeof value.rinse_off === "boolean" ? value.rinse_off : null,
    cautions,
    confidence: normalizeConfidence(section.confidence),
    evidence_refs: refs(section),
  };
}
function mapProductType(section: RecordValue): RecordValue {
  const candidate = section.value;
  const knownType = typeof candidate === "string" && (PRODUCT_TYPES as readonly string[]).includes(candidate);
  return {
    value: knownType ? candidate : null,
    confidence: knownType ? normalizeConfidence(section.confidence) : 0,
    basis: knownType ? "external_evidence" : "unknown",
    evidence_refs: knownType ? refs(section) : [],
  };
}
function mapCandidates(
  section: RecordValue,
  validCodes: readonly string[],
): unknown {
  if (!Array.isArray(section.value)) return [];
  const sectionRefs = refs(section);
  return section.value.flatMap((item) => {
    if (!isRecord(item) || typeof item.code !== "string" || !validCodes.includes(item.code)) return [];
    return [{
      code: item.code,
      confidence: typeof item.confidence === "number" && Number.isFinite(item.confidence)
        ? normalizeConfidence(item.confidence)
        : normalizeConfidence(section.confidence),
      // Agent3 candidates remain explicitly non-authoritative research leads.
      basis: "ai_inference",
      evidence_refs: item.evidence_refs ?? sectionRefs,
    }];
  });
}
function fieldScore(section: RecordValue): unknown {
  return normalizeConfidence(section.confidence ?? 0);
}
function mapFieldConfidence(sections: Record<string, RecordValue>): RecordValue {
  const agentFields: Record<string, string> = {
    identity: "identity", ingredients: "ingredients", claims: "claims", texture: "texture", usage: "usage", product_type: "product_type",
    care_role: "care_role_candidates", capability: "capability_candidates",
  };
  return {
    ...Object.fromEntries(draftConfidenceFields.map((field) => {
    const section = sections[agentFields[field]] ?? {};
    return [field, {
      score: fieldScore(section),
      evidence_refs: refs(section),
      reasons: reasons(section),
      has_conflict: flag(section, "has_conflict"),
      includes_ai_inference: flag(section, "includes_ai_inference"),
    }];
    })),
    risk: { score: 0, evidence_refs: [], reasons: [], has_conflict: false, includes_ai_inference: false },
  };
}

/**
 * Explicitly composes the AI transport shape into the persisted draft shape.
 * Catalog owns identity facts; Agent3 can contribute only identity evidence,
 * aliases, confidence, and uncertainty. No AI object is spread into storage.
 */
export function buildProductResearchDraftResult(
  catalogIdentity: ProductResearchInput,
  modelResult: Agent3ResearchResult,
): ProductResearchProviderResult {
  const payload = modelResult.research_payload;
  const identity = block(payload, "identity");
  const ingredients = block(payload, "ingredients");
  const claims = block(payload, "claims");
  const usage = block(payload, "usage");
  const productType = block(payload, "product_type");
  const sections = { identity, ingredients, claims, texture: block(payload, "texture"), usage, product_type: productType, care_role_candidates: block(payload, "care_role_candidates"), capability_candidates: block(payload, "capability_candidates") };

  return productResearchProviderResultSchema.parse({
    overall_confidence: normalizeConfidence(modelResult.overall_confidence),
    research_run_id: modelResult.research_run_id,
    research_payload: {
      identity: {
        brand_name: catalogIdentity.brand_name,
        product_name: catalogIdentity.product_name,
        variant_name: catalogIdentity.variant_name,
        barcode: catalogIdentity.barcode,
        aliases: asTextArray(isRecord(identity.value) ? identity.value.aliases : []),
        confidence: normalizeConfidence(identity.confidence),
        evidence_refs: refs(identity),
        uncertainties: [],
      },
      ingredients: mapIngredients(ingredients),
      claims: mapClaims(claims),
      texture: mapTexture(sections.texture),
      usage: mapUsage(usage),
      product_type: mapProductType(productType),
      care_role_candidates: mapCandidates(
        sections.care_role_candidates,
        PRODUCT_KNOWLEDGE_CARE_ROLE_CODES,
      ),
      capability_candidates: mapCandidates(
        sections.capability_candidates,
        PRODUCT_KNOWLEDGE_CAPABILITY_CODES,
      ),
      risk_cautions: [],
      field_confidence: mapFieldConfidence(sections),
      sources: mapSources(modelResult.sources),
      uncertainties: mapUncertainties(payload.uncertainties),
      conflicts: mapConflicts(payload.conflicts),
    },
  });
}

/** A source alone is provenance, not usable research content. */
export function hasMeaningfulProductResearchContent(result: ProductResearchProviderResult) {
  const payload = result.research_payload;
  return payload.identity.evidence_refs.length > 0
    || payload.ingredients.items.length > 0
    || payload.claims.length > 0
    || payload.texture !== null
    || payload.usage.instructions.length > 0
    || payload.usage.cautions.length > 0
    || payload.product_type.value !== null;
}
