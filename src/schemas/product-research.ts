import { z } from "zod";

import { PRODUCT_TYPES } from "@/schemas/product";
import { productResearchPayloadSchema } from "@/schemas/product-research-draft";
import { productSearchResultSchema } from "@/schemas/product-search";

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();

const consumerChineseText = (max: number) => z.string().trim().min(1).max(max).refine(
  (value) => /[\u3400-\u9fff]/u.test(value),
  "Consumer-facing structured knowledge must be written in Simplified Chinese.",
);
const nullableConsumerChineseText = (max: number) => consumerChineseText(max).nullable();

/**
 * Agent-Plan occasionally serializes a numeric source tier as a JSON string.
 * This is the sole string-to-number normalization at the Agent3 transport
 * boundary: only one-digit, in-range integer strings are accepted.
 */
const agent3AuthorityTierSchema = z.preprocess(
  (value) => typeof value === "string" && /^[1-7]$/.test(value) ? Number(value) : value,
  z.number().int().min(1).max(7).nullable(),
);

/** Agent3 researches a confirmed Catalog identity, never an owned product. */
export const productResearchInputSchema = z.object({
  catalog_product_id: z.uuid(),
  brand_name: z.string().trim().min(1).max(120),
  product_name: z.string().trim().min(1).max(200),
  variant_name: nullableText(200),
  barcode: z.string().trim().min(8).max(32).nullable(),
  aliases: z.array(z.string().trim().min(1).max(200)).max(30),
  identity_sources: z.array(z.object({
    url: z.url().max(2000),
    title: nullableText(500),
    source_type: nullableText(80),
  }).strict()).max(30),
  /** Application-provided leads from SearchInfinity; not verified evidence. */
  search_results: z.array(productSearchResultSchema).max(10).default([]),
  /**
   * Server-derived gaps from a prior provisional snapshot. This is a search
   * focus, never a product fact and is not accepted from a consumer client.
   */
  enrichment_focus: z.array(z.enum([
    "product_type",
    "ingredients",
    "claims",
    "texture",
    "usage",
    "cautions",
    "reliable_sources",
  ])).max(7).optional(),
  research_mode: z.enum(["broad", "gap_targeted"]).optional(),
}).strict();

export const productResearchProviderResultSchema = z.object({
  research_payload: productResearchPayloadSchema,
  overall_confidence: z.number().int().min(0).max(100).nullable(),
  research_run_id: z.string().trim().min(1).max(200).nullable(),
}).strict();

/**
 * The transport contract returned by Agent3.  Its payload is deliberately
 * composed with Catalog-owned identity before it becomes a persisted draft.
 * This prevents an otherwise valid research result from being rejected merely
 * because the model omitted identity facts the application already knows.
 */
export const AGENT3_RESEARCH_SOURCE_TYPES = [
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
  "retailer",
  "aggregation",
  "third_party",
  "unknown",
] as const;

const agent3ResearchSourceSchema = z.object({
  source_id: z.string().trim().min(1).max(200),
  // The original prompt used `URL`; accept that explicit legacy spelling at
  // the transport boundary and normalize it in the deterministic adapter.
  url: z.url().max(2000).optional(),
  URL: z.url().max(2000).optional(),
  title: z.string().trim().min(1).max(500),
  source_type: z.enum(AGENT3_RESEARCH_SOURCE_TYPES),
  authority_tier: agent3AuthorityTierSchema,
  retrieved_at: z.iso.datetime({ offset: true }),
}).strict().superRefine((source, context) => {
  if (!source.url && !source.URL) {
    context.addIssue({
      code: "custom",
      path: ["url"],
      message: "Agent3 source 必须包含 url。",
    });
  }
  if (source.url && source.URL && source.url !== source.URL) {
    context.addIssue({
      code: "custom",
      path: ["URL"],
      message: "url 与 URL 同时提供时必须一致。",
    });
  }
});

/**
 * Agent3's evidence blocks are transport objects, not persisted draft
 * sections. Their exact envelope is validated here; section values are then
 * mapped explicitly by the draft adapter.
 */
const evidenceRefsSchema = z.array(z.string().trim().min(1).max(200)).max(100);
const evidenceReasonSchema = z.array(z.string().trim().min(1).max(500)).max(20);

function evidenceBlockSchema<T extends z.ZodType>(value: T) {
  return z.object({
    value: value.nullable(),
    evidence_refs: evidenceRefsSchema,
    confidence: z.number().finite(),
    reasons: evidenceReasonSchema,
    has_conflict: z.boolean(),
    includes_ai_inference: z.boolean(),
  }).strict();
}

const identityValueSchema = z.object({
  aliases: z.array(z.string().trim().min(1).max(200)).max(30),
}).strict();

const ingredientItemTransportSchema = z.union([
  z.string().trim().min(1).max(500),
  z.object({
    raw_name: z.string().trim().min(1).max(500).optional(),
    name: z.string().trim().min(1).max(500).optional(),
    normalized_name: nullableText(500).optional(),
    ingredient_order: z.number().int().positive().nullable().optional(),
    confidence: z.number().finite().nullable().optional(),
    evidence_refs: evidenceRefsSchema.optional(),
  }).strict().superRefine((item, context) => {
    if (!item.raw_name && !item.name) context.addIssue({ code: "custom", message: "Ingredient item requires raw_name." });
  }),
]);

const ingredientsValueSchema = z.object({
  status: z.enum(["found", "partial", "conflicted", "unknown"]),
  raw_text: z.union([
    z.string().trim().min(1).max(50_000),
    z.array(z.string().trim().min(1).max(50_000)).max(20),
  ]),
  items: z.array(ingredientItemTransportSchema).max(500),
  conflicts: z.array(z.unknown()).max(100).optional(),
}).strict();

const claimTransportSchema = z.union([
  // Historical transport compatibility: a bare claim has no separate raw /
  // normalized representation, so it may only be accepted when it is already
  // suitable for the Chinese consumer surface.
  consumerChineseText(2000),
  z.object({
    raw_text: z.string().trim().min(1).max(2000),
    normalized_claim: consumerChineseText(2000),
    confidence: z.number().finite().nullable().optional(),
    evidence_refs: evidenceRefsSchema.optional(),
  }).strict(),
]);

const usageValueSchema = z.union([
  // Proven historical Agent3 output; normalized by the deterministic composer.
  consumerChineseText(2000),
  z.object({
    instructions: z.array(consumerChineseText(2000)).max(50),
    am_pm: z.array(z.enum(["am", "pm"])).max(2),
    frequency: nullableConsumerChineseText(500),
    routine_order: nullableConsumerChineseText(500),
    leave_on: z.boolean().nullable(),
    rinse_off: z.boolean().nullable(),
    cautions: z.array(consumerChineseText(2000)).max(50),
  }).strict(),
]);

const candidateValueSchema = z.array(z.object({
  code: z.string().trim().min(1).max(120),
  confidence: z.number().finite(),
  evidence_refs: evidenceRefsSchema,
}).strict()).max(20);

const coreSectionSchemas = {
  identity: evidenceBlockSchema(identityValueSchema),
  ingredients: evidenceBlockSchema(ingredientsValueSchema),
  claims: evidenceBlockSchema(z.array(claimTransportSchema).max(100)),
  texture: evidenceBlockSchema(consumerChineseText(120)),
  usage: evidenceBlockSchema(usageValueSchema),
  product_type: evidenceBlockSchema(z.enum(PRODUCT_TYPES)),
} as const;

export type Agent3CoreSectionName = keyof typeof coreSectionSchemas;
export type Agent3IsolatedSectionName = Agent3CoreSectionName | "care_role_candidates" | "capability_candidates";

export function isolateAgent3ResearchSections(value: unknown): {
  value: unknown;
  malformedSections: Agent3IsolatedSectionName[];
} {
  if (!isRecord(value) || !isRecord(value.research_payload)) return { value, malformedSections: [] };
  const payload = { ...value.research_payload };
  const malformedSections: Agent3IsolatedSectionName[] = [];
  for (const name of Object.keys(coreSectionSchemas) as Agent3CoreSectionName[]) {
    const parsed = coreSectionSchemas[name].safeParse(payload[name]);
    if (parsed.success) {
      payload[name] = parsed.data;
      continue;
    }
    malformedSections.push(name);
    payload[name] = unknownEvidenceBlock(`Section contract mismatch: ${name}.`);
  }
  const optionalSchemas = {
    care_role_candidates: evidenceBlockSchema(candidateValueSchema),
    capability_candidates: evidenceBlockSchema(candidateValueSchema),
  } as const;
  for (const name of Object.keys(optionalSchemas) as Array<keyof typeof optionalSchemas>) {
    if (payload[name] === undefined) continue;
    const parsed = optionalSchemas[name].safeParse(payload[name]);
    if (parsed.success) payload[name] = parsed.data;
    else {
      malformedSections.push(name);
      delete payload[name];
    }
  }
  return { value: { ...value, research_payload: payload }, malformedSections };
}

const agent3ResearchPayloadSchema = z.object({
  identity: coreSectionSchemas.identity,
  ingredients: coreSectionSchemas.ingredients,
  claims: coreSectionSchemas.claims,
  // Optional for backwards-compatible parsing of existing immutable AI
  // snapshots. New Agent3 requests explicitly ask for this evidence block.
  // Historical Agent3 payloads could omit texture entirely. Normalize that
  // absence to the canonical unknown block; malformed present values are
  // isolated earlier and remain observable as a section warning.
  texture: coreSectionSchemas.texture.optional().default(unknownEvidenceBlock("Texture was not researched.")),
  usage: coreSectionSchemas.usage,
  product_type: coreSectionSchemas.product_type,
  // These are source-referenced research hypotheses only. The deterministic
  // runtime never treats them as Product Knowledge roles or capabilities.
  care_role_candidates: evidenceBlockSchema(candidateValueSchema).optional(),
  capability_candidates: evidenceBlockSchema(candidateValueSchema).optional(),
  uncertainties: z.array(z.unknown()).max(100).optional(),
  conflicts: z.array(z.unknown()).max(100).optional(),
}).strict();

/** The AI transport contract. It intentionally differs from persisted drafts. */
export const agent3ResearchResultSchema = z.object({
  research_payload: agent3ResearchPayloadSchema,
  // Sources are transport-level provenance. The adapter explicitly stores
  // them in research_payload.sources after Catalog identity composition.
  sources: z.array(agent3ResearchSourceSchema).min(1).max(100),
  overall_confidence: z.number().finite().nullable(),
  research_run_id: z.string().trim().min(1).max(200).nullable(),
}).strict();

/**
 * Callers that predate application-controlled search leads may omit them.
 * The runtime schema supplies the empty array before Agent3 receives input.
 */
export type ProductResearchInput = Omit<z.infer<typeof productResearchInputSchema>, "search_results"> & {
  search_results?: z.infer<typeof productSearchResultSchema>[];
};
export type ProductResearchProviderResult = z.infer<typeof productResearchProviderResultSchema>;
export type Agent3ResearchResult = z.infer<typeof agent3ResearchResultSchema>;

function unknownEvidenceBlock(reason: string) {
  return {
    value: null,
    evidence_refs: [],
    confidence: 0,
    reasons: [reason],
    has_conflict: false,
    includes_ai_inference: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
