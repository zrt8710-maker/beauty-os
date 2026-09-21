import { z } from "zod";

import {
  PRODUCT_CATEGORIES,
  PRODUCT_SUBCATEGORIES,
  PRODUCT_TYPES,
} from "@/schemas/product";

export const PRODUCT_KNOWLEDGE_ASSESSMENT_STATUSES = [
  "verified",
  "candidate",
  "unknown",
] as const;

export const CARE_ROLE_ASSIGNMENT_KINDS = [
  "primary",
  "secondary",
] as const;

export const CAPABILITY_EVIDENCE_TYPES = [
  "official_product_description",
  "manual_curation",
  "external_dataset",
] as const;

export const CAPABILITY_EVIDENCE_DIRECTIONS = [
  "supports",
  "contradicts",
] as const;

export const CAPABILITY_EVIDENCE_REVIEW_STATUSES = [
  "verified",
  "candidate",
  "rejected",
] as const;

const assessmentStatusSchema = z.enum(
  PRODUCT_KNOWLEDGE_ASSESSMENT_STATUSES,
);

const taxonomySchema = z.object({
  display_name: z.string().min(1),
  definition: z.string().min(1),
  definition_version: z.number().int().positive(),
});

export const productKnowledgeIdentitySchema = z.object({
  catalog_product_id: z.uuid(),
  brand_name: z.string().min(1),
  product_name: z.string().min(1),
  variant_name: z.string().min(1).nullable(),
  barcode: z.string().min(1).nullable(),
  category: z.enum(PRODUCT_CATEGORIES),
  subcategory: z.enum(PRODUCT_SUBCATEGORIES),
  product_type: z.enum(PRODUCT_TYPES),
  primary_source_id: z.uuid(),
  identity_confidence: z.number().int().min(0).max(100),
  catalog_status: z.literal("verified"),
  created_at: z.string(),
  updated_at: z.string(),
});

export const productKnowledgeCareRoleSchema = taxonomySchema.extend({
  assignment_id: z.uuid(),
  care_role_code: z.string().min(1),
  assignment_kind: z.enum(CARE_ROLE_ASSIGNMENT_KINDS),
  status: assessmentStatusSchema,
  confidence: z.number().int().min(0).max(100).nullable(),
  assessment_note: z.string().min(1).nullable(),
  source_locator: z.string().min(1).nullable(),
  reviewed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const productCapabilityEvidenceSchema = z.object({
  evidence_id: z.uuid(),
  evidence_type: z.enum(CAPABILITY_EVIDENCE_TYPES),
  direction: z.enum(CAPABILITY_EVIDENCE_DIRECTIONS),
  evidence_note: z.string().min(1),
  source_locator: z.string().min(1).nullable(),
  confidence: z.number().int().min(0).max(100).nullable(),
  review_status: z.enum(CAPABILITY_EVIDENCE_REVIEW_STATUSES),
  created_at: z.string(),
});

export const productKnowledgeCapabilitySchema = taxonomySchema.extend({
  product_capability_id: z.uuid(),
  capability_code: z.string().min(1),
  status: assessmentStatusSchema,
  confidence: z.number().int().min(0).max(100).nullable(),
  assessment_note: z.string().min(1).nullable(),
  reviewed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  evidence_summary: z.object({
    total: z.number().int().nonnegative(),
    by_direction: z.object({
      supports: z.number().int().nonnegative(),
      contradicts: z.number().int().nonnegative(),
    }),
    by_review_status: z.object({
      verified: z.number().int().nonnegative(),
      candidate: z.number().int().nonnegative(),
      rejected: z.number().int().nonnegative(),
    }),
  }),
  evidence: z.array(productCapabilityEvidenceSchema),
});

export const productKnowledgeSnapshotSchema = z.object({
  identity: productKnowledgeIdentitySchema,
  care_roles: z.array(productKnowledgeCareRoleSchema),
  capabilities: z.array(productKnowledgeCapabilitySchema),
});

export type ProductKnowledgeSnapshot = z.infer<
  typeof productKnowledgeSnapshotSchema
>;
export type ProductKnowledgeCareRole = z.infer<
  typeof productKnowledgeCareRoleSchema
>;
export type ProductKnowledgeCapability = z.infer<
  typeof productKnowledgeCapabilitySchema
>;
export type ProductCapabilityEvidence = z.infer<
  typeof productCapabilityEvidenceSchema
>;
