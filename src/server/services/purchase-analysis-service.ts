import "server-only";

import type { Json } from "@/db/database.types";
import { purchaseAnalysisCreateSchema, purchaseAnalysisIdSchema, purchaseAnalysisListQuerySchema, purchaseAnalysisSchema, purchaseEvidenceSchema, type PurchaseAnalysis, type PurchaseEvidence, type PurchaseReasonCode } from "@/schemas/purchase-analysis";
import type { ProductType } from "@/schemas/product";
import type { CatalogProductIngredientWithRelationsRow, CatalogProductWithSourceRow, KnowledgeRepository } from "@/server/repositories/knowledge-repository";
import type { OwnedProductRepository, OwnedProductWithProductRow } from "@/server/repositories/owned-product-repository";
import type { ProfileRepository, ProfileRow } from "@/server/repositories/profile-repository";
import type { PurchaseAnalysisRepository, PurchaseAnalysisRow } from "@/server/repositories/purchase-analysis-repository";
import type { ProductUsageStats } from "@/server/repositories/usage-repository";
import type { UsageService } from "@/server/services/usage-service";

export class PurchaseAnalysisNotFoundError extends Error { constructor(public readonly code: "CATALOG_PRODUCT_NOT_FOUND" | "PURCHASE_ANALYSIS_NOT_FOUND") { super(code); this.name = "PurchaseAnalysisNotFoundError"; } }

type Candidate = { catalogProductId: string | null; brandName: string | null; productName: string; category: string; productType: ProductType; confidence: number | null; source: "catalog" | "manual"; ingredients: Array<{ inciName: string; displayName: string | null; aliases: string[]; kind: string | null; confidence: number | null }>; };
export type PurchaseRuleContext = {
  candidate: Candidate;
  profile: ProfileRow | null;
  inventory: OwnedProductWithProductRow[];
  feedbackStats: Map<string, ProductUsageStats>;
  verifiedIngredientNamesByOwnedProduct?: Map<string, string[]>;
};
export type PurchaseRuleResult = Omit<PurchaseAnalysis, "id" | "created_at">;

const roleByType: Partial<Record<ProductType, string>> = {
  makeup_remover: "cleanse", cleanser: "cleanse", toner: "hydrate", essence: "hydrate",
  serum: "treat", treatment: "treat", mask: "treat", moisturizer: "moisturize",
  face_oil: "moisturize", sunscreen: "sun_protection", eye_care: "eye_care", lip_care: "lip_care",
};
export function calculatePurchaseAnalysis(context: PurchaseRuleContext): PurchaseRuleResult {
  const role = roleByType[context.candidate.productType] ?? context.candidate.productType;
  const usable = context.inventory.filter((item) => !["finished", "discarded", "archived"].includes(item.status) && item.quantity_remaining_percent > 0 && !item.archived_at);
  const alternatives = usable.flatMap((item) => {
    const itemRole = roleByType[item.product.product_type as ProductType] ?? item.product.product_type;
    const match = context.candidate.catalogProductId && item.product.catalog_product_id === context.candidate.catalogProductId
      ? "exact_catalog" as const
      : item.product.product_type === context.candidate.productType && item.product.category === context.candidate.category
        ? "same_type" as const
        : itemRole === role ? "same_role" as const : null;
    return match ? [{ owned_product_id: item.id, product_name: item.product.product_name, brand_name: item.product.brand_name, product_type: item.product.product_type, status: item.status, quantity_remaining_percent: item.quantity_remaining_percent, match }] : [];
  });
  const exact = alternatives.filter((item) => item.match === "exact_catalog");
  const sameType = alternatives.filter((item) => item.match === "same_type");
  const coveredAlternatives = alternatives.filter((item) => item.match !== "same_role");
  const sameRoleOnly = alternatives.filter((item) => item.match === "same_role");
  const maxRemaining = Math.max(0, ...coveredAlternatives.map((item) => item.quantity_remaining_percent));
  const reasonCodes: PurchaseReasonCode[] = [];
  const unknowns: string[] = [];
  let duplicateScore = 100;
  if (exact.length) { duplicateScore = 0; reasonCodes.push("EXACT_CATALOG_ALREADY_OWNED"); }
  else if (sameType.length) { duplicateScore = maxRemaining > 20 ? 10 : 40; reasonCodes.push("SAME_TYPE_SUBSTITUTE_AVAILABLE"); }
  else if (sameRoleOnly.length) {
    unknowns.push("库存中存在同护理角色产品，但缺少功效证据，不能认定为替代品。");
    reasonCodes.push("ROLE_FUNCTION_UNKNOWN");
  }

  let gapScore = 100;
  if (coveredAlternatives.length === 0) reasonCodes.push("REAL_ROLE_GAP");
  else { gapScore = maxRemaining <= 10 ? 65 : coveredAlternatives.length === 1 ? 25 : 5; reasonCodes.push("ROLE_ALREADY_COVERED"); }

  const risks: string[] = [];
  let compatibilityScore = context.profile ? 80 : 50;
  if (!context.profile) { unknowns.push("缺少皮肤档案，无法判断目标和避用偏好。"); reasonCodes.push("MISSING_PROFILE"); }
  const goals = context.profile?.goals ?? [];
  const matchedGoals: string[] = [];
  if (context.candidate.category === "skincare" && goals.length > 0) {
    unknowns.push("当前知识层没有已验证的产品功效声明，无法判断它是否匹配护肤目标。");
    reasonCodes.push("MISSING_GOAL_EVIDENCE");
  }

  const normalizedAvoid = new Map((context.profile?.avoid_ingredients ?? []).map((item) => [normalize(item), item]));
  const avoidMatches = [...new Set(context.candidate.ingredients.flatMap((ingredient) => [ingredient.inciName, ingredient.displayName, ...ingredient.aliases].filter((item): item is string => Boolean(item))).map((name) => normalizedAvoid.get(normalize(name))).filter((item): item is string => Boolean(item)))];
  let riskScore = 0;
  if (avoidMatches.length) { compatibilityScore = 0; riskScore = 100; risks.push(`命中避用成分：${avoidMatches.join("、")}`); reasonCodes.push("AVOID_INGREDIENT_MATCH"); }
  if (normalizedAvoid.size && context.candidate.ingredients.length === 0) { unknowns.push("候选产品缺少成分资料，无法检查避用成分。"); reasonCodes.push("MISSING_INGREDIENT_DATA"); }
  if (context.candidate.source === "catalog" && (context.candidate.confidence ?? 0) < 70) { unknowns.push("目录产品置信度低于 70，关键知识不足。"); reasonCodes.push("LOW_CATALOG_CONFIDENCE"); }

  const candidateIngredientNames = context.candidate.source === "catalog"
    ? new Set(context.candidate.ingredients.flatMap((ingredient) => [ingredient.inciName, ingredient.displayName, ...ingredient.aliases].filter((value): value is string => Boolean(value))).map(normalize))
    : new Set<string>();
  const historyRelevantIds = context.inventory.filter((item) => {
    const exactCatalog = Boolean(
      context.candidate.catalogProductId
      && item.product.catalog_product_id === context.candidate.catalogProductId,
    );
    const exactProduct = normalize(item.product.product_name) === normalize(context.candidate.productName)
      && normalize(item.product.brand_name ?? "") === normalize(context.candidate.brandName ?? "");
    const ownedIngredientNames = context.verifiedIngredientNamesByOwnedProduct?.get(item.id) ?? [];
    const sharedVerifiedIngredient = candidateIngredientNames.size > 0
      && ownedIngredientNames.some((name) => candidateIngredientNames.has(normalize(name)));
    return exactCatalog || exactProduct || sharedVerifiedIngredient;
  }).map((item) => item.id);
  const relevantStats = historyRelevantIds.map((id) => context.feedbackStats.get(id)).filter((value): value is ProductUsageStats => Boolean(value));
  const recentUsageCount = relevantStats.reduce((sum, item) => sum + item.usageCount, 0);
  const highReactionCount = relevantStats.reduce((sum, item) => sum + item.highReactionCount, 0);
  const rated = relevantStats.filter((item) => item.averageRating !== null);
  const averageRating = rated.length ? rated.reduce((sum, item) => sum + (item.averageRating ?? 0), 0) / rated.length : null;
  if (highReactionCount > 0 && riskScore < 100) { riskScore = Math.min(90, riskScore + highReactionCount * 25); compatibilityScore = Math.max(0, compatibilityScore - highReactionCount * 10); risks.push(`有明确关联证据的产品最近 30 天记录 ${highReactionCount} 次高等级反应。`); reasonCodes.push("HIGH_REACTION_HISTORY"); }

  let usageProbabilityScore = coveredAlternatives.length === 0 ? 65 : 50;
  if (recentUsageCount >= 3) { usageProbabilityScore += 15; reasonCodes.push("POSITIVE_ROLE_USAGE_HISTORY"); }
  if (averageRating !== null && averageRating >= 4) usageProbabilityScore += 10;
  if (averageRating !== null && averageRating < 3) { usageProbabilityScore -= 15; reasonCodes.push("LOW_ROLE_USAGE_HISTORY"); }
  if (highReactionCount) usageProbabilityScore -= Math.min(30, highReactionCount * 10);
  usageProbabilityScore = clamp(usageProbabilityScore);
  if (recentUsageCount === 0) { unknowns.push("最近 30 天没有具备明确关联证据的产品反馈，使用概率仅基于库存状态。" ); reasonCodes.push("NO_RELEVANT_USAGE_HISTORY"); }
  if (context.candidate.source === "manual" && context.candidate.ingredients.length > 0) unknowns.push("手工填写的候选成分未经知识库来源验证。");

  const finalScore = clamp(Math.round(duplicateScore * 0.30 + gapScore * 0.20 + compatibilityScore * 0.20 + usageProbabilityScore * 0.10 + (100 - riskScore) * 0.20));
  const criticalInsufficient = !context.profile || (normalizedAvoid.size > 0 && context.candidate.ingredients.length === 0) || (context.candidate.source === "catalog" && (context.candidate.confidence ?? 0) < 70);
  const decision = purchaseDecisionForScore(finalScore, criticalInsufficient);
  const evidence: PurchaseEvidence = { alternatives, gap: { role, active_role_count: coveredAlternatives.length, message: coveredAlternatives.length ? `已有 ${coveredAlternatives.length} 件具有同类型或相同目录证据的产品。` : `当前没有足够证据证明库存已覆盖 ${role}。` }, compatibility: { matched_goals: matchedGoals, avoid_ingredient_matches: avoidMatches }, usage: { recent_usage_count: recentUsageCount, average_rating: averageRating, high_reaction_count: highReactionCount }, risks };

  return {
    candidate_product_id: context.candidate.catalogProductId,
    candidate_snapshot: { source: context.candidate.source, brand_name: context.candidate.brandName, product_name: context.candidate.productName, category: context.candidate.category, product_type: context.candidate.productType, confidence: context.candidate.confidence, ingredients: context.candidate.ingredients },
    inventory_snapshot: { active_inventory_count: usable.length, alternatives },
    goal_snapshot: { skin_type: context.profile?.skin_type ?? null, sensitivity_level: context.profile?.sensitivity_level ?? null, goals, avoid_ingredients: context.profile?.avoid_ingredients ?? [] },
    duplicate_score: duplicateScore, gap_score: gapScore, compatibility_score: clamp(compatibilityScore), usage_probability_score: usageProbabilityScore, risk_score: clamp(riskScore), final_score: finalScore, decision, evidence, unknowns, reason_codes: [...new Set(reasonCodes)],
  };
}

export function purchaseDecisionForScore(
  finalScore: number,
  criticalInsufficient = false,
): PurchaseAnalysis["decision"] {
  if (criticalInsufficient) return "insufficient_data";
  if (finalScore >= 90) return "consider_buy";
  if (finalScore >= 60) return "wait";
  return "do_not_buy";
}

export type PurchaseAnalysisService = { analyze(userId: string, input: unknown): Promise<PurchaseAnalysis>; list(userId: string, query: unknown): Promise<PurchaseAnalysis[]>; get(userId: string, id: unknown): Promise<PurchaseAnalysis>; };
export function createPurchaseAnalysisService(dependencies: { analyses: PurchaseAnalysisRepository; profiles: ProfileRepository; ownedProducts: OwnedProductRepository; knowledge: KnowledgeRepository; usage: UsageService; now?: () => Date; }): PurchaseAnalysisService {
  return {
    async analyze(userId, input) {
      const validated = purchaseAnalysisCreateSchema.parse(input);
      let candidate: Candidate;
      if (validated.catalog_product_id) {
        const catalog = await dependencies.knowledge.findVerifiedProduct(validated.catalog_product_id);
        if (!catalog) throw new PurchaseAnalysisNotFoundError("CATALOG_PRODUCT_NOT_FOUND");
        const ingredients = await dependencies.knowledge.listVerifiedProductIngredients(catalog.id);
        candidate = candidateFromCatalog(catalog, ingredients);
      } else {
        const manual = validated.candidate_snapshot!;
        candidate = { catalogProductId: null, brandName: manual.brand_name, productName: manual.product_name, category: manual.category, productType: manual.product_type, confidence: null, source: "manual", ingredients: manual.ingredients.map((name) => ({ inciName: name, displayName: null, aliases: [], kind: null, confidence: null })) };
      }
      const [profile, inventory] = await Promise.all([dependencies.profiles.findByUserId(userId), dependencies.ownedProducts.listByUserId(userId, {})]);
      const catalogIds = [...new Set(inventory.map((item) => item.product.catalog_product_id).filter((id): id is string => Boolean(id)))];
      const timezone = profile?.timezone ?? "Asia/Shanghai";
      const today = dateInTimeZone((dependencies.now ?? (() => new Date()))(), timezone);
      // Ingredient evidence and usage history are independent; keep both complete.
      const [ingredientEntries, feedbackStats] = await Promise.all([
        Promise.all(catalogIds.map(async (catalogId) => {
          const ingredients = await dependencies.knowledge.listVerifiedProductIngredients(catalogId);
          return [catalogId, ingredients.flatMap((item) => [item.ingredient.inci_name, item.ingredient.display_name, ...item.ingredient.aliases].filter((name): name is string => Boolean(name)))] as const;
        })),
        dependencies.usage.getRecentProductStats(userId, inventory.map((item) => item.id), today),
      ]);
      const ingredientNamesByCatalog = new Map(ingredientEntries);
      const verifiedIngredientNamesByOwnedProduct = new Map(
        inventory.flatMap((item) => item.product.catalog_product_id
          ? [[item.id, ingredientNamesByCatalog.get(item.product.catalog_product_id) ?? []] as const]
          : []),
      );
      return toAnalysis(await dependencies.analyses.create(userId, toWrite(calculatePurchaseAnalysis({ candidate, profile, inventory, feedbackStats, verifiedIngredientNamesByOwnedProduct }))));
    },
    async list(userId, query) { const { limit } = purchaseAnalysisListQuerySchema.parse(query); return (await dependencies.analyses.listByUserId(userId, limit)).map(toAnalysis); },
    async get(userId, id) { const row = await dependencies.analyses.findById(userId, purchaseAnalysisIdSchema.parse(id)); if (!row) throw new PurchaseAnalysisNotFoundError("PURCHASE_ANALYSIS_NOT_FOUND"); return toAnalysis(row); },
  };
}

function candidateFromCatalog(product: CatalogProductWithSourceRow, ingredients: CatalogProductIngredientWithRelationsRow[]): Candidate { return { catalogProductId: product.id, brandName: product.brand_name, productName: product.product_name, category: product.category, productType: product.product_type as ProductType, confidence: product.confidence, source: "catalog", ingredients: ingredients.map((item) => ({ inciName: item.ingredient.inci_name, displayName: item.ingredient.display_name, aliases: item.ingredient.aliases, kind: item.ingredient.ingredient_kind, confidence: item.confidence })) }; }
function toWrite(result: PurchaseRuleResult) { return { ...result, candidate_snapshot: result.candidate_snapshot as Json, inventory_snapshot: result.inventory_snapshot as Json, goal_snapshot: result.goal_snapshot as Json, evidence: result.evidence as unknown as Json, unknowns: result.unknowns as Json }; }
function toAnalysis(row: PurchaseAnalysisRow): PurchaseAnalysis {
  const { evidence, unknowns } = normalizeHistoricalEvidence(row.evidence, row.unknowns);
  return purchaseAnalysisSchema.parse({
    ...row,
    evidence,
    unknowns,
    created_at: normalizePurchaseAnalysisCreatedAt(row.created_at),
  });
}

const legacyDatabaseTimestampPattern =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/;

function normalizePurchaseAnalysisCreatedAt(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError("purchase_analyses.created_at must be a non-empty timestamp string.");
  }
  const candidate = legacyDatabaseTimestampPattern.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("purchase_analyses.created_at must be a valid datetime.");
  }
  return parsed.toISOString();
}

function normalizeHistoricalEvidence(evidence: Json, storedUnknowns: Json) {
  const source = isJsonObject(evidence) ? evidence : {};
  const unknowns = Array.isArray(storedUnknowns)
    ? storedUnknowns.filter((item): item is string => typeof item === "string")
    : [];
  const missing: string[] = [];

  const alternatives = purchaseEvidenceSchema.shape.alternatives.safeParse(source.alternatives);
  if (!alternatives.success) missing.push("历史分析未记录与已有资产的关系。");
  const gap = purchaseEvidenceSchema.shape.gap.safeParse(source.gap);
  if (!gap.success) missing.push("历史分析未记录现有缺口证据。");
  const compatibility = purchaseEvidenceSchema.shape.compatibility.safeParse(source.compatibility);
  if (!compatibility.success) missing.push("历史分析未记录个人匹配证据。");
  const usage = purchaseEvidenceSchema.shape.usage.safeParse(source.usage);
  if (!usage.success) missing.push("历史分析未记录使用概率证据。");
  const risks = purchaseEvidenceSchema.shape.risks.safeParse(source.risks);
  if (!risks.success) missing.push("历史分析未记录风险证据。");

  return {
    evidence: {
      alternatives: alternatives.success ? alternatives.data : [],
      gap: gap.success ? gap.data : {
        role: "unknown",
        active_role_count: 0,
        message: "历史分析未记录现有缺口证据。",
      },
      compatibility: compatibility.success ? compatibility.data : {
        matched_goals: [],
        avoid_ingredient_matches: [],
      },
      usage: usage.success ? usage.data : {
        recent_usage_count: 0,
        average_rating: null,
        high_reaction_count: 0,
      },
      risks: risks.success ? risks.data : [],
    },
    unknowns: [...new Set([...unknowns, ...missing])],
  };
}

function isJsonObject(value: Json): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalize(value: string) { return value.toLocaleLowerCase("en-US").normalize("NFKC").replace(/[\s\p{P}\p{S}_]+/gu, ""); }
function clamp(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }
function dateInTimeZone(date: Date, timeZone: string) { const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date); const values = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}`; }
