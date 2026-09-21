import { z } from "zod";

import {
  CAPABILITY_EVIDENCE_DIRECTIONS,
  CAPABILITY_EVIDENCE_REVIEW_STATUSES,
  CAPABILITY_EVIDENCE_TYPES,
  CARE_ROLE_ASSIGNMENT_KINDS,
  PRODUCT_KNOWLEDGE_ASSESSMENT_STATUSES,
} from "@/schemas/product-knowledge";

export const PRODUCT_KNOWLEDGE_CURATION_SCHEMA_VERSION =
  "product-knowledge-curation/v0.1" as const;

export const PRODUCT_KNOWLEDGE_CARE_ROLE_CODES = [
  "remover",
  "cleanser",
  "hydration",
  "treatment",
  "moisturizer",
  "sunscreen",
] as const;

export const PRODUCT_KNOWLEDGE_CAPABILITY_CODES = [
  "hydration",
  "barrier_support",
  "soothing",
  "oil_balance",
  "sun_protection",
] as const;

const nullableConfidenceSchema = z
  .number()
  .int()
  .min(0)
  .max(100)
  .nullable()
  .default(null);

const nullableTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .nullable()
  .default(null);

const nullableTimestampSchema = z
  .iso
  .datetime({ offset: true })
  .nullable()
  .default(null);

export const roleAssignmentInputSchema = z
  .object({
    care_role_code: z.enum(PRODUCT_KNOWLEDGE_CARE_ROLE_CODES),
    assignment_kind: z.enum(CARE_ROLE_ASSIGNMENT_KINDS),
    status: z.enum(PRODUCT_KNOWLEDGE_ASSESSMENT_STATUSES),
    confidence: nullableConfidenceSchema,
    assessment_note: nullableTextSchema,
    source_locator: nullableTextSchema,
    reviewed_at: nullableTimestampSchema,
  })
  .strict()
  .superRefine((assignment, context) => {
    if (assignment.status === "verified" && assignment.confidence === null) {
      context.addIssue({
        code: "custom",
        message: "verified role 必须提供 confidence。",
        path: ["confidence"],
      });
    }
  });

export const capabilityEvidenceInputSchema = z
  .object({
    evidence_type: z.enum(CAPABILITY_EVIDENCE_TYPES),
    direction: z.enum(CAPABILITY_EVIDENCE_DIRECTIONS),
    evidence_note: z.string().trim().min(1).max(2000),
    source_locator: nullableTextSchema,
    confidence: nullableConfidenceSchema,
    review_status: z.enum(CAPABILITY_EVIDENCE_REVIEW_STATUSES),
  })
  .strict();

export const capabilityAssessmentInputSchema = z
  .object({
    capability_code: z.enum(PRODUCT_KNOWLEDGE_CAPABILITY_CODES),
    status: z.enum(PRODUCT_KNOWLEDGE_ASSESSMENT_STATUSES),
    confidence: nullableConfidenceSchema,
    assessment_note: nullableTextSchema,
    reviewed_at: nullableTimestampSchema,
    evidence: z.array(capabilityEvidenceInputSchema).default([]),
  })
  .strict()
  .superRefine((assessment, context) => {
    if (assessment.status === "verified" && assessment.confidence === null) {
      context.addIssue({
        code: "custom",
        message: "verified capability 必须提供 confidence。",
        path: ["confidence"],
      });
    }
  });

export const productKnowledgeCurationInputSchema = z
  .object({
    schema_version: z.literal(PRODUCT_KNOWLEDGE_CURATION_SCHEMA_VERSION),
    catalog_product_id: z.uuid(),
    roles: z.array(roleAssignmentInputSchema).default([]),
    capabilities: z.array(capabilityAssessmentInputSchema).default([]),
  })
  .strict()
  .superRefine((input, context) => {
    const seenRoleCodes = new Set<string>();
    input.roles.forEach((role, index) => {
      if (seenRoleCodes.has(role.care_role_code)) {
        context.addIssue({
          code: "custom",
          message: "同一录入文件不能重复声明 care role。",
          path: ["roles", index, "care_role_code"],
        });
      }
      seenRoleCodes.add(role.care_role_code);
    });

    const seenCapabilityCodes = new Set<string>();
    input.capabilities.forEach((capability, index) => {
      if (seenCapabilityCodes.has(capability.capability_code)) {
        context.addIssue({
          code: "custom",
          message: "同一录入文件不能重复声明 capability。",
          path: ["capabilities", index, "capability_code"],
        });
      }
      seenCapabilityCodes.add(capability.capability_code);
    });
  });

export type ProductKnowledgeCurationInput = z.infer<
  typeof productKnowledgeCurationInputSchema
>;
export type RoleAssignmentInput = z.infer<typeof roleAssignmentInputSchema>;
export type CapabilityAssessmentInput = z.infer<
  typeof capabilityAssessmentInputSchema
>;
export type CapabilityEvidenceInput = z.infer<
  typeof capabilityEvidenceInputSchema
>;
