import type { DailyCareRole } from "@/server/domain/daily-care-needs";

export const CAPABILITY_GAP_REASONS = [
  "NO_OWNED_PRODUCT",
  "ALL_PRODUCTS_UNAVAILABLE",
  "ALL_PRODUCTS_SAFETY_EXCLUDED",
  "INGREDIENT_DATA_UNKNOWN",
] as const;

export type CapabilityGapReason =
  (typeof CAPABILITY_GAP_REASONS)[number];

export type CapabilityRoleProduct = {
  ownedProductId: string;
  role: DailyCareRole;
};

export type CapabilitySelectedProduct = CapabilityRoleProduct;

export type CapabilityExcludedProduct = CapabilityRoleProduct & {
  reason: string;
};

export type CapabilityUnknownProduct = CapabilityRoleProduct & {
  reason: "INGREDIENT_DATA_UNKNOWN";
};

export type CapabilityGapsInput = {
  requiredRoles: DailyCareRole[];
  selectedProducts: CapabilitySelectedProduct[];
  excludedProducts: CapabilityExcludedProduct[];
  unknownProducts: CapabilityUnknownProduct[];
};

export type CapabilityGap = {
  role: DailyCareRole;
  reason: CapabilityGapReason;
  ownedProductIds: string[];
  message: string;
};
