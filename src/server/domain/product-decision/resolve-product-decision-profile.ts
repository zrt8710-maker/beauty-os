import type { ProductType } from "@/schemas/product";

import {
  PRODUCT_DECISION_CAPABILITIES,
  PRODUCT_DECISION_ROLES,
  type ProductDecisionCapability,
  type ProductDecisionCapabilityCode,
  type ProductDecisionPeriod,
  type ProductDecisionProduct,
  type ProductDecisionProfile,
  type ProductDecisionRole,
  type ProductDecisionSafetySignals,
} from "./types";

const fallbackRoleByProductType: Partial<
  Record<ProductType, ProductDecisionRole>
> = {
  makeup_remover: "remover",
  cleanser: "cleanser",
  toner: "hydration",
  essence: "hydration",
  serum: "treatment",
  treatment: "treatment",
  mask: "treatment",
  moisturizer: "moisturizer",
  face_oil: "moisturizer",
  sunscreen: "sunscreen",
};

const periodsByRole: Record<
  ProductDecisionRole,
  ProductDecisionPeriod[]
> = {
  remover: ["pm"],
  cleanser: ["am", "pm"],
  hydration: ["am", "pm"],
  treatment: ["am", "pm"],
  moisturizer: ["am", "pm"],
  sunscreen: ["am"],
};

export function resolveProductDecisionProfile({
  product,
  knowledge,
  safetySignals,
}: {
  product: ProductDecisionProduct;
  knowledge: { care_roles: Array<{ care_role_code: string; assignment_kind: string; status: string; confidence: number | null }>; capabilities: Array<{ capability_code: string; status: string; confidence: number | null }> } | null;
  safetySignals?: ProductDecisionSafetySignals;
}): ProductDecisionProfile {
  const fallbackRole = fallbackRoleByProductType[product.product_type] ?? null;
  const verifiedPrimaryRoles = (knowledge?.care_roles ?? [])
    .filter((role) =>
      role.assignment_kind === "primary"
      && role.status === "verified"
      && role.confidence !== null
      && isDecisionRole(role.care_role_code))
    .sort((left, right) =>
      (right.confidence ?? 0) - (left.confidence ?? 0)
      || left.care_role_code.localeCompare(right.care_role_code));
  const verifiedPrimary = verifiedPrimaryRoles[0];
  const primaryRole = verifiedPrimary
    ? verifiedPrimary.care_role_code as ProductDecisionRole
    : fallbackRole;
  const verifiedSecondaryRoles = uniqueSorted(
    (knowledge?.care_roles ?? []).flatMap((role) =>
      role.assignment_kind === "secondary"
        && role.status === "verified"
        && role.confidence !== null
        && isDecisionRole(role.care_role_code)
        && role.care_role_code !== primaryRole
        ? [role.care_role_code]
        : []),
  );
  const capabilities = resolvedCapabilities(knowledge);
  const usedKnowledgeConfidence = [
    ...(verifiedPrimary?.confidence !== null
      && verifiedPrimary?.confidence !== undefined
      ? [verifiedPrimary.confidence]
      : []),
    ...(knowledge?.care_roles ?? []).flatMap((role) =>
      role.assignment_kind === "secondary"
        && role.status === "verified"
        && role.confidence !== null
        && isDecisionRole(role.care_role_code)
        ? [role.confidence]
        : []),
    ...capabilities.map((capability) => capability.confidence),
  ];

  return {
    product_id: product.id,
    catalog_product_id: product.catalog_product_id,
    primary_role: primaryRole,
    primary_role_source: verifiedPrimary
      ? "verified_knowledge"
      : "product_type_fallback",
    secondary_roles: verifiedSecondaryRoles,
    capabilities,
    period_eligibility: periodsFor([
      ...(primaryRole ? [primaryRole] : []),
      ...verifiedSecondaryRoles,
    ]),
    caution_codes: uniqueSorted(safetySignals?.cautionCodes ?? []),
    knowledge_status: knowledgeStatus(knowledge, usedKnowledgeConfidence),
    confidence: usedKnowledgeConfidence.length > 0
      ? Math.min(...usedKnowledgeConfidence)
      : null,
  };
}

function resolvedCapabilities(
  knowledge: { capabilities: Array<{ capability_code: string; status: string; confidence: number | null }> } | null,
): ProductDecisionCapability[] {
  return (knowledge?.capabilities ?? [])
    .flatMap((capability) =>
      capability.status === "verified"
        && capability.confidence !== null
        && isDecisionCapability(capability.capability_code)
        ? [{
            code: capability.capability_code,
            confidence: capability.confidence,
          }]
        : [])
    .sort((left, right) => left.code.localeCompare(right.code));
}

function knowledgeStatus(
  knowledge: { care_roles: Array<{ status: string }>; capabilities: Array<{ status: string }> } | null,
  usedKnowledgeConfidence: number[],
): ProductDecisionProfile["knowledge_status"] {
  if (usedKnowledgeConfidence.length > 0) return "verified";
  if (
    knowledge?.care_roles.some((role) => role.status === "candidate")
    || knowledge?.capabilities.some((capability) =>
      capability.status === "candidate")
  ) {
    return "candidate";
  }
  return "unknown";
}

function periodsFor(roles: ProductDecisionRole[]): ProductDecisionPeriod[] {
  const periods = new Set(
    roles.flatMap((role) => periodsByRole[role]),
  );
  return (["am", "pm"] as const).filter((period) => periods.has(period));
}

function isDecisionRole(value: string): value is ProductDecisionRole {
  return PRODUCT_DECISION_ROLES.some((role) => role === value);
}

function isDecisionCapability(
  value: string,
): value is ProductDecisionCapabilityCode {
  return PRODUCT_DECISION_CAPABILITIES.some((code) => code === value);
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
