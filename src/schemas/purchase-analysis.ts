import { z } from "zod";

import { PRODUCT_CATEGORIES, PRODUCT_TYPES, PRODUCT_TYPE_META } from "@/schemas/product";

export const PURCHASE_DECISIONS = ["consider_buy", "wait", "do_not_buy", "insufficient_data"] as const;
export const PURCHASE_REASON_CODES = [
  "EXACT_CATALOG_ALREADY_OWNED", "SAME_TYPE_SUBSTITUTE_AVAILABLE", "SIMILAR_ROLE_SUBSTITUTE_AVAILABLE",
  "REAL_ROLE_GAP", "ROLE_ALREADY_COVERED", "GOAL_ROLE_MATCH", "NO_GOAL_ROLE_MATCH",
  "AVOID_INGREDIENT_MATCH", "HIGH_REACTION_HISTORY", "POSITIVE_ROLE_USAGE_HISTORY",
  "LOW_ROLE_USAGE_HISTORY", "UNUSED_INVENTORY_PRESSURE", "MISSING_PROFILE", "MISSING_INGREDIENT_DATA",
  "LOW_CATALOG_CONFIDENCE", "NO_RELEVANT_USAGE_HISTORY", "MISSING_GOAL_EVIDENCE",
  "ROLE_FUNCTION_UNKNOWN",
] as const;

const manualCandidateSchema = z.object({
  brand_name: z.string().trim().min(1).max(120).nullable().default(null),
  product_name: z.string().trim().min(1).max(200),
  category: z.enum(PRODUCT_CATEGORIES),
  product_type: z.enum(PRODUCT_TYPES),
  ingredients: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
}).strict().superRefine((candidate, context) => {
  if (PRODUCT_TYPE_META[candidate.product_type].category !== candidate.category) {
    context.addIssue({ code: "custom", path: ["product_type"], message: "产品类型与大类不匹配。" });
  }
});

export const purchaseAnalysisCreateSchema = z.object({
  catalog_product_id: z.uuid().optional(),
  candidate_snapshot: manualCandidateSchema.optional(),
}).strict().refine((input) => Number(Boolean(input.catalog_product_id)) + Number(Boolean(input.candidate_snapshot)) === 1, {
  message: "catalog_product_id 与 candidate_snapshot 必须且只能提供一个。",
});

export const purchaseAnalysisListQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).strict();
export const purchaseAnalysisIdSchema = z.uuid();

const alternativeSchema = z.object({ owned_product_id: z.uuid(), product_name: z.string(), brand_name: z.string().nullable(), product_type: z.string(), status: z.string(), quantity_remaining_percent: z.number().int(), match: z.enum(["exact_catalog", "same_type", "same_role"]) });
export const purchaseEvidenceSchema = z.object({
  alternatives: z.array(alternativeSchema),
  gap: z.object({ role: z.string(), active_role_count: z.number().int(), message: z.string() }),
  compatibility: z.object({ matched_goals: z.array(z.string()), avoid_ingredient_matches: z.array(z.string()) }),
  usage: z.object({ recent_usage_count: z.number().int(), average_rating: z.number().nullable(), high_reaction_count: z.number().int() }),
  risks: z.array(z.string()),
});

const jsonObjectSchema = z.record(z.string(), z.unknown());
export const purchaseAnalysisSchema = z.object({
  id: z.uuid(),
  candidate_product_id: z.uuid().nullable(),
  candidate_snapshot: jsonObjectSchema,
  inventory_snapshot: jsonObjectSchema,
  goal_snapshot: jsonObjectSchema,
  duplicate_score: z.number().int().min(0).max(100),
  gap_score: z.number().int().min(0).max(100),
  compatibility_score: z.number().int().min(0).max(100),
  usage_probability_score: z.number().int().min(0).max(100),
  risk_score: z.number().int().min(0).max(100),
  final_score: z.number().int().min(0).max(100),
  decision: z.enum(PURCHASE_DECISIONS),
  evidence: purchaseEvidenceSchema,
  unknowns: z.array(z.string()),
  reason_codes: z.array(z.enum(PURCHASE_REASON_CODES)),
  created_at: z.iso.datetime(),
});

export type PurchaseAnalysisCreateInput = z.infer<typeof purchaseAnalysisCreateSchema>;
export type PurchaseAnalysis = z.infer<typeof purchaseAnalysisSchema>;
export type PurchaseEvidence = z.infer<typeof purchaseEvidenceSchema>;
export type PurchaseReasonCode = (typeof PURCHASE_REASON_CODES)[number];
