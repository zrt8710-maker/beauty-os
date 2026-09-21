export const PRODUCT_SAFETY_EXCLUSION_REASONS = [
  "PRODUCT_NOT_ACTIVE",
  "PRODUCT_ARCHIVED",
  "PRODUCT_FINISHED",
  "PRODUCT_EMPTY",
  "PRODUCT_EXPIRED",
  "RECENT_HIGH_REACTION_HARD_BLOCK",
  "AVOID_INGREDIENT_MATCH",
] as const;

export const PRODUCT_SAFETY_UNKNOWN_REASONS = [
  "INGREDIENT_DATA_UNKNOWN",
] as const;

export type ProductSafetyExclusionReason =
  (typeof PRODUCT_SAFETY_EXCLUSION_REASONS)[number];
export type ProductSafetyUnknownReason =
  (typeof PRODUCT_SAFETY_UNKNOWN_REASONS)[number];

export type ProductSafetyCandidate = {
  id: string;
  product_id: string;
  status: string;
  archived_at: string | null;
  expires_on: string | null;
  quantity_remaining_percent: number;
  product: {
    catalog_product_id: string | null;
  };
};

export type ProductSafetyIngredient = {
  inciName: string;
  displayName: string | null;
  aliases: string[];
};

export type ProductSafetyIngredientData = {
  reliable: boolean;
  ingredients: ProductSafetyIngredient[];
};

export type ProductSafetyFeedbackStats = {
  highReactionCount: number;
};

export type ProductSafetyContext = {
  assessIngredients: boolean;
  avoidIngredients: string[];
  ingredientDataByCatalogProductId: ReadonlyMap<
    string,
    ProductSafetyIngredientData
  >;
};

export type ProductSafetyInput<TProduct extends ProductSafetyCandidate> =
  ProductSafetyContext & {
    products: TProduct[];
    routineDate: string;
    feedbackStats: ReadonlyMap<string, ProductSafetyFeedbackStats>;
  };

export type ProductSafetyExclusion<TProduct extends ProductSafetyCandidate> = {
  product: TProduct;
  productId: string;
  ownedProductId: string;
  reason: ProductSafetyExclusionReason;
  message: string;
  matchedAvoidIngredients: string[];
};

export type ProductSafetyUnknown<TProduct extends ProductSafetyCandidate> = {
  product: TProduct;
  productId: string;
  ownedProductId: string;
  reason: ProductSafetyUnknownReason;
  message: string;
};

export type ProductSafetyResult<TProduct extends ProductSafetyCandidate> = {
  eligibleProducts: TProduct[];
  excludedProducts: ProductSafetyExclusion<TProduct>[];
  unknownProducts: ProductSafetyUnknown<TProduct>[];
};
