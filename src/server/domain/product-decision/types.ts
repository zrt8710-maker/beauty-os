import type { ProductType } from "@/schemas/product";

export const PRODUCT_DECISION_ROLES = [
  "remover",
  "cleanser",
  "hydration",
  "treatment",
  "moisturizer",
  "sunscreen",
] as const;

export const PRODUCT_DECISION_CAPABILITIES = [
  "hydration",
  "barrier_support",
  "soothing",
  "oil_balance",
  "sun_protection",
] as const;

export const PRODUCT_DECISION_PERIODS = ["am", "pm"] as const;

export const PRODUCT_DECISION_CAUTION_CODES = [
  "AVOID_INGREDIENT_MATCH",
] as const;

export const PRODUCT_DECISION_KNOWLEDGE_STATUSES = [
  "verified",
  "candidate",
  "unknown",
] as const;

export type ProductDecisionRole =
  (typeof PRODUCT_DECISION_ROLES)[number];
export type ProductDecisionCapabilityCode =
  (typeof PRODUCT_DECISION_CAPABILITIES)[number];
export type ProductDecisionPeriod =
  (typeof PRODUCT_DECISION_PERIODS)[number];
export type ProductDecisionCautionCode =
  (typeof PRODUCT_DECISION_CAUTION_CODES)[number];
export type ProductDecisionKnowledgeStatus =
  (typeof PRODUCT_DECISION_KNOWLEDGE_STATUSES)[number];

export type ProductDecisionCapability = {
  code: ProductDecisionCapabilityCode;
  confidence: number;
};

export type ProductDecisionProfile = {
  product_id: string;
  catalog_product_id: string | null;
  primary_role: ProductDecisionRole | null;
  primary_role_source: "product_type_fallback" | "verified_knowledge";
  secondary_roles: ProductDecisionRole[];
  capabilities: ProductDecisionCapability[];
  period_eligibility: ProductDecisionPeriod[];
  caution_codes: ProductDecisionCautionCode[];
  knowledge_status: ProductDecisionKnowledgeStatus;
  confidence: number | null;
};

export type ProductDecisionProduct = {
  id: string;
  product_type: ProductType;
  catalog_product_id: string | null;
};

export type ProductDecisionSafetySignals = {
  /** Positive matches only. An empty list never means that the product is safe. */
  cautionCodes: ProductDecisionCautionCode[];
};
