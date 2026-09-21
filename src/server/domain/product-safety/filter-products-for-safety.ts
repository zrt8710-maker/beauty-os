import type {
  ProductSafetyCandidate,
  ProductSafetyExclusion,
  ProductSafetyIngredient,
  ProductSafetyInput,
  ProductSafetyResult,
} from "./types";

const HIGH_REACTION_HARD_BLOCK_COUNT = 3;

export function filterProductsForSafety<
  TProduct extends ProductSafetyCandidate,
>(input: ProductSafetyInput<TProduct>): ProductSafetyResult<TProduct> {
  const eligibleProducts: TProduct[] = [];
  const excludedProducts: ProductSafetyExclusion<TProduct>[] = [];
  const unknownProducts: ProductSafetyResult<TProduct>["unknownProducts"] = [];
  const normalizedAvoidIngredients = normalizedAvoidMap(
    input.avoidIngredients,
  );

  for (const product of input.products) {
    const stateExclusion = productSafetyStateExclusion(product, input.routineDate, input.feedbackStats);
    if (stateExclusion) {
      excludedProducts.push(stateExclusion);
      continue;
    }

    if (!input.assessIngredients) {
      eligibleProducts.push(product);
      continue;
    }

    const catalogProductId = product.product.catalog_product_id;
    const ingredientData = catalogProductId
      ? input.ingredientDataByCatalogProductId.get(catalogProductId)
      : undefined;

    if (
      !catalogProductId
      || !ingredientData?.reliable
      || ingredientData.ingredients.length === 0
    ) {
      eligibleProducts.push(product);
      unknownProducts.push({
        product,
        productId: product.product_id,
        ownedProductId: product.id,
        reason: "INGREDIENT_DATA_UNKNOWN",
        message: "产品缺少可靠的已确认成分资料，当前未将其视为已验证安全。",
      });
      continue;
    }

    const matchedAvoidIngredients = findAvoidMatches(
      ingredientData.ingredients,
      normalizedAvoidIngredients,
    );
    if (matchedAvoidIngredients.length > 0) {
      excludedProducts.push({
        product,
        productId: product.product_id,
        ownedProductId: product.id,
        reason: "AVOID_INGREDIENT_MATCH",
        message: `命中用户避用成分：${matchedAvoidIngredients.join("、")}。`,
        matchedAvoidIngredients,
      });
      continue;
    }

    eligibleProducts.push(product);
  }

  return { eligibleProducts, excludedProducts, unknownProducts };
}

export function productAssetStateExclusion<TProduct extends ProductSafetyCandidate>(
  product: TProduct,
  routineDate: string,
): ProductSafetyExclusion<TProduct> | null {
  if (product.archived_at || product.status === "archived") {
    return exclusion(product, "PRODUCT_ARCHIVED", "产品已归档。");
  }
  if (product.status === "finished" || product.status === "discarded") {
    return exclusion(product, "PRODUCT_FINISHED", "产品已用完或已弃用。");
  }
  if (product.status !== "active" && product.status !== "unopened") {
    return exclusion(product, "PRODUCT_NOT_ACTIVE", "产品当前不是可使用状态。");
  }
  if (product.quantity_remaining_percent <= 0) {
    return exclusion(product, "PRODUCT_EMPTY", "产品剩余量为 0。");
  }
  if (product.expires_on && product.expires_on < routineDate) {
    return exclusion(product, "PRODUCT_EXPIRED", "产品已超过明确填写的到期日。");
  }
  return null;
}

export function productSafetyStateExclusion<TProduct extends ProductSafetyCandidate>(
  product: TProduct,
  routineDate: string,
  feedbackStats: ProductSafetyInput<TProduct>["feedbackStats"],
): ProductSafetyExclusion<TProduct> | null {
  const assetStateExclusion = productAssetStateExclusion(product, routineDate);
  if (assetStateExclusion) return assetStateExclusion;
  if (
    (feedbackStats.get(product.id)?.highReactionCount ?? 0)
      >= HIGH_REACTION_HARD_BLOCK_COUNT
  ) {
    return exclusion(
      product,
      "RECENT_HIGH_REACTION_HARD_BLOCK",
      "最近 30 天已记录至少 3 次高等级不适反应，暂不纳入方案。",
    );
  }
  return null;
}

function exclusion<TProduct extends ProductSafetyCandidate>(
  product: TProduct,
  reason: ProductSafetyExclusion<TProduct>["reason"],
  message: string,
): ProductSafetyExclusion<TProduct> {
  return {
    product,
    productId: product.product_id,
    ownedProductId: product.id,
    reason,
    message,
    matchedAvoidIngredients: [],
  };
}

function findAvoidMatches(
  ingredients: ProductSafetyIngredient[],
  normalizedAvoidIngredients: ReadonlyMap<string, string>,
) {
  const matches = ingredients.flatMap((ingredient) =>
    [ingredient.inciName, ingredient.displayName, ...ingredient.aliases]
      .filter((name): name is string => Boolean(name))
      .map(normalize)
      .map((name) => normalizedAvoidIngredients.get(name))
      .filter((name): name is string => Boolean(name)));
  return [...new Set(matches)];
}

function normalizedAvoidMap(values: string[]) {
  return new Map(values.map((value) => [normalize(value), value]));
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase("en-US")
    .normalize("NFKC")
    .replace(/[\s\p{P}\p{S}_]+/gu, "");
}
