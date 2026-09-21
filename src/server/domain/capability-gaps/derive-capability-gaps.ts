import type {
  CapabilityExcludedProduct,
  CapabilityGap,
  CapabilityGapReason,
  CapabilityGapsInput,
  CapabilityRoleProduct,
} from "./types";

const SAFETY_EXCLUSION_REASONS = new Set([
  "AVOID_INGREDIENT_MATCH",
  "RECENT_HIGH_REACTION_HARD_BLOCK",
]);

const INTENTIONAL_OMISSION_REASONS = new Set([
  "HIGH_SENSITIVITY_REDUCE_ACTIVE",
  "DUPLICATE_ROLE_REMOVED",
  "OPTIONAL_SLOT_REPLACED",
  "STEP_LIMIT_REMOVED",
]);

export function deriveCapabilityGaps(
  input: CapabilityGapsInput,
): CapabilityGap[] {
  const gaps: CapabilityGap[] = [];
  const requiredRoles = [...new Set(input.requiredRoles)];

  for (const role of requiredRoles) {
    const selected = input.selectedProducts.filter(
      (product) => product.role === role,
    );
    const unknown = input.unknownProducts.filter(
      (product) => product.role === role,
    );
    const unknownIds = new Set(
      unknown.map((product) => product.ownedProductId),
    );

    if (selected.some((product) => !unknownIds.has(product.ownedProductId))) {
      continue;
    }

    if (selected.length > 0) {
      gaps.push(gap(
        role,
        "INGREDIENT_DATA_UNKNOWN",
        selected,
        "该角色已有产品被选中，但成分资料尚不足以确认安全覆盖。",
      ));
      continue;
    }

    const excluded = input.excludedProducts.filter(
      (product) => product.role === role,
    );
    if (excluded.some((product) =>
      INTENTIONAL_OMISSION_REASONS.has(product.reason))) {
      continue;
    }

    const excludedIds = new Set(
      excluded.map((product) => product.ownedProductId),
    );
    const unresolvedUnknown = unknown.filter(
      (product) => !excludedIds.has(product.ownedProductId),
    );
    if (unresolvedUnknown.length > 0) {
      gaps.push(gap(
        role,
        "INGREDIENT_DATA_UNKNOWN",
        unresolvedUnknown,
        "该角色存在已有产品，但成分资料不足，覆盖状态暂不能确认。",
      ));
      continue;
    }

    if (excluded.length === 0) {
      gaps.push(gap(
        role,
        "NO_OWNED_PRODUCT",
        [],
        "当前资产中没有可识别为该护理角色的产品。",
      ));
      continue;
    }

    const allSafetyExcluded = excluded.every((product) =>
      SAFETY_EXCLUSION_REASONS.has(product.reason));
    gaps.push(gap(
      role,
      allSafetyExcluded
        ? "ALL_PRODUCTS_SAFETY_EXCLUDED"
        : "ALL_PRODUCTS_UNAVAILABLE",
      excluded,
      allSafetyExcluded
        ? "该角色的已有产品均因安全规则未进入今日候选池。"
        : "该角色存在已有产品，但今天均不可使用。",
    ));
  }

  return gaps;
}

function gap(
  role: CapabilityGap["role"],
  reason: CapabilityGapReason,
  products: CapabilityRoleProduct[] | CapabilityExcludedProduct[],
  message: string,
): CapabilityGap {
  return {
    role,
    reason,
    ownedProductIds: [...new Set(
      products.map((product) => product.ownedProductId),
    )].sort(),
    message,
  };
}
