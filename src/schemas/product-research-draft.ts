import { z } from "zod";

import { PRODUCT_TYPES } from "@/schemas/product";
import {
  PRODUCT_KNOWLEDGE_CAPABILITY_CODES,
  PRODUCT_KNOWLEDGE_CARE_ROLE_CODES,
} from "@/schemas/product-knowledge-curation";

export const PRODUCT_RESEARCH_DRAFT_STATUSES = [
  "draft",
  "review_pending",
  "approved",
  "rejected",
  "superseded",
] as const;

export const PRODUCT_RESEARCH_DRAFT_CREATED_BY = ["ai", "admin", "system"] as const;

const confidenceSchema = z.number().int().min(0).max(100).nullable();
const evidenceRefsSchema = z.array(z.string().trim().min(1).max(200)).max(100);
const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();

export const productResearchSourceSchema = z.object({
  source_id: z.string().trim().min(1).max(200),
  url: z.url().max(2000).nullable(),
  title: z.string().trim().min(1).max(500),
  source_type: z.string().trim().min(1).max(80),
  authority_tier: z.number().int().min(1).max(7).nullable(),
  retrieved_at: z.iso.datetime({ offset: true }),
}).strict();

const uncertaintySchema = z.object({
  field: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000),
  evidence_refs: evidenceRefsSchema,
}).strict();

const conflictSchema = z.object({
  field: z.string().trim().min(1).max(120),
  values: z.array(z.string().trim().min(1).max(50_000)).min(2).max(20),
  severity: z.enum(["blocking", "review_required", "informational"]),
  evidence_refs: evidenceRefsSchema.min(2),
}).strict();

const ingredientItemSchema = z.object({
  raw_name: z.string().trim().min(1).max(500),
  normalized_name: nullableText(200),
  ingredient_order: z.number().int().min(1).max(500).nullable(),
  confidence: confidenceSchema,
  evidence_refs: evidenceRefsSchema,
}).strict();

const claimSchema = z.object({
  raw_text: z.string().trim().min(1).max(5000),
  normalized_claim: nullableText(500),
  confidence: confidenceSchema,
  evidence_refs: evidenceRefsSchema,
}).strict();

const candidateBasisSchema = z.enum([
  "external_evidence",
  "ai_inference",
  "unknown",
]);

export const PRODUCT_RESEARCH_CONFIDENCE_FIELDS = [
  "identity",
  "ingredients",
  "claims",
  "texture",
  "usage",
  "product_type",
  "care_role",
  "capability",
  "risk",
] as const;

const confidenceExplanationSchema = z.object({
  score: z.number().int().min(0).max(100),
  evidence_refs: evidenceRefsSchema,
  reasons: z.array(z.string().trim().min(1).max(500)).max(20),
  has_conflict: z.boolean(),
  includes_ai_inference: z.boolean(),
}).strict();

const candidateSchema = z.object({
  code: z.string().trim().min(1).max(120),
  confidence: confidenceSchema,
  basis: candidateBasisSchema,
  evidence_refs: evidenceRefsSchema,
}).strict();

export const productResearchPayloadSchema = z.object({
  identity: z.object({
    brand_name: z.string().trim().min(1).max(120),
    product_name: z.string().trim().min(1).max(200),
    aliases: z.array(z.string().trim().min(1).max(200)).max(30),
    variant_name: nullableText(200),
    barcode: z.string().trim().min(8).max(32).nullable(),
    confidence: confidenceSchema,
    evidence_refs: evidenceRefsSchema,
    uncertainties: z.array(uncertaintySchema).max(50),
  }).strict(),
  ingredients: z.object({
    status: z.enum(["found", "partial", "conflicted", "unknown"]),
    raw_text: z.array(z.string().trim().min(1).max(50_000)).max(20),
    items: z.array(ingredientItemSchema).max(500),
    conflicts: z.array(conflictSchema).max(100),
    confidence: confidenceSchema,
  }).strict(),
  claims: z.array(claimSchema).max(100),
  texture: z.object({
    value: z.string().trim().min(1).max(120),
    basis: candidateBasisSchema,
    confidence: confidenceSchema,
    evidence_refs: evidenceRefsSchema,
  }).strict().nullable(),
  usage: z.object({
    instructions: z.array(z.string().trim().min(1).max(2000)).max(50),
    am_pm: z.array(z.enum(["am", "pm"])).max(2),
    frequency: nullableText(500),
    routine_order: nullableText(500),
    leave_on: z.boolean().nullable(),
    rinse_off: z.boolean().nullable(),
    cautions: z.array(z.string().trim().min(1).max(2000)).max(50),
    confidence: confidenceSchema,
    evidence_refs: evidenceRefsSchema,
  }).strict(),
  product_type: z.object({
    value: z.enum(PRODUCT_TYPES).nullable(),
    confidence: confidenceSchema,
    basis: candidateBasisSchema,
    evidence_refs: evidenceRefsSchema,
  }).strict(),
  care_role_candidates: z.array(candidateSchema.extend({
    code: z.enum(PRODUCT_KNOWLEDGE_CARE_ROLE_CODES),
  })).max(20),
  capability_candidates: z.array(candidateSchema.extend({
    code: z.enum(PRODUCT_KNOWLEDGE_CAPABILITY_CODES),
  })).max(20),
  risk_cautions: z.array(z.object({
    code_or_label: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(2000),
    confidence: confidenceSchema,
    basis: candidateBasisSchema,
    evidence_refs: evidenceRefsSchema,
  }).strict()).max(100),
  field_confidence: z.object({
    identity: confidenceExplanationSchema,
    ingredients: confidenceExplanationSchema,
    claims: confidenceExplanationSchema,
    texture: confidenceExplanationSchema,
    usage: confidenceExplanationSchema,
    product_type: confidenceExplanationSchema,
    care_role: confidenceExplanationSchema,
    capability: confidenceExplanationSchema,
    risk: confidenceExplanationSchema,
  }).strict(),
  sources: z.array(productResearchSourceSchema).min(1).max(100),
  uncertainties: z.array(uncertaintySchema).max(100),
  conflicts: z.array(conflictSchema).max(100),
}).strict().superRefine((payload, context) => {
  if (payload.ingredients.status === "found" && payload.ingredients.items.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["ingredients", "items"],
      message: "ingredients.status 为 found 时必须提供至少一个 ingredient item。",
    });
  }
  const sourceIds = new Set<string>();
  payload.sources.forEach((source, index) => {
    if (sourceIds.has(source.source_id)) {
      context.addIssue({ code: "custom", path: ["sources", index, "source_id"], message: "source_id 必须在 payload 内唯一。" });
    }
    sourceIds.add(source.source_id);
  });

  const validateRefs = (refs: string[], path: Array<string | number>) => {
    refs.forEach((reference, index) => {
      if (!sourceIds.has(reference)) {
        context.addIssue({ code: "custom", path: [...path, index], message: "evidence_refs 必须指向 payload.sources 中的 source_id。" });
      }
    });
  };

  validateRefs(payload.identity.evidence_refs, ["identity", "evidence_refs"]);
  payload.identity.uncertainties.forEach((item, index) => validateRefs(item.evidence_refs, ["identity", "uncertainties", index, "evidence_refs"]));
  payload.ingredients.items.forEach((item, index) => validateRefs(item.evidence_refs, ["ingredients", "items", index, "evidence_refs"]));
  payload.ingredients.conflicts.forEach((item, index) => validateRefs(item.evidence_refs, ["ingredients", "conflicts", index, "evidence_refs"]));
  payload.claims.forEach((item, index) => validateRefs(item.evidence_refs, ["claims", index, "evidence_refs"]));
  if (payload.texture) validateRefs(payload.texture.evidence_refs, ["texture", "evidence_refs"]);
  validateRefs(payload.usage.evidence_refs, ["usage", "evidence_refs"]);
  validateRefs(payload.product_type.evidence_refs, ["product_type", "evidence_refs"]);
  payload.care_role_candidates.forEach((item, index) => validateRefs(item.evidence_refs, ["care_role_candidates", index, "evidence_refs"]));
  payload.capability_candidates.forEach((item, index) => validateRefs(item.evidence_refs, ["capability_candidates", index, "evidence_refs"]));
  payload.risk_cautions.forEach((item, index) => validateRefs(item.evidence_refs, ["risk_cautions", index, "evidence_refs"]));
  Object.entries(payload.field_confidence).forEach(([field, item]) => validateRefs(item.evidence_refs, ["field_confidence", field, "evidence_refs"]));
  payload.uncertainties.forEach((item, index) => validateRefs(item.evidence_refs, ["uncertainties", index, "evidence_refs"]));
  payload.conflicts.forEach((item, index) => validateRefs(item.evidence_refs, ["conflicts", index, "evidence_refs"]));
});

export const productResearchDraftCreateSchema = z.object({
  catalog_product_id: z.uuid(),
  research_version: z.number().int().positive(),
  research_payload: productResearchPayloadSchema,
  overall_confidence: confidenceSchema,
  created_by: z.enum(PRODUCT_RESEARCH_DRAFT_CREATED_BY),
  research_model: nullableText(200),
  research_run_id: nullableText(200),
}).strict();

export const productResearchDraftReviewUpdateSchema = z.object({
  status: z.enum(PRODUCT_RESEARCH_DRAFT_STATUSES),
  reviewed_by: z.uuid().nullable(),
  reviewed_at: z.iso.datetime({ offset: true }).nullable(),
}).strict();

export const productResearchDraftSchema = productResearchDraftCreateSchema.extend({
  id: z.uuid(),
  status: z.enum(PRODUCT_RESEARCH_DRAFT_STATUSES),
  reviewed_by: z.uuid().nullable(),
  reviewed_at: z.iso.datetime({ offset: true }).nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

export type ProductResearchDraft = z.infer<typeof productResearchDraftSchema>;
export type ProductResearchDraftCreate = z.infer<typeof productResearchDraftCreateSchema>;
export type ProductResearchDraftReviewUpdate = z.infer<typeof productResearchDraftReviewUpdateSchema>;
