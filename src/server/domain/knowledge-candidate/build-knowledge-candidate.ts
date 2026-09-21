import {
  KNOWLEDGE_CANDIDATE_SCHEMA_VERSION,
  knowledgeCandidateSchema,
  type KnowledgeCandidate,
  type KnowledgeCandidateWarning,
} from "@/schemas/knowledge-candidate";
import type { ExternalProductFact } from "@/schemas/external-product-fact";
import type { ProductCategory, ProductType } from "@/schemas/product";
import type { PRODUCT_KNOWLEDGE_CARE_ROLE_CODES } from "@/schemas/product-knowledge-curation";

type CandidateRole = (typeof PRODUCT_KNOWLEDGE_CARE_ROLE_CODES)[number];

type CategoryMapping = {
  category: ProductCategory;
  productType: ProductType;
  confidence: number;
};

const CATEGORY_TAG_MAPPINGS: Readonly<Record<string, CategoryMapping>> = {
  moisturizer: skincareMapping("moisturizer"),
  moisturizers: skincareMapping("moisturizer"),
  moisturiser: skincareMapping("moisturizer"),
  moisturisers: skincareMapping("moisturizer"),
  "moisturizing-creams": skincareMapping("moisturizer"),
  "moisturising-creams": skincareMapping("moisturizer"),
  cleanser: skincareMapping("cleanser"),
  cleansers: skincareMapping("cleanser"),
  "face-cleansers": skincareMapping("cleanser"),
  "facial-cleansers": skincareMapping("cleanser"),
};

const ROLE_BY_PRODUCT_TYPE: Partial<Record<ProductType, CandidateRole>> = {
  cleanser: "cleanser",
  moisturizer: "moisturizer",
};

export function buildKnowledgeCandidate(
  fact: ExternalProductFact,
  options: { factFileName: string },
): KnowledgeCandidate {
  const warnings: KnowledgeCandidateWarning[] = fact.warnings.map((warning) => ({
    code: warning.code,
    message: warning.message,
    fields: warning.fields,
  }));
  const classification = classify(fact.label.categories_tags, warnings);
  const role = classification.product_type === null
    ? null
    : ROLE_BY_PRODUCT_TYPE[classification.product_type] ?? null;

  if (role === null && classification.product_type !== null) {
    warnings.push({
      code: "KNOWLEDGE_CANDIDATE_ROLE_UNMAPPED",
      message: "已识别 product_type，但 v0.1 没有对应的确定性 role 映射。",
      fields: ["decision_candidate.primary_role"],
    });
  }

  return knowledgeCandidateSchema.parse({
    schema_version: KNOWLEDGE_CANDIDATE_SCHEMA_VERSION,
    candidate_id: `knowledge-candidate:${fact.fact_id}`,
    input_fact: {
      file_name: options.factFileName,
      fact_id: fact.fact_id,
      schema_version: fact.schema_version,
      ingredients_text_reference: {
        json_path: "$.label.ingredients_text",
        present: fact.label.ingredients_text !== null,
      },
    },
    identity_candidate: {
      brand_name: fact.identity.brand_name,
      product_name: fact.identity.product_name,
      variant_name: fact.identity.variant_name,
      barcode: fact.identity.barcode,
    },
    classification_candidate: {
      category: classification.category,
      product_type: classification.product_type,
      mapping_source: classification.mapping_source,
      matched_external_value: classification.matched_external_value,
      confidence: classification.confidence,
    },
    decision_candidate: {
      primary_role: {
        value: role,
        source: role === null ? "unmapped" : "product_type_mapping",
        confidence: role === null ? null : classification.confidence,
      },
      capabilities: [],
    },
    warnings: deduplicateWarnings(warnings),
  });
}

function classify(
  tags: string[],
  warnings: KnowledgeCandidateWarning[],
): {
  category: ProductCategory | null;
  product_type: ProductType | null;
  mapping_source: "external_category_tag" | "unmapped" | "conflict";
  matched_external_value: string | null;
  confidence: number | null;
} {
  const matches = tags.flatMap((tag) => {
    const mapping = CATEGORY_TAG_MAPPINGS[normalizeExternalTag(tag)];
    return mapping ? [{ tag, mapping }] : [];
  });
  const productTypes = [...new Set(matches.map((match) =>
    match.mapping.productType))];

  if (productTypes.length === 0) {
    warnings.push({
      code: "KNOWLEDGE_CANDIDATE_CLASSIFICATION_UNMAPPED",
      message: "外部 category 没有命中 v0.1 确定性映射。",
      fields: ["classification_candidate"],
    });
    return {
      category: null,
      product_type: null,
      mapping_source: "unmapped",
      matched_external_value: null,
      confidence: null,
    };
  }

  if (productTypes.length > 1) {
    warnings.push({
      code: "KNOWLEDGE_CANDIDATE_CLASSIFICATION_CONFLICT",
      message: "外部 categories 同时命中多个 product_type，必须人工确认。",
      fields: ["classification_candidate"],
    });
    return {
      category: null,
      product_type: null,
      mapping_source: "conflict",
      matched_external_value: null,
      confidence: null,
    };
  }

  const selected = matches
    .filter((match) => match.mapping.productType === productTypes[0])
    .sort((left, right) => left.tag.localeCompare(right.tag))[0]!;
  return {
    category: selected.mapping.category,
    product_type: selected.mapping.productType,
    mapping_source: "external_category_tag",
    matched_external_value: selected.tag,
    confidence: selected.mapping.confidence,
  };
}

function normalizeExternalTag(value: string) {
  return value
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/^[a-z]{2}:/, "")
    .replace(/[\s_]+/g, "-");
}

function skincareMapping(productType: ProductType): CategoryMapping {
  return { category: "skincare", productType, confidence: 85 };
}

function deduplicateWarnings(warnings: KnowledgeCandidateWarning[]) {
  const unique = new Map<string, KnowledgeCandidateWarning>();
  warnings.forEach((warning) => {
    unique.set(`${warning.code}:${warning.fields.join(",")}`, warning);
  });
  return [...unique.values()];
}
