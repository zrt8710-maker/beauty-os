import type { ProductType } from "@/schemas/product";
import type { ProductKnowledgeCurationInput } from "@/schemas/product-knowledge-curation";
import type { ProductResearchDraft } from "@/schemas/product-research-draft";

/**
 * Deterministic, deliberately small bridge from source-backed research facts
 * to the runtime knowledge contract. It never reads user state and it never
 * accepts Agent role/capability candidates as authority.
 */
const ROLE_BY_PRODUCT_TYPE: Partial<Record<ProductType, "cleanser" | "hydration" | "moisturizer" | "sunscreen">> = {
  cleanser: "cleanser",
  toner: "hydration",
  essence: "hydration",
  moisturizer: "moisturizer",
  sunscreen: "sunscreen",
};

const HYDRATION_PRODUCT_TYPES = new Set<ProductType>([
  "toner",
  "essence",
  "moisturizer",
]);

const HYDRATION_TERMS = /\b(hydrat(?:e|es|ed|ing|ion)|moisturi[sz](?:e|es|ed|ing|ation))\b|保湿|补水|水分/u;
const OFFICIAL_SOURCE = /^(official_brand|brand_owner|official_retailer|official_store)$/;

export function deriveRuntimeProductKnowledge(input: {
  catalogProductId: string;
  productType: ProductType;
  research: ProductResearchDraft["research_payload"];
  reviewedAt: string;
}): ProductKnowledgeCurationInput {
  const typeEvidence = reliableTypeEvidence(input.research, input.productType);
  const role = typeEvidence ? ROLE_BY_PRODUCT_TYPE[input.productType] : undefined;
  const roles = role ? [{
    care_role_code: role,
    assignment_kind: "primary" as const,
    status: "verified" as const,
    confidence: 90,
    assessment_note: `Beauty OS deterministic v0.1: source-backed normalized product type ${input.productType}.`,
    source_locator: typeEvidence?.url ?? null,
    reviewed_at: input.reviewedAt,
  }] : [];

  const capabilities: ProductKnowledgeCurationInput["capabilities"] = [];
  if (typeEvidence && input.productType === "sunscreen") {
    capabilities.push({
      capability_code: "sun_protection",
      status: "verified",
      confidence: 90,
      assessment_note: "Beauty OS deterministic v0.1: source-backed sunscreen taxonomy.",
      reviewed_at: input.reviewedAt,
      evidence: [{
        evidence_type: "manual_curation",
        direction: "supports",
        evidence_note: "Deterministic policy: an externally evidenced sunscreen product type supports the sun_protection capability.",
        source_locator: typeEvidence.url,
        confidence: 90,
        review_status: "verified",
      }],
    });
  }

  const hydrationFact = typeEvidence && HYDRATION_PRODUCT_TYPES.has(input.productType)
    ? reliableHydrationFact(input.research)
    : null;
  if (typeEvidence && hydrationFact) {
    capabilities.push({
      capability_code: "hydration",
      status: "verified",
      confidence: 85,
      assessment_note: "Beauty OS deterministic v0.1: hydration requires both a source-backed hydrating product taxonomy and an independent source-backed usage or product-description fact.",
      reviewed_at: input.reviewedAt,
      evidence: [
        {
          evidence_type: "manual_curation",
          direction: "supports",
          evidence_note: `Deterministic policy input: normalized product type ${input.productType}.`,
          source_locator: typeEvidence.url,
          confidence: 90,
          review_status: "verified",
        },
        {
          evidence_type: "official_product_description",
          direction: "supports",
          evidence_note: hydrationFact.note,
          source_locator: hydrationFact.url,
          confidence: 85,
          review_status: "verified",
        },
      ],
    });
  }

  return {
    schema_version: "product-knowledge-curation/v0.1",
    catalog_product_id: input.catalogProductId,
    roles,
    capabilities,
  };
}

function reliableTypeEvidence(
  research: ProductResearchDraft["research_payload"],
  expectedType: ProductType,
) {
  const productType = research.product_type;
  if (
    productType.value !== expectedType
    || productType.basis !== "external_evidence"
    || (productType.confidence ?? 0) < 80
    || research.field_confidence.product_type.has_conflict
  ) return null;
  return firstOfficialSource(research, productType.evidence_refs);
}

function reliableHydrationFact(research: ProductResearchDraft["research_payload"]) {
  const claim = research.claims.find((item) =>
    (item.confidence ?? 0) >= 80
    && HYDRATION_TERMS.test(`${item.normalized_claim ?? ""} ${item.raw_text}`)
    && firstOfficialSource(research, item.evidence_refs),
  );
  if (claim) {
    const source = firstOfficialSource(research, claim.evidence_refs)!;
    return { note: `Source-backed product description: ${claim.raw_text}`, url: source.url };
  }

  if (
    (research.usage.confidence ?? 0) >= 80
    && HYDRATION_TERMS.test(research.usage.instructions.join(" "))
  ) {
    const source = firstOfficialSource(research, research.usage.evidence_refs);
    if (source) return {
      note: `Source-backed usage instruction: ${research.usage.instructions.join(" ")}`,
      url: source.url,
    };
  }
  return null;
}

function firstOfficialSource(
  research: ProductResearchDraft["research_payload"],
  references: readonly string[],
) {
  return research.sources.find((source) =>
    references.includes(source.source_id) && OFFICIAL_SOURCE.test(source.source_type),
  ) ?? null;
}
