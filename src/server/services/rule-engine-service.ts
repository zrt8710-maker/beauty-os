import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import { consumerIngredientDisplayNames } from "@/lib/consumer-ingredient-display";

import type { Json } from "@/db/database.types";
import { buildDailySkinMetricSnapshot } from "@/domain/skin-grading/daily-skin-metric-snapshot";
import {
  dailyStateSchema,
  type SkinCheckin,
} from "@/schemas/checkin";
import { PRODUCT_TYPE_META, type ProductType } from "@/schemas/product";
import { SKIN_GOALS, TEXTURE_PREFERENCES } from "@/schemas/profile";
import type { RoutineRolePreference } from "@/schemas/usage";
import {
  routineGenerateSchema,
  routineIdSchema,
  routineDecisionSnapshotSchema,
  routineSchema,
  type ExcludedProduct,
  type ExclusionReasonCode,
  type Routine,
  type RoutineDecisionSnapshot,
  type RoutinePeriod,
  type RoutineReasonCode,
  type RoutineRole,
  type ScoreBreakdown,
} from "@/schemas/routine";
import {
  DAILY_CARE_GOALS,
  DAILY_CARE_SKIN_TYPES,
  deriveDailyCareNeeds,
  type DailyCareGoal,
  type DailyCareLevel,
  type DailyCareNeeds,
  type DailyCarePriorityCode,
  type DailyCareSkinType,
} from "@/server/domain/daily-care-needs";
import { deriveEffectiveDailyCareSignals } from "@/server/domain/daily-care-needs/derive-effective-daily-care-signals";
import {
  deriveCapabilityGaps,
  type CapabilityGap,
} from "@/server/domain/capability-gaps";
import {
  matchCapabilitiesToDailyCareNeeds,
  resolveProductDecisionProfile,
  type ProductDecisionProfile,
} from "@/server/domain/product-decision";
import {
  baselineRolesForMinimumSufficientRoutine,
  residualPriorities,
  selectMinimumSufficientConditionCandidates,
  verifiedCoverageForCandidates,
} from "@/server/domain/minimum-sufficient-routine";
import {
  filterProductsForSafety,
  productAssetStateExclusion,
  productSafetyStateExclusion,
  type ProductSafetyContext,
  type ProductSafetyIngredientData,
} from "@/server/domain/product-safety";
import type { KnowledgeRepository } from "@/server/repositories/knowledge-repository";
import type {
  OwnedProductRepository,
  OwnedProductWithProductRow,
} from "@/server/repositories/owned-product-repository";
import type { ProductUsageStats } from "@/server/repositories/usage-repository";
import type {
  ProfileRepository,
  ProfileRow,
} from "@/server/repositories/profile-repository";
import type {
  RoutineRepository,
  RoutineStepWrite,
  RoutineWithStepsRow,
} from "@/server/repositories/routine-repository";
import type {
  SkinCheckinRepository,
  SkinCheckinRow,
} from "@/server/repositories/skin-checkin-repository";
import type {
  WeatherRepository,
  WeatherRow,
} from "@/server/repositories/weather-repository";
import type { UsageService } from "@/server/services/usage-service";
import type { ProductDecisionResolverService } from "@/server/services/product-decision-resolver-service";
import type { RuntimeDraftIngredients } from "@/server/services/product-knowledge-runtime-availability-service";
import {
  emptyPlannerProductEvidence,
  type CareStepPurpose,
  type PlannerProductEvidence,
} from "@/server/services/planner-product-evidence-service";
import type { TodayUserNarrativeInput, TodayUserNarrativeService } from "@/server/services/today-user-narrative-service";
import { carePlannerDecisionSchema, type CarePlannerDecision, type CarePlannerInput, type CarePlannerService, baselinePurposesForPlanner, purposeToRoutineRole, routineRoleToPurpose, validateCarePlannerDecisionDetailed } from "@/server/services/today-care-planner-service";
import { retrieveCareGuidance } from "@/server/services/care-guidance-retrieval-service";
import { baselineSpecs, buildEffectiveDailySkinState } from "@/features/check-in/effective-daily-skin-state";
import type { PersonalMemoryService } from "@/server/services/personal-memory-service";
import type {
  TodayProductKnowledgeReadBundle,
  TodayProductKnowledgeReadService,
} from "@/server/services/today-product-knowledge-read-service";
import {
  compactPlannerCandidates,
  shortlistCarePlannerCandidates,
} from "@/server/services/today-candidate-retrieval-service";

export class RoutineNotFoundError extends Error {
  constructor() {
    super("ROUTINE_NOT_FOUND");
    this.name = "RoutineNotFoundError";
  }
}

/** A retryable Planner failure must never replace a usable saved routine. */
export class RoutineRegenerationFailedError extends Error {
  constructor() {
    super("CARE_PLANNER_REGENERATION_FAILED");
    this.name = "RoutineRegenerationFailedError";
  }
}

export type RuleEngineDependencies = {
  profiles: ProfileRepository;
  checkins: SkinCheckinRepository;
  weather: WeatherRepository;
  knowledge?: KnowledgeRepository;
  productDecisions?: ProductDecisionResolverService;
  runtimeDraftIngredients?: { findTrustedDraftIngredients(catalogProductId: string): Promise<RuntimeDraftIngredients> };
  plannerEvidence?: { findByCatalogProductId(catalogProductId: string, timing?: { requestId: string }): Promise<PlannerProductEvidence> };
  todayProductKnowledge?: TodayProductKnowledgeReadService;
  ownedProducts: OwnedProductRepository;
  routines: RoutineRepository;
  usage: UsageService;
  now?: () => Date;
  carePlanner?: CarePlannerService;
  /** Optional presentation-only LLM. It runs after a valid Planner decision. */
  careNarrative?: TodayUserNarrativeService;
  /** Optional, private, best-effort long-term preference retrieval. */
  personalMemory?: PersonalMemoryService;
};

export type RuleContext = {
  routineDate: string;
  period: RoutinePeriod;
  checkin: SkinCheckinRow | null;
  weather: WeatherRow | null;
  dailyCareNeeds?: DailyCareNeeds;
  productSafety?: ProductSafetyContext;
  decisionProfilesByProductId?: ReadonlyMap<string, ProductDecisionProfile>;
  products: OwnedProductWithProductRow[];
  feedbackStats: Map<string, { usageCount: number; averageRating: number | null; highReactionCount: number }>;
  maxSteps: number;
};

export type RoutinePlan = {
  steps: RoutineStepWrite[];
  excludedProducts: ExcludedProduct[];
  capabilityGaps: CapabilityGap[];
  decisionFacts: {
    routinePolicy: RoutineDecisionSnapshot["routinePolicy"];
    selectedSteps: RoutineDecisionSnapshot["selectedSteps"];
    abstentions: RoutineDecisionSnapshot["abstentions"];
  };
};

type RoutineExplanation = NonNullable<Routine["explanation"]>;

type ScoredCandidate = Omit<RoutineStepWrite, "step_order"> & {
  owned: OwnedProductWithProductRow;
};

const legacyRoleByProductTypeFallback: Record<
  string,
  RoutineRole | undefined
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

const roleOrder: Record<RoutinePeriod, Partial<Record<RoutineRole, number>>> = {
  am: { cleanser: 1, hydration: 2, treatment: 2, moisturizer: 3, sunscreen: 4 },
  pm: { remover: 1, cleanser: 2, hydration: 3, treatment: 3, moisturizer: 4 },
};

const legacyRequiredRoles: Record<RoutinePeriod, ReadonlySet<RoutineRole>> = {
  am: new Set(["moisturizer", "sunscreen"]),
  pm: new Set(["cleanser", "moisturizer"]),
};

export function buildRoutinePlan(context: RuleContext): RoutinePlan {
  const legacySensitive = knownCheckinLevel(context.checkin, "sensitivity_level") >= 3;
  const reduceTreatment = legacySensitive
    || hasRestriction(context.dailyCareNeeds, "REDUCE_TREATMENT");
  const gentleCare = reduceTreatment
    || hasRestriction(context.dailyCareNeeds, "PREFER_GENTLE_ROUTINE");
  const requiredRoles = requiredRolesFor(context);
  const safetyResult = context.productSafety
    ? filterProductsForSafety({
        ...context.productSafety,
        products: context.products,
        routineDate: context.routineDate,
        feedbackStats: context.feedbackStats,
      })
    : {
        eligibleProducts: context.products,
        excludedProducts: [],
        unknownProducts: [],
      };
  const excludedProducts: ExcludedProduct[] = safetyResult.excludedProducts.map(
    (excluded) => toExcludedProduct(
      excluded.product,
      excluded.reason,
      excluded.message,
    ),
  );
  const eligibleProducts: Array<{
    owned: OwnedProductWithProductRow;
    role: RoutineRole;
  }> = [];

  for (const owned of [...safetyResult.eligibleProducts].sort(
    (a, b) => a.id.localeCompare(b.id),
  )) {
    const exclusion = eligibilityExclusion(owned, context, reduceTreatment, Boolean(context.productSafety));
    if (exclusion) {
      excludedProducts.push(toExcludedProduct(owned, exclusion.code, exclusion.reason));
      continue;
    }
    // Treatment is an optional care role. The current DailyCareNeeds and
    // verified Product Knowledge contracts do not express a positive,
    // treatment-specific direction, so ownership, product type, and inventory
    // state cannot make it a Today candidate. Keep the abstention here, before
    // scoring and per-role selection, until that explicit contract exists.
    if (resolvedRoleForProduct(owned, context) === "treatment") {
      continue;
    }
    eligibleProducts.push({ owned, role: resolvedRoleForProduct(owned, context)! });
  }

  // Decision A: establish the functional baseline without looking at which
  // optional roles happen to be owned. Decision B then ranks products only
  // inside the roles permitted by this necessity plan.
  const baselineRoles = baselineRolesForMinimumSufficientRoutine(context.period);
  const baselineScored = eligibleProducts
      .filter((candidate) => baselineRoles.includes(candidate.role))
      .map((candidate) => scoreProduct(
        candidate.owned,
        context,
        legacySensitive,
        gentleCare,
      ));
  const baseline = selectBestCandidatesByRole(
    baselineScored,
    excludedProducts,
  );
  const baselineCoverage = verifiedCoverageForCandidates(
    [...baseline.values()].map((candidate) => ({
      decisionProfile: context.decisionProfilesByProductId?.get(
        candidate.owned.product_id,
      ),
    })),
  );
  const residual = residualPriorities(
    context.dailyCareNeeds?.priorities.map((priority) => priority.code) ?? [],
    baselineCoverage,
  );
  const conditionalCandidates = eligibleProducts
    .filter((candidate) => !baselineRoles.includes(candidate.role))
    .map((candidate) => scoreProduct(
      candidate.owned,
      context,
      legacySensitive,
      gentleCare,
    ));
  const conditionAdded = selectMinimumSufficientConditionCandidates({
    period: context.period,
    residual,
    candidates: conditionalCandidates.map((candidate) => ({
      ownedProductId: candidate.owned_product_id,
      role: candidate.role,
      rank: candidate.score,
      decisionProfile: context.decisionProfilesByProductId?.get(
        candidate.owned.product_id,
      ),
    })),
  });
  const conditionalByOwnedProductId = new Map(
    conditionalCandidates.map((candidate) => [candidate.owned_product_id, candidate]),
  );
  let selected = [
    ...baseline.values(),
    ...conditionAdded.map((candidate) =>
      conditionalByOwnedProductId.get(candidate.ownedProductId)!),
  ];
  while (selected.length > context.maxSteps) {
    const removable = [...selected].sort((a, b) => {
      const requiredDifference = Number(requiredRoles.has(a.role))
        - Number(requiredRoles.has(b.role));
      return requiredDifference || a.score - b.score || b.owned.id.localeCompare(a.owned.id);
    })[0];
    selected = selected.filter((candidate) => candidate !== removable);
    excludedProducts.push(toExcludedProduct(
      removable.owned,
      "STEP_LIMIT_REMOVED",
      `超过用户设置的 ${context.period.toUpperCase()} 最大步骤数。`,
    ));
  }

  const steps = selected
    .sort((a, b) => {
      const orderDifference = (roleOrder[context.period][a.role] ?? 99)
        - (roleOrder[context.period][b.role] ?? 99);
      return orderDifference || compareCandidates(a, b);
    })
    .map((candidate, index) => ({
      owned_product_id: candidate.owned_product_id,
      step_order: index + 1,
      role: candidate.role,
      reason: candidate.reason,
      reason_code: candidate.reason_code,
      score: candidate.score,
      score_breakdown: candidate.score_breakdown,
    }));
  const priorityCodes = context.dailyCareNeeds?.priorities.map(
    (priority) => priority.code,
  ) ?? [];
  const finalCoverage = verifiedCoverageForCandidates(
    selected.map((candidate) => ({
      decisionProfile: context.decisionProfilesByProductId?.get(
        candidate.owned.product_id,
      ),
    })),
  );
  const productByOwnedId = new Map(
    context.products.map((product) => [product.id, product]),
  );
  // This is care-role inventory coverage. Keep the legacy response property
  // name for API compatibility; capability knowledge gaps are a separate,
  // future concept and are not inferred here.
  const careRoleCoverageGaps = deriveCapabilityGaps({
    requiredRoles: [...requiredRoles],
    selectedProducts: steps.map((step) => ({
      ownedProductId: step.owned_product_id,
      role: step.role,
    })),
    excludedProducts: excludedProducts.flatMap((excluded) => {
      const owned = productByOwnedId.get(excluded.owned_product_id);
      const role = owned && resolvedRoleForProduct(owned, context);
      return role
        ? [{
            ownedProductId: excluded.owned_product_id,
            role,
            reason: excluded.reason_code,
          }]
        : [];
    }),
    unknownProducts: safetyResult.unknownProducts.flatMap((unknown) => {
      const role = resolvedRoleForProduct(unknown.product, context);
      return role
        ? [{
            ownedProductId: unknown.ownedProductId,
            role,
            reason: unknown.reason,
          }]
        : [];
    }),
  });

  return {
    steps,
    excludedProducts: excludedProducts.sort((a, b) =>
      a.owned_product_id.localeCompare(b.owned_product_id),
    ),
    capabilityGaps: careRoleCoverageGaps,
    decisionFacts: {
      routinePolicy: {
        baselineRoles,
        baselineCoverage: priorityCodes.filter((code) => baselineCoverage.has(code)),
        residualPriorities: residual,
        unresolvedResidualPriorities: residual.filter(
          (priority) => !finalCoverage.has(priority),
        ),
      },
      selectedSteps: selected.map((candidate) => ({
        ownedProductId: candidate.owned_product_id,
        role: candidate.role,
        decision: baselineRoles.includes(candidate.role)
          ? "baseline"
          : "condition_added",
        coveredPriorities: priorityCodes.filter((priority) =>
          verifiedCoverageForCandidates([{
            decisionProfile: context.decisionProfilesByProductId?.get(
              candidate.owned.product_id,
            ),
          }]).has(priority),
        ),
      })),
      abstentions: routineAbstentions(context.period),
    },
  } as RoutinePlan;
}

export function buildRoutineSteps(context: RuleContext): RoutineStepWrite[] {
  return buildRoutinePlan(context).steps;
}

/**
 * Persistence adapter for a decision which has already passed the shared
 * Planner validator. It deliberately performs no ranking, scoring, coverage,
 * role eligibility, or care-direction inference.
 */
export function materializeValidatedPlannerPlan(input: {
  period: RoutinePeriod;
  routineDate: string;
  decision: CarePlannerDecision;
  products: OwnedProductWithProductRow[];
  productSafety?: ProductSafetyContext;
  feedbackStats: RuleContext["feedbackStats"];
}): RoutinePlan {
  const productByOwnedId = new Map(
    input.products.map((product) => [product.id, product]),
  );
  const selected = input.decision.selected_steps.map((step) => {
    if (!productByOwnedId.has(step.ownedProductId)) {
      throw new Error("VALIDATED_PLANNER_PRODUCT_MISSING");
    }
    return step;
  });
  const zeroBreakdown: ScoreBreakdown = {
    base: 0,
    skin_fit: 0,
    weather_fit: 0,
    feedback_score: 0,
    inventory_priority: 0,
  };
  const steps = selected.map((step, index): RoutineStepWrite => ({
    owned_product_id: step.ownedProductId,
    step_order: index + 1,
    role: purposeToRoutineRole[step.purpose],
    reason: `${step.why_today}；${step.why_this_product}`,
    reason_code: "BASE_ROUTINE_SELECTED",
    score: 0,
    score_breakdown: { ...zeroBreakdown },
  }));
  const safetyResult = input.productSafety
    ? filterProductsForSafety({
        ...input.productSafety,
        products: input.products,
        routineDate: input.routineDate,
        feedbackStats: input.feedbackStats,
      })
    : { excludedProducts: [] };
  const baselinePurposes = new Set(baselinePurposesForPlanner[input.period]);

  return {
    steps,
    excludedProducts: safetyResult.excludedProducts.map((excluded) =>
      toExcludedProduct(excluded.product, excluded.reason, excluded.message)),
    // Planner unresolved needs are purpose-level generation facts and remain
    // in planner.structuredDecision. Do not overwrite them with the legacy,
    // verified-only role gap model.
    capabilityGaps: [],
    decisionFacts: {
      routinePolicy: {
        baselineRoles: baselinePurposesForPlanner[input.period].map(
          (purpose) => purposeToRoutineRole[purpose],
        ),
        baselineCoverage: [],
        residualPriorities: [],
        unresolvedResidualPriorities: [],
      },
      selectedSteps: selected.map((step) => ({
        ownedProductId: step.ownedProductId,
        role: purposeToRoutineRole[step.purpose],
        decision: baselinePurposes.has(step.purpose)
          ? "baseline" as const
          : "condition_added" as const,
        coveredPriorities: [],
      })),
      abstentions: [],
    },
  };
}

function routineAbstentions(
  period: RoutinePeriod,
): RoutineDecisionSnapshot["abstentions"] {
  return [
    { role: "treatment", code: "NO_TREATMENT_DIRECTION" },
    ...(period === "am"
      ? [{ role: "cleanser" as const, code: "AM_CLEANSER_ABSTAIN" as const }]
      : [{ role: "remover" as const, code: "PM_REMOVER_ABSTAIN" as const }]),
  ];
}

function buildDecisionSnapshot(
  dailyCareNeeds: DailyCareNeeds,
  plan: RoutinePlan,
  planner?: RoutineDecisionSnapshot["planner"],
  reuseContext?: RoutineDecisionSnapshot["reuseContext"],
): RoutineDecisionSnapshot {
  return routineDecisionSnapshotSchema.parse({
    version: 1,
    dailyCareNeeds,
    routinePolicy: plan.decisionFacts.routinePolicy,
    selectedSteps: plan.decisionFacts.selectedSteps,
    abstentions: plan.decisionFacts.abstentions,
    capabilityGaps: plan.capabilityGaps,
    ...(reuseContext ? { reuseContext } : {}),
    ...(planner ? { planner } : {}),
  });
}

function explanationFromDecisionSnapshot(
  decisionSnapshot: RoutineDecisionSnapshot,
): RoutineExplanation {
  return {
    priorities: decisionSnapshot.dailyCareNeeds.priorities,
    reasons: decisionSnapshot.dailyCareNeeds.reasons,
    restrictions: decisionSnapshot.dailyCareNeeds.restrictions,
    capability_gaps: decisionSnapshot.capabilityGaps,
  };
}

function eligibilityExclusion(
  owned: OwnedProductWithProductRow,
  context: RuleContext,
  reduceTreatment: boolean,
  safetyAlreadyApplied: boolean,
): { code: ExclusionReasonCode; reason: string } | null {
  if (!safetyAlreadyApplied) {
    const safetyExclusion = productSafetyStateExclusion(
      owned,
      context.routineDate,
      context.feedbackStats,
    );
    if (safetyExclusion) {
      return { code: safetyExclusion.reason, reason: safetyExclusion.message };
    }
  }
  if (owned.product.category !== "skincare") {
    return { code: "NON_SKINCARE_PRODUCT", reason: "当前只生成护肤方案。" };
  }

  const role = resolvedRoleForProduct(owned, context);
  if (!role) {
    return { code: "UNSUPPORTED_PRODUCT_TYPE", reason: "当前规则没有对应的护肤步骤角色。" };
  }
  if (roleOrder[context.period][role] === undefined) {
    return {
      code: "PERIOD_NOT_APPLICABLE",
      reason: `该产品不适用于当前 ${context.period.toUpperCase()} 顺序。`,
    };
  }
  if (reduceTreatment && role === "treatment") {
    return {
      code: "HIGH_SENSITIVITY_REDUCE_ACTIVE",
      reason: "今天敏感程度较高，减少功效护理步骤。",
    };
  }
  return null;
}

function scoreProduct(
  owned: OwnedProductWithProductRow,
  context: RuleContext,
  legacySensitive: boolean,
  gentleCare: boolean,
  roleOverride?: RoutineRole,
): ScoredCandidate {
  const role = roleOverride ?? resolvedRoleForProduct(owned, context)!;
  const breakdown: ScoreBreakdown = {
    base: 40,
    skin_fit: 0,
    weather_fit: 0,
    feedback_score: 0,
    inventory_priority: 10,
  };
  const reasons = ["基础分 40", "当前库存可用 +10"];

  if (context.dailyCareNeeds) {
    const needsFit = dailyCareNeedsSkinFit(role, context.dailyCareNeeds);
    if (needsFit.bonus > 0) {
      breakdown.skin_fit += needsFit.bonus;
      reasons.push(
        `今日护理需求匹配 +${needsFit.bonus}（${needsFit.labels.join("、")}）`,
      );
    }
    const decisionProfile = context.decisionProfilesByProductId
      ?.get(owned.product_id);
    if (decisionProfile) {
      const capabilityFit = matchCapabilitiesToDailyCareNeeds(
        decisionProfile,
        context.dailyCareNeeds,
      );
      if (capabilityFit.applied_bonus > 0) {
        breakdown.skin_fit += capabilityFit.applied_bonus;
        reasons.push(
          `已验证产品能力匹配 +${capabilityFit.applied_bonus}（${capabilityFit.matches
            .map((match) => priorityLabel(match.priority_code))
            .join("、")}）`,
        );
      }
    }
  } else {
    if (knownCheckinLevel(context.checkin, "dryness_level") >= 3 && role === "moisturizer") {
      breakdown.skin_fit += 15;
      reasons.push("干燥状态匹配 +15");
    }
    if (legacySensitive && ["hydration", "moisturizer"].includes(role)) {
      breakdown.skin_fit += 15;
      reasons.push("高敏感基础护理 +15");
    }
    if (knownCheckinLevel(context.checkin, "oiliness_level") >= 3 && role === "hydration") {
      breakdown.skin_fit += 8;
      reasons.push("出油状态轻量补水 +8");
    }
  }
  const feedback = context.feedbackStats.get(owned.id);
  if (feedback?.averageRating !== null && feedback?.averageRating !== undefined) {
    breakdown.feedback_score += Math.max(
      -10,
      Math.min(10, Math.round((feedback.averageRating - 3) * 5)),
    );
  }
  if (feedback && feedback.highReactionCount > 0) {
    breakdown.feedback_score -= Math.min(20, feedback.highReactionCount * 10);
  }
  if (breakdown.feedback_score !== 0) {
    reasons.push(`最近 30 天反馈 ${signed(breakdown.feedback_score)}`);
  }

  if (owned.quantity_remaining_percent <= 30) {
    breakdown.inventory_priority += 5;
    reasons.push("低余量优先用完 +5");
  }

  const score = Math.max(
    0,
    Math.min(100, Object.values(breakdown).reduce((sum, value) => sum + value, 0)),
  );
  return {
    owned,
    owned_product_id: owned.id,
    role,
    reason: reasons.join("；"),
    reason_code: primaryReasonCode(role, breakdown, gentleCare),
    score,
    score_breakdown: breakdown,
  };
}

function primaryReasonCode(
  role: RoutineRole,
  breakdown: ScoreBreakdown,
  gentleCare: boolean,
): RoutineReasonCode {
  if (gentleCare && ["hydration", "moisturizer"].includes(role)) {
    return "HIGH_SENSITIVITY_BASIC_CARE";
  }
  if (breakdown.skin_fit >= 15 && role === "moisturizer") return "SKIN_DRYNESS_FIT";
  if (breakdown.feedback_score < 0) return "RECENT_HIGH_REACTION_PENALTY";
  if (breakdown.feedback_score > 0) return "RECENT_POSITIVE_FEEDBACK";
  if (breakdown.inventory_priority > 10) return "INVENTORY_USE_FIRST";
  return "BASE_ROUTINE_SELECTED";
}

function compareCandidates(a: ScoredCandidate, b: ScoredCandidate) {
  return b.score - a.score || a.owned.id.localeCompare(b.owned.id);
}

function selectBestCandidatesByRole(
  candidates: ScoredCandidate[],
  excludedProducts: ExcludedProduct[],
): Map<RoutineRole, ScoredCandidate> {
  const selectedByRole = new Map<RoutineRole, ScoredCandidate>();
  for (const candidate of [...candidates].sort(compareCandidates)) {
    if (!selectedByRole.has(candidate.role)) {
      selectedByRole.set(candidate.role, candidate);
      continue;
    }
    excludedProducts.push(toExcludedProduct(
      candidate.owned,
      "DUPLICATE_ROLE_REMOVED",
      `同一 ${candidate.role} 角色已有评分更高或排序更稳定的产品。`,
    ));
  }
  return selectedByRole;
}

function toExcludedProduct(
  owned: OwnedProductWithProductRow,
  reasonCode: ExclusionReasonCode,
  reason: string,
): ExcludedProduct {
  return {
    owned_product_id: owned.id,
    product_id: owned.product_id,
    brand_name: owned.product.brand_name,
    product_name: owned.product.product_name,
    reason_code: reasonCode,
    reason,
  };
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export type RuleEngineService = {
  getToday(userId: string, periodInput: unknown): Promise<Routine | null>;
  getRoutine(userId: string, routineId: unknown): Promise<Routine>;
  generate(
    userId: string,
    input: unknown,
    onGenerationResult?: (result: RoutineGenerationResult, explanation?: string) => void,
  ): Promise<Routine>;
};

export type RoutineGenerationResult =
  | "generated"
  | "reused"
  | "retained_after_failure"
  | "deterministic_fallback";

type PreviousRoutineRetentionReason =
  | "retained"
  | "no_previous"
  | "unsafe_product"
  | "product_no_longer_owned"
  | "archived"
  | "expired"
  | "quantity_zero"
  | "hard_restricted";

export function createRuleEngineService(
  dependencies: RuleEngineDependencies,
): RuleEngineService {
  const now = dependencies.now ?? (() => new Date());

  return {
    async getToday(userId, periodInput) {
      const profile = await dependencies.profiles.findByUserId(userId);
      const period = routineGenerateSchema.parse(periodInput).period;
      const date = dateInTimeZone(now(), profile?.timezone ?? "Asia/Shanghai");
      const row = await dependencies.routines.findByDate(userId, date, period);
      if (!row) return null;
      return toRoutine(row);
    },

    async getRoutine(userId, routineId) {
      const id = routineIdSchema.parse(routineId);
      const row = await dependencies.routines.findById(userId, id);
      if (!row) throw new RoutineNotFoundError();
      return toRoutine(row);
    },

    async generate(userId, input, onGenerationResult) {
      const totalStartedAt = Date.now();
      const { period, forceRegenerate } = routineGenerateSchema.parse(input);
      const requestId = crypto.randomUUID().slice(0, 8);
      // Inventory is independent of the profile. Date-bound reads only need
      // its timezone, not the previous routine query to finish first.
      const [context, products] = await Promise.all([
        (async () => {
          const profile = await timedPlannerStage("profile", requestId, () =>
            dependencies.profiles.findByUserId(userId));
          const routineDate = dateInTimeZone(now(), profile?.timezone ?? "Asia/Shanghai");
          const [existing, checkin, weather] = await Promise.all([
            timedPlannerStage("existing_routine", requestId, () =>
              dependencies.routines.findByDate(userId, routineDate, period)),
            timedPlannerStage("checkin", requestId, () =>
              dependencies.checkins.findByDate(userId, routineDate)),
            timedPlannerStage("weather", requestId, () =>
              dependencies.weather.findByDate(userId, routineDate)),
          ]);
          return { profile, routineDate, existing, checkin, weather };
        })(),
        timedPlannerStage("owned_products", requestId, () =>
          dependencies.ownedProducts.listByUserId(userId, {}, { requestId })),
      ]);
      const { profile, routineDate, existing } = context;
      const result = await buildRoutineExplanation(
        userId,
        routineDate,
        period,
        profile,
        existing,
        forceRegenerate,
        requestId,
        { checkin: context.checkin, weather: context.weather, products },
      );
      if ("reuseExisting" in result) {
        onGenerationResult?.(result.generationResult, result.explanation);
        logPlannerTiming("total_generation", totalStartedAt, {
          requestId,
          period,
          generation_result: result.generationResult,
        });
        return toRoutine(result.reuseExisting);
      }
      const { checkin, weather, plan, decisionSnapshot } = result;
      const skinSnapshot = snapshot(checkin);
      const weatherSnapshot = snapshot(weather);

      if (!forceRegenerate && existing && routineMatches(
        existing,
        skinSnapshot,
        weatherSnapshot,
        plan,
        decisionSnapshot,
      )) {
        onGenerationResult?.("reused", "当前方案重新检查后仍然适合今天，因此不需要更换产品。");
        logPlannerTiming("total_generation", totalStartedAt, {
          requestId,
          period,
          generation_result: "reused",
        });
        return toRoutine(existing);
      }

      const persistenceStartedAt = Date.now();
      const persistencePayload = {
        userId,
        routineDate,
        period,
        skinSnapshot,
        weatherSnapshot,
        decisionSnapshot,
        excludedProducts: plan.excludedProducts,
        steps: plan.steps,
      } satisfies Parameters<RoutineRepository["replace"]>[0];
      const row = await persistRoutineWithTransportRetry({
        repository: dependencies.routines,
        initial: existing,
        payload: persistencePayload,
        plan,
        requestId,
      });
      logPlannerTiming("persistence", persistenceStartedAt, { requestId, period });
      const generationResult = decisionSnapshot.planner?.generationSource === "deterministic_fallback"
        ? "deterministic_fallback" as const
        : "generated" as const;
      onGenerationResult?.(generationResult);
      logPlannerTiming("total_generation", totalStartedAt, {
        requestId,
        period,
        generation_result: generationResult,
      });
      return toRoutine(row);
    },
  };

  async function buildRoutineExplanation(
    userId: string,
    routineDate: string,
    period: RoutinePeriod,
    profile: ProfileRow | null,
    existing: RoutineWithStepsRow | null,
    forceRegenerate: boolean,
    requestId: string,
    initialData: {
      checkin: SkinCheckinRow | null;
      weather: WeatherRow | null;
      products: OwnedProductWithProductRow[];
    },
  ): Promise<{
    checkin: SkinCheckinRow | null;
    weather: WeatherRow | null;
    plan: RoutinePlan;
    decisionSnapshot: RoutineDecisionSnapshot;
  } | {
    reuseExisting: RoutineWithStepsRow;
    generationResult: "reused" | "retained_after_failure";
    explanation: string;
  }> {
    const { checkin, weather, products } = initialData;
    const maxSteps = period === "am"
      ? profile?.max_am_steps ?? 4
      : profile?.max_pm_steps ?? 5;
    const dailyCareNeeds = deriveRoutineDailyCareNeeds({
      routineDate,
      period,
      profile,
      checkin,
      weather,
      maxSteps,
    });
    logPlannerTiming("inventory_counts", Date.now(), {
      requestId,
      owned_product_count: products.length,
    });

    if (forceRegenerate || !existing) {
      logReuseDecision(requestId, "generate", [forceRegenerate ? "EXPLICIT_FORCE_REGENERATION" : "NO_EXISTING_ROUTINE"]);
    }
    if (!forceRegenerate && existing) {
      const reuseValidationStartedAt = Date.now();
      const reuse = await validateRoutineForEarlyReuse({
        userId,
        routineDate,
        period,
        profile,
        checkin,
        weather,
        products,
        existing,
        dailyCareNeeds,
        dependencies,
        requestId,
      });
      logPlannerTiming("reuse_validation", reuseValidationStartedAt, {
        requestId,
        valid: reuse.valid,
        reason_codes: reuse.reasonCodes,
      });
      logReuseDecision(requestId, reuse.valid ? "reuse" : "check_full_context", reuse.reasonCodes);
      if (reuse.valid) {
        return {
          reuseExisting: existing,
          generationResult: "reused",
          explanation: reuse.explanation,
        };
      }
    }

    const feedbackStatsPromise = timedPlannerStage("usage", requestId, () =>
      dependencies.usage.getRecentProductStats(
        userId,
        products.map((product) => product.id),
        routineDate,
        period,
      ));
    const routineRolePreferencesPromise = dependencies.usage.getRoutineRolePreferences(
      userId,
      period,
    );
    const personalMemoryPromise = timedPlannerStage("memory", requestId, () =>
      dependencies.personalMemory?.retrieveToday({
        period,
        concerns: skinMemoryTopics(checkin),
        baseline: profileMemoryBaseline(profile),
        priorities: dailyCareNeeds.priorities.map((priority) => priority.code),
      }) ?? Promise.resolve([]));
    const knowledgeEligibleProducts = products.filter((owned) =>
      productAssetStateExclusion(owned, routineDate) === null);
    const catalogProductIds = [...new Set(knowledgeEligibleProducts.flatMap((owned) =>
      owned.product.catalog_product_id ? [owned.product.catalog_product_id] : []))];
    const knowledgeBundlePromise = dependencies.todayProductKnowledge
      ? timedPlannerStage("full_knowledge_load", requestId, () =>
          dependencies.todayProductKnowledge!.load(catalogProductIds, { requestId }))
      : Promise.resolve<TodayProductKnowledgeReadBundle | null>(null);
    const [feedbackStats, routineRolePreferences, personalMemoryContext, knowledgeBundle] = await Promise.all([
      feedbackStatsPromise,
      routineRolePreferencesPromise,
      personalMemoryPromise,
      knowledgeBundlePromise,
    ]);
    const productSafety = knowledgeBundle
      ? buildProductSafetyContextFromBundle(profile, knowledgeBundle)
      : await timedPlannerStage("safety_total", requestId, () => buildProductSafetyContext({
            profile,
            products,
            knowledge: dependencies.knowledge,
            runtimeDraftIngredients: dependencies.runtimeDraftIngredients,
            requestId,
          }));
    // The legacy resolver belongs exclusively to deterministic fallback. A
    // valid Planner proposal must not pass through a second role/capability
    // projection before it is materialized.
    const buildFallbackPlan = async () => buildRoutinePlan({
      routineDate,
      period,
      checkin,
      weather,
      dailyCareNeeds,
      productSafety,
      decisionProfilesByProductId: await resolveDecisionProfiles(
        products,
        dependencies.productDecisions,
        knowledgeBundle?.runtimeKnowledgeByCatalogId,
      ),
      products,
      feedbackStats,
      maxSteps,
    });
    let plan: RoutinePlan;
    let plannerSnapshot: RoutineDecisionSnapshot["planner"] = {
      version: 1,
      generationSource: "deterministic_fallback",
      strategy: null,
      strategySummary: null,
      structuredDecision: null,
    };
    const plannerInputStartedAt = Date.now();
    const plannerBuild = await buildCarePlannerInput({ routineDate, period, checkin, profile, weather, products, productSafety, feedbackStats, plannerEvidence: dependencies.plannerEvidence, plannerEvidenceByCatalogId: knowledgeBundle?.plannerEvidenceByCatalogId, dailyCareNeeds, maxSteps, personalMemoryContext, routineRolePreferences, incumbentOwnedProductIds: new Set(existing?.steps.map((step) => step.owned_product_id) ?? []), requestId });
    const plannerInput = plannerBuild.input;
    const contextFingerprint = todayDecisionContextFingerprint({ routineDate, plannerInput });
    logPlannerTiming("planner_input_build", plannerInputStartedAt, {
      requestId, productCount: plannerInput.eligibleProducts.length,
    });
    logPlannerTiming("payload_assembly", plannerInputStartedAt, {
      requestId, productCount: plannerInput.eligibleProducts.length,
    });
    const sameFingerprint = existing !== null
      && storedTodayDecisionContextFingerprint(existing) === contextFingerprint;
    const reuseAllowed = !forceRegenerate;
    if (reuseAllowed && existing && sameFingerprint && existingRoutineCanBeRetained(existing, plannerInput)) {
      logReuseDecision(requestId, "reuse", ["FULL_DECISION_CONTEXT_STABLE"]);
      return {
        reuseExisting: existing,
        generationResult: "reused",
        explanation: "今天的皮肤状态和环境没有出现需要调整护理的明显变化，当前方案仍能覆盖主要需要，因此继续沿用这套搭配。",
      };
    }
    const providerStartedAt = Date.now();
    if (reuseAllowed && existing) {
      logReuseDecision(requestId, "generate", [sameFingerprint ? "CURRENT_ROUTINE_NOT_RETAINABLE" : "FULL_DECISION_CONTEXT_CHANGED"]);
    }
    const plannerAttempt = await dependencies.carePlanner?.planWithTrace(plannerInput) ?? { decision: null, failureReason: "CARE_PLANNER_NOT_CONFIGURED" };
    logPlannerTiming("planner_provider", providerStartedAt, { returnedDecision: Boolean(plannerAttempt.decision) });
    logPlannerTiming("provider", providerStartedAt, { requestId, returnedDecision: Boolean(plannerAttempt.decision) });
    if (plannerAttempt.decision) {
      const validatorStartedAt = Date.now();
      const validated = validateCarePlannerDecisionDetailed({
        decision: plannerAttempt.decision,
        candidates: plannerInput.eligibleProducts,
        careGuidanceIds: plannerInput.careGuidance.map((item) => item.guidanceId),
        hardRestrictions: plannerInput.hardRestrictions,
        maxSteps,
        skinSignals: plannerInput.skinSignals,
        weatherSignals: plannerInput.weather?.signals ?? [],
        period,
        consideredPurposes: [...new Set(
          [...dailyCareNeeds.requiredRoles, ...dailyCareNeeds.optionalRoles]
            .flatMap((role) => routineRoleToPurpose[role] ? [routineRoleToPurpose[role]!] : []),
        )],
        routineRolePreferences: plannerInput.routineRolePreferences,
      });
      logPlannerTiming("planner_validator", validatorStartedAt, validated.valid
        ? { status: validated.status }
        : {
          status: validated.status,
          rejectionCode: validated.reason,
          // A rejected decision is intentionally not persisted. Keep this
          // development diagnostic limited to the validation category; never
          // log product, profile, or provider payload data here.
          affectedPurpose: validated.affectedPurpose,
          affectedStepIndex: validated.affectedStepIndex,
        });
      logPlannerTiming("validator", validatorStartedAt, { requestId, status: validated.status });
      if (validated.valid) {
        plan = materializeValidatedPlannerPlan({
          routineDate,
          period,
          decision: validated.decision,
          productSafety,
          products,
          feedbackStats,
        });
        const selectedProductEvidence = snapshotSelectedProductEvidence(validated.decision, plannerBuild.fullCandidates);
        const narrationInput = buildTodayUserNarrativeInput({
          period,
          plannerInput: { ...plannerInput, eligibleProducts: plannerBuild.fullCandidates },
          decision: validated.decision,
          selectedProductEvidence,
        });
        const narrationStartedAt = Date.now();
        const consumerNarrative = await dependencies.careNarrative?.narrate(narrationInput) ?? null;
        logPlannerTiming("planner_user_narrative", narrationStartedAt, {
          generated: consumerNarrative !== null,
        });
        logPlannerTiming("narration", narrationStartedAt, { requestId, generated: consumerNarrative !== null });
        plannerSnapshot = { version: 1, generationSource: "llm", strategy: validated.decision.strategy, strategySummary: validated.decision.strategy_summary, structuredDecision: {
          ...validated.decision,
          contextFingerprint,
          inputProductCount: plannerInput.eligibleProducts.length,
          tierBEvidenceProductCount: plannerInput.eligibleProducts.filter((product) => product.productEvidence.evidenceRefs.length > 0).length,
          selectedProductEvidence,
          consumerNarrative,
          validatorStatus: validated.status,
          validatorWarnings: validated.warnings,
          droppedGuidanceIds: validated.droppedGuidanceIds,
          proposedSelectedSteps: validated.proposedDecision.selected_steps,
        } };
      } else {
        if (existing && existingRoutineCanBeRetained(existing, plannerInput)) {
          return {
            reuseExisting: existing,
            generationResult: "retained_after_failure",
            explanation: "这次重新规划没有完成；重新检查后，之前的方案仍符合当前安全和使用条件，因此暂时为你保留。",
          };
        }
        plan = await buildFallbackPlan();
        plannerSnapshot = { version: 1, generationSource: "deterministic_fallback", strategy: null, strategySummary: null, structuredDecision: {
          inputProductCount: plannerInput.eligibleProducts.length,
          tierBEvidenceProductCount: plannerInput.eligibleProducts.filter((product) => product.productEvidence.evidenceRefs.length > 0).length,
          validatorStatus: validated.status,
          validatorResult: validated.reason,
          validatorWarnings: validated.warnings,
          droppedGuidanceIds: validated.warnings.flatMap((warning) => warning.ids),
          usedGuidanceIds: validated.proposedDecision.usedGuidanceIds,
          proposedSelectedSteps: validated.proposedDecision.selected_steps,
          fallbackReason: "CARE_PLANNER_VALIDATION_REJECTED",
          contextFingerprint,
        } };
      }
    } else {
      if (forceRegenerate) {
        const retention = previousRoutineHardSafetyRetention({
          existing,
          products,
          productSafety,
          feedbackStats,
          routineDate,
          dailyCareNeeds,
        });
        logPreviousRoutineRetention(requestId, retention.reason);
        if (retention.reason === "retained") {
          return {
            reuseExisting: retention.routine,
            generationResult: "retained_after_failure",
            explanation: "这次重新规划没有完成；重新检查后，之前的方案仍符合当前安全和使用条件，因此暂时为你保留。",
          };
        }
        if (existing) {
          throw new RoutineRegenerationFailedError();
        }
      } else if (existing && existingRoutineCanBeRetained(existing, plannerInput)) {
        return {
          reuseExisting: existing,
          generationResult: "retained_after_failure",
          explanation: "这次重新规划没有完成；重新检查后，之前的方案仍符合当前安全和使用条件，因此暂时为你保留。",
        };
      }
      if (!forceRegenerate && !existing) {
        logPreviousRoutineRetention(requestId, "no_previous");
      }
      plan = await buildFallbackPlan();
      plannerSnapshot = { version: 1, generationSource: "deterministic_fallback", strategy: null, strategySummary: null, structuredDecision: { inputProductCount: plannerInput.eligibleProducts.length, tierBEvidenceProductCount: plannerInput.eligibleProducts.filter((product) => product.productEvidence.evidenceRefs.length > 0).length, validatorResult: "not_run", fallbackReason: plannerAttempt.failureReason, contextFingerprint } };
    }
    const decisionSnapshot = buildDecisionSnapshot(
      dailyCareNeeds,
      plan,
      plannerSnapshot,
      buildRoutineReuseContext({
        profile,
        maxSteps,
        skinSignals: plannerInput.skinSignals,
        weather,
        selectedOwnedProductIds: plan.steps.map((step) => step.owned_product_id),
        candidates: plannerBuild.fullCandidates,
        feedbackStats,
        routineRolePreferences,
      }),
    );
    return {
      checkin,
      weather,
      plan,
      decisionSnapshot,
    };
  }
}

function previousRoutineHardSafetyRetention(input: {
  existing: RoutineWithStepsRow | null;
  products: OwnedProductWithProductRow[];
  productSafety: ProductSafetyContext;
  feedbackStats: RuleContext["feedbackStats"];
  routineDate: string;
  dailyCareNeeds: DailyCareNeeds;
}): { reason: "retained"; routine: RoutineWithStepsRow } | { reason: Exclude<PreviousRoutineRetentionReason, "retained"> } {
  if (!input.existing) return { reason: "no_previous" };

  const currentProducts = new Map(input.products.map((product) => [product.id, product]));
  const safety = filterProductsForSafety({
    ...input.productSafety,
    products: input.products,
    routineDate: input.routineDate,
    feedbackStats: input.feedbackStats,
  });
  const safetyExclusions = new Map(
    safety.excludedProducts.map((excluded) => [excluded.ownedProductId, excluded.reason]),
  );
  const hardRestrictedRoles = new Set<string>(
    input.dailyCareNeeds.restrictions
      .filter((restriction) => restriction.severity === "hard")
      .flatMap((restriction) => restriction.appliesToRoles),
  );

  for (const step of input.existing.steps) {
    const product = currentProducts.get(step.owned_product_id);
    if (!product) {
      const previousAsset = step.owned_product;
      if (previousAsset?.archived_at || previousAsset?.status === "archived") return { reason: "archived" };
      if (previousAsset?.quantity_remaining_percent <= 0) return { reason: "quantity_zero" };
      if (previousAsset?.expires_on && previousAsset.expires_on < input.routineDate) return { reason: "expired" };
      if (previousAsset && previousAsset.status !== "active" && previousAsset.status !== "unopened") {
        return { reason: "unsafe_product" };
      }
      return { reason: "product_no_longer_owned" };
    }
    if (product.archived_at || product.status === "archived") return { reason: "archived" };
    if (product.quantity_remaining_percent <= 0) return { reason: "quantity_zero" };
    if (product.expires_on && product.expires_on < input.routineDate) return { reason: "expired" };
    if (hardRestrictedRoles.has(step.role)) return { reason: "hard_restricted" };

    const safetyReason = safetyExclusions.get(product.id);
    if (safetyReason === "PRODUCT_ARCHIVED") return { reason: "archived" };
    if (safetyReason === "PRODUCT_EMPTY") return { reason: "quantity_zero" };
    if (safetyReason === "PRODUCT_EXPIRED") return { reason: "expired" };
    if (safetyReason === "RECENT_HIGH_REACTION_HARD_BLOCK" || safetyReason === "AVOID_INGREDIENT_MATCH") {
      return { reason: "hard_restricted" };
    }
    if (safetyReason || product.product.category !== "skincare") return { reason: "unsafe_product" };
  }

  return { reason: "retained", routine: input.existing };
}

function existingRoutineIsUsable(existing: RoutineWithStepsRow) {
  return existing.status === "generated" && existing.steps.length > 0;
}

/**
 * A persisted decision is reusable only when the same deterministic Planner
 * input is still present. Memory is deliberately excluded: it is soft context
 * and must not cause a different routine merely because retrieval wording
 * changed.
 */
function todayDecisionContextFingerprint(input: {
  routineDate: string;
  plannerInput: CarePlannerInput;
}) {
  const deterministicInput = { ...input.plannerInput };
  delete deterministicInput.personalMemoryContext;
  return createHash("sha256")
    .update(stableStringify({ routineDate: input.routineDate, plannerInput: deterministicInput }))
    .digest("hex");
}

function storedTodayDecisionContextFingerprint(existing: RoutineWithStepsRow) {
  const snapshot = routineDecisionSnapshotSchema.safeParse(existing.decision_snapshot);
  if (!snapshot.success || !snapshot.data.planner?.structuredDecision || typeof snapshot.data.planner.structuredDecision !== "object" || Array.isArray(snapshot.data.planner.structuredDecision)) return null;
  const value = (snapshot.data.planner.structuredDecision as Record<string, unknown>).contextFingerprint;
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : null;
}

/**
 * This is a reuse guard, not a second Planner. It verifies that the saved
 * selection still belongs to today's safe candidate set and, when available,
 * asks the existing validator whether its old structured decision remains
 * valid under today's current hard restrictions and evidence.
 */
function existingRoutineCanBeRetained(
  existing: RoutineWithStepsRow,
  plannerInput: CarePlannerInput,
) {
  if (!existingRoutineIsUsable(existing) || existing.steps.length > plannerInput.maxSteps) return false;
  const candidates = new Map(plannerInput.eligibleProducts.map((candidate) => [candidate.ownedProductId, candidate]));
  if (existing.steps.some((step) => !candidates.has(step.owned_product_id))) return false;

  const snapshot = routineDecisionSnapshotSchema.safeParse(existing.decision_snapshot);
  const structured = snapshot.success ? snapshot.data.planner?.structuredDecision : null;
  if (!structured || typeof structured !== "object" || Array.isArray(structured)) return true;
  const decision = { ...(structured as Record<string, unknown>) };
  delete decision.contextFingerprint;
  const parsedDecision = carePlannerDecisionSchema.safeParse(decision);
  if (!parsedDecision.success) return true;

  return validateCarePlannerDecisionDetailed({
    decision: parsedDecision.data,
    candidates: plannerInput.eligibleProducts,
    careGuidanceIds: plannerInput.careGuidance.map((item) => item.guidanceId),
    hardRestrictions: plannerInput.hardRestrictions,
    maxSteps: plannerInput.maxSteps,
    skinSignals: plannerInput.skinSignals,
    weatherSignals: plannerInput.weather?.signals ?? [],
    period: plannerInput.period,
    consideredPurposes: [...new Set(
      [...(snapshot.data?.dailyCareNeeds.requiredRoles ?? []), ...(snapshot.data?.dailyCareNeeds.optionalRoles ?? [])]
        .flatMap((role) => routineRoleToPurpose[role] ? [routineRoleToPurpose[role]!] : []),
    )],
    routineRolePreferences: plannerInput.routineRolePreferences,
  }).valid;
}

type EarlyReuseValidation = {
  valid: boolean;
  reasonCodes: string[];
  explanation: string;
};

async function validateRoutineForEarlyReuse(input: {
  userId: string;
  routineDate: string;
  period: RoutinePeriod;
  profile: ProfileRow | null;
  checkin: SkinCheckinRow | null;
  weather: WeatherRow | null;
  products: OwnedProductWithProductRow[];
  existing: RoutineWithStepsRow;
  dailyCareNeeds: DailyCareNeeds;
  dependencies: RuleEngineDependencies;
  requestId: string;
}): Promise<EarlyReuseValidation> {
  const fail = (...reasonCodes: string[]): EarlyReuseValidation => ({
    valid: false,
    reasonCodes,
    explanation: "",
  });
  if (!existingRoutineIsUsable(input.existing)) return fail("ROUTINE_NOT_USABLE");
  const snapshot = routineDecisionSnapshotSchema.safeParse(input.existing.decision_snapshot);
  const saved = snapshot.success ? snapshot.data.reuseContext : undefined;
  if (!snapshot.success || !saved) return fail("PREVIOUS_CONTEXT_UNKNOWN");
  if (input.existing.steps.length > (input.period === "am" ? input.profile?.max_am_steps ?? 4 : input.profile?.max_pm_steps ?? 5)) {
    return fail("STEP_LIMIT_CHANGED");
  }
  if (saved.profileDecisionSignature !== profileDecisionSignature(input.profile, input.period)) {
    return fail("PROFILE_DECISION_CONTEXT_CHANGED");
  }

  const currentById = new Map(input.products.map((product) => [product.id, product]));
  const selectedProducts = input.existing.steps.flatMap((step) => {
    const product = currentById.get(step.owned_product_id);
    return product ? [product] : [];
  });
  if (selectedProducts.length !== input.existing.steps.length) return fail("SELECTED_PRODUCT_NOT_OWNED");

  const selectedIds = selectedProducts.map((product) => product.id);
  const catalogIds = [...new Set(selectedProducts.flatMap((product) =>
    product.product.catalog_product_id ? [product.product.catalog_product_id] : []))];
  let plannerEvidenceByCatalogId: ReadonlyMap<string, PlannerProductEvidence>;
  let productSafety: ProductSafetyContext;
  let feedbackStats: Map<string, ProductUsageStats>;
  let routineRolePreferences: RoutineRolePreference[];
  try {
    const knowledgePromise = input.dependencies.todayProductKnowledge
      ? input.dependencies.todayProductKnowledge.load(catalogIds, { requestId: `${input.requestId}:reuse` })
      : loadSelectedLegacyReuseKnowledge({
          catalogIds,
          selectedProducts,
          profile: input.profile,
          dependencies: input.dependencies,
          requestId: input.requestId,
        });
    const [knowledge, currentFeedbackStats, currentRoutineRolePreferences] = await Promise.all([
      knowledgePromise,
      input.dependencies.usage.getRecentProductStats(input.userId, selectedIds, input.routineDate, input.period),
      input.dependencies.usage.getRoutineRolePreferences(input.userId, input.period),
    ]);
    plannerEvidenceByCatalogId = knowledge.plannerEvidenceByCatalogId;
    productSafety = "productSafety" in knowledge
      ? knowledge.productSafety
      : buildProductSafetyContextFromBundle(input.profile, knowledge);
    feedbackStats = currentFeedbackStats;
    routineRolePreferences = currentRoutineRolePreferences;
  } catch {
    return fail("REUSE_VALIDATION_DATA_UNAVAILABLE");
  }

  const safety = filterProductsForSafety({
    ...productSafety,
    products: selectedProducts,
    routineDate: input.routineDate,
    feedbackStats,
  });
  if (safety.excludedProducts.length > 0) {
    return fail(...safety.excludedProducts.map((excluded) => excluded.reason));
  }

  const hardRestrictedRoles = new Set(
    input.dailyCareNeeds.restrictions
      .filter((restriction) => restriction.severity === "hard")
      .flatMap((restriction) => restriction.appliesToRoles),
  );
  if (input.existing.steps.some((step) => hardRestrictedRoles.has(step.role as RoutineRole))) {
    return fail("CURRENT_STEP_HARD_RESTRICTED");
  }
  if (input.existing.steps.some((step) => roleOrder[input.period][step.role as RoutineRole] === undefined)) {
    return fail("CURRENT_STEP_PERIOD_INELIGIBLE");
  }
  if (!routineCoversDailyCareNeeds(input.existing, input.dailyCareNeeds)) {
    return fail("CURRENT_CARE_NEEDS_NOT_COVERED");
  }

  const currentSkinSignals = semanticSkinSignals(buildPlannerSkinSignals(input.checkin, input.profile));
  if (stableStringify(currentSkinSignals) !== stableStringify(saved.skinDecisionSignals)) {
    return fail("MEANINGFUL_DAILY_SKIN_CHANGE");
  }
  const currentWeatherBuckets = weatherDecisionBuckets(input.weather);
  if (
    currentWeatherBuckets.temperature !== saved.weatherDecisionBuckets.temperature
    || currentWeatherBuckets.humidity !== saved.weatherDecisionBuckets.humidity
  ) {
    return fail("MEANINGFUL_WEATHER_CHANGE");
  }
  if (
    currentWeatherBuckets.uv !== saved.weatherDecisionBuckets.uv
    && !routineCoversDailyCareNeeds(input.existing, input.dailyCareNeeds)
  ) {
    return fail("UV_COVERAGE_CHANGED");
  }

  const savedProducts = new Map(saved.selectedProducts.map((product) => [product.ownedProductId, product]));
  for (const product of selectedProducts) {
    const previous = savedProducts.get(product.id);
    if (!previous) return fail("SELECTED_PRODUCT_CONTEXT_UNKNOWN");
    const evidence = product.product.catalog_product_id
      ? plannerEvidenceByCatalogId.get(product.product.catalog_product_id) ?? emptyPlannerProductEvidence()
      : emptyPlannerProductEvidence();
    if (previous.decisionSignature !== selectedProductDecisionSignature(product, evidence)) {
      return fail("SELECTED_PRODUCT_KNOWLEDGE_CHANGED");
    }
    if (previous.usageSignature !== usageDecisionSignature(feedbackStats.get(product.id))) {
      return fail("SELECTED_PRODUCT_USAGE_CHANGED");
    }
  }
  if (saved.selectedProducts.length !== selectedProducts.length) return fail("SELECTED_PRODUCT_SET_CHANGED");
  if (saved.routineRolePreferencesSignature !== routineRolePreferencesSignature(routineRolePreferences)) {
    return fail("ROUTINE_ROLE_PREFERENCE_CHANGED");
  }

  const rawWeatherChanged = stableStringify(input.existing.weather_snapshot) !== stableStringify(snapshotValue(input.weather));
  const rawSkinChanged = stableStringify(input.existing.skin_snapshot) !== stableStringify(snapshotValue(input.checkin));
  const explanation = rawWeatherChanged
    ? "今天的环境数值有所变化，但没有改变当前护理需要，现有步骤仍能覆盖今天的重点，因此不需要更换产品。"
    : rawSkinChanged
      ? "今天的皮肤状态有轻微变化，但当前方案仍能覆盖主要护理需要，因此继续沿用这套搭配。"
      : "今天的皮肤状态和环境没有出现需要调整护理的明显变化，当前方案仍能覆盖主要需要，因此继续沿用这套搭配。";
  return {
    valid: true,
    reasonCodes: rawWeatherChanged
      ? ["WEATHER_CHANGED_WITHIN_DECISION_CONTEXT", "CURRENT_ROUTINE_COVERS_NEEDS"]
      : rawSkinChanged
        ? ["SKIN_CHANGED_WITHIN_DECISION_CONTEXT", "CURRENT_ROUTINE_COVERS_NEEDS"]
        : ["DECISION_CONTEXT_STABLE", "CURRENT_ROUTINE_COVERS_NEEDS"],
    explanation,
  };
}

async function loadSelectedLegacyReuseKnowledge(input: {
  catalogIds: string[];
  selectedProducts: OwnedProductWithProductRow[];
  profile: ProfileRow | null;
  dependencies: RuleEngineDependencies;
  requestId: string;
}) {
  const plannerEvidenceByCatalogId = new Map<string, PlannerProductEvidence>();
  if (input.catalogIds.length > 0 && !input.dependencies.plannerEvidence) {
    throw new Error("SELECTED_PRODUCT_KNOWLEDGE_UNKNOWN");
  }
  await Promise.all(input.catalogIds.map(async (catalogId) => {
    const evidence = await input.dependencies.plannerEvidence!.findByCatalogProductId(
      catalogId,
      { requestId: `${input.requestId}:reuse` },
    );
    plannerEvidenceByCatalogId.set(catalogId, evidence);
  }));
  const productSafety = await buildProductSafetyContext({
    profile: input.profile,
    products: input.selectedProducts,
    knowledge: input.dependencies.knowledge,
    runtimeDraftIngredients: input.dependencies.runtimeDraftIngredients,
    requestId: `${input.requestId}:reuse`,
  });
  return { plannerEvidenceByCatalogId, productSafety };
}

function buildRoutineReuseContext(input: {
  profile: ProfileRow | null;
  maxSteps: number;
  skinSignals: CarePlannerInput["skinSignals"];
  weather: WeatherRow | null;
  selectedOwnedProductIds: string[];
  candidates: CarePlannerInput["eligibleProducts"];
  feedbackStats: Map<string, ProductUsageStats>;
  routineRolePreferences: RoutineRolePreference[];
}): NonNullable<RoutineDecisionSnapshot["reuseContext"]> {
  const candidates = new Map(input.candidates.map((candidate) => [candidate.ownedProductId, candidate]));
  return {
    version: 1,
    profileDecisionSignature: profileDecisionSignatureFromValues(input.profile, input.maxSteps),
    skinDecisionSignals: semanticSkinSignals(input.skinSignals),
    weatherDecisionBuckets: weatherDecisionBuckets(input.weather),
    selectedProducts: [...new Set(input.selectedOwnedProductIds)].flatMap((ownedProductId) => {
      const candidate = candidates.get(ownedProductId);
      if (!candidate) return [];
      return [{
        ownedProductId,
        decisionSignature: hashDecisionValue({
          productType: candidate.productType,
          productEvidence: candidate.productEvidence,
        }),
        usageSignature: usageDecisionSignature(input.feedbackStats.get(ownedProductId)),
      }];
    }).sort((left, right) => left.ownedProductId.localeCompare(right.ownedProductId)),
    routineRolePreferencesSignature: routineRolePreferencesSignature(input.routineRolePreferences),
  };
}

function profileDecisionSignature(profile: ProfileRow | null, period: RoutinePeriod) {
  const maxSteps = period === "am" ? profile?.max_am_steps ?? 4 : profile?.max_pm_steps ?? 5;
  return profileDecisionSignatureFromValues(profile, maxSteps);
}

function profileDecisionSignatureFromValues(profile: ProfileRow | null, maxSteps: number) {
  return hashDecisionValue(profile ? {
    skinType: profile.skin_type,
    sensitivityLevel: profile.sensitivity_level,
    goals: [...profile.goals].sort(),
    allergies: [...profile.allergies].sort(),
    avoidIngredients: [...profile.avoid_ingredients].sort(),
    texturePreferences: [...profileTexturePreferences(profile)].sort(),
    maxSteps,
  } : null);
}

function selectedProductDecisionSignature(product: OwnedProductWithProductRow, evidence: PlannerProductEvidence) {
  return hashDecisionValue({
    productType: evidence.productType ?? product.product.product_type,
    productEvidence: evidence,
  });
}

function usageDecisionSignature(feedback: ProductUsageStats | undefined) {
  const usage = plannerUsageHistory(feedback);
  return hashDecisionValue({
    rating: usage.averageRating === null ? null : usage.averageRating < 3 ? "negative" : usage.averageRating < 4 ? "neutral" : "positive",
    positiveSignals: usage.positiveSignals,
    preferenceIssues: usage.preferenceIssues,
    highReactionCount: usage.highReactionCount,
    summary: usage.recentRelevantFeedbackSummary,
  });
}

function routineRolePreferencesSignature(preferences: RoutineRolePreference[]) {
  return hashDecisionValue([...preferences].sort((left, right) =>
    `${left.period}:${left.routine_role}:${left.polarity}`.localeCompare(`${right.period}:${right.routine_role}:${right.polarity}`)));
}

function semanticSkinSignals(signals: CarePlannerInput["skinSignals"]) {
  return signals.map((signal) => [
    signal.signalId,
    signal.status,
    signal.source,
    signal.comparison ?? "",
  ].join("|")).sort();
}

function weatherDecisionBuckets(weather: WeatherRow | null): NonNullable<RoutineDecisionSnapshot["reuseContext"]>["weatherDecisionBuckets"] {
  return {
    temperature: weather?.temperature === null || weather?.temperature === undefined
      ? "unknown"
      : weather.temperature < 10 ? "cold" : weather.temperature > 30 ? "hot" : "mild",
    humidity: weather?.humidity === null || weather?.humidity === undefined
      ? "unknown"
      : weather.humidity < 40 ? "dry" : weather.humidity > 70 ? "humid" : "balanced",
    uv: weather?.uv_index === null || weather?.uv_index === undefined
      ? "unknown"
      : weather.uv_index >= 6 ? "high" : "low_medium",
  };
}

function routineCoversDailyCareNeeds(existing: RoutineWithStepsRow, needs: DailyCareNeeds) {
  const roles = new Set(existing.steps.map((step) => step.role as RoutineRole));
  if (needs.requiredRoles.some((role) => !roles.has(role))) return false;
  const hardRestrictedRoles = new Set(needs.restrictions
    .filter((restriction) => restriction.severity === "hard")
    .flatMap((restriction) => restriction.appliesToRoles));
  if (existing.steps.some((step) => hardRestrictedRoles.has(step.role as RoutineRole))) return false;
  return needs.priorities.every((priority) => priority.code === "sun_protection"
    ? roles.has("sunscreen")
    : existing.steps.some((step) => priorityBonus(priority.code, step.role as RoutineRole) > 0));
}

function hashDecisionValue(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function snapshotValue(value: SkinCheckinRow | WeatherRow | null): Json {
  return value ? JSON.parse(JSON.stringify(value)) as Json : {};
}

function resolvedRoleForProduct(
  owned: OwnedProductWithProductRow,
  context: RuleContext,
): RoutineRole | undefined {
  return context.decisionProfilesByProductId
    ?.get(owned.product_id)
    ?.primary_role
    ?? legacyRoleByProductTypeFallback[owned.product.product_type];
}

function buildPlannerSkinSignals(
  checkin: SkinCheckinRow | null,
  profile: ProfileRow | null,
): CarePlannerInput["skinSignals"] {
  const effectiveState = checkin && profile?.long_term_skin_baseline
    ? buildEffectiveDailySkinState({ checkin: checkin as unknown as SkinCheckin, profile: { long_term_skin_baseline: profile.long_term_skin_baseline } as never })
    : null;
  const effectiveItems = effectiveState?.items ?? (profile?.long_term_skin_baseline
    ? baselineSpecs({ long_term_skin_baseline: profile.long_term_skin_baseline } as never).map((item) => ({
        ...item,
        status: "present" as const,
        baselineComparison: null,
        provenance: "baseline_inherited" as const,
      }))
    : []);
  return effectiveItems.flatMap((item) => {
    if (item.provenance === "unknown") return [];
    return [{
      signalId: `skin:${item.provenance}:${item.concern}:${item.area}`,
      concern: item.concern,
      area: item.area,
      status: item.status,
      grade: item.grade,
      source: item.provenance,
      comparison: item.baselineComparison ?? null,
    }];
  });
}

async function buildCarePlannerInput({
  routineDate, period, checkin, profile, weather, products, productSafety, feedbackStats, plannerEvidence, plannerEvidenceByCatalogId, dailyCareNeeds, maxSteps, personalMemoryContext = [], routineRolePreferences = [], incumbentOwnedProductIds = new Set<string>(), requestId,
}: {
  routineDate: string; period: RoutinePeriod; checkin: SkinCheckinRow | null; profile: ProfileRow | null; weather: WeatherRow | null;
  products: OwnedProductWithProductRow[]; productSafety: ProductSafetyContext; feedbackStats: RuleContext["feedbackStats"]; plannerEvidence: RuleEngineDependencies["plannerEvidence"]; personalMemoryContext?: string[]; routineRolePreferences?: CarePlannerInput["routineRolePreferences"];
  plannerEvidenceByCatalogId?: ReadonlyMap<string, PlannerProductEvidence>;
  incumbentOwnedProductIds?: ReadonlySet<string>;
  dailyCareNeeds: DailyCareNeeds; maxSteps: number; requestId: string;
}): Promise<{ input: CarePlannerInput; fullCandidates: CarePlannerInput["eligibleProducts"] }> {
  const skinSignals = buildPlannerSkinSignals(checkin, profile);
  const effectiveSkinState = skinSignals;
  const dailyDelta = skinSignals.filter((item) =>
    item.source !== "baseline_inherited"
    && ["more_than_usual", "less_than_usual", "new"].includes(item.comparison ?? ""),
  );
  const unknowns = dailyCareNeeds.unknowns.map((item) => item.code);
  const weatherContext = weather ? {
    temperature: weather.temperature,
    humidity: weather.humidity,
    uvIndex: weather.uv_index,
    weatherCode: weather.weather_code,
    source: "today_weather_context" as const,
    signals: [
      ...(weather.temperature === null ? [] : [{ signalId: "weather:temperature", metric: "temperature_c" as const, value: weather.temperature }]),
      ...(weather.humidity === null ? [] : [{ signalId: "weather:humidity", metric: "humidity_percent" as const, value: weather.humidity }]),
      ...(weather.uv_index === null ? [] : [{ signalId: "weather:uv_index", metric: "uv_index" as const, value: weather.uv_index }]),
      ...(weather.weather_code === null ? [] : [{ signalId: "weather:condition", metric: "weather_code" as const, value: weather.weather_code }]),
    ],
  } : null;
  const safeProducts = filterProductsForSafety({ ...productSafety, products, routineDate, feedbackStats }).eligibleProducts;
  const evidenceStartedAt = Date.now();
  const evidenceByCatalogId = new Map<string, Promise<PlannerProductEvidence | null>>();
  const evidenceForOwnedProduct = (owned: OwnedProductWithProductRow) => {
    const catalogProductId = owned.product.catalog_product_id;
    if (!catalogProductId) return Promise.resolve(null);
    if (plannerEvidenceByCatalogId) {
      return Promise.resolve(plannerEvidenceByCatalogId.get(catalogProductId) ?? null);
    }
    if (!plannerEvidence) return Promise.resolve(null);
    const existing = evidenceByCatalogId.get(catalogProductId);
    if (existing) return existing;
    const pending = plannerEvidence.findByCatalogProductId(catalogProductId, { requestId });
    evidenceByCatalogId.set(catalogProductId, pending);
    return pending;
  };
  const evidenceByOwnedId = new Map(await Promise.all(safeProducts.map(async (owned) => {
    const evidence = await evidenceForOwnedProduct(owned);
    return [owned.id, evidence] as const;
  })));
  logPlannerTiming("planner_product_evidence", evidenceStartedAt, {
    safeProductCount: safeProducts.length,
    requestId, catalogProductCount: evidenceByCatalogId.size,
  });
  const plannerProducts = safeProducts.filter((owned) =>
    owned.product.category === "skincare" || evidenceByOwnedId.get(owned.id)?.usableSkincareEvidence,
  );
  const guidanceStartedAt = Date.now();
  const careGuidance = retrieveCareGuidance({ effectiveSkinState, dailyDelta, period, weather: weatherContext, unknowns });
  logPlannerTiming("care_guidance_retrieval", guidanceStartedAt, { guidanceCount: careGuidance.length });
  const allPlannerCandidates: CarePlannerInput["eligibleProducts"] = plannerProducts.map((owned) => {
    const productEvidence = evidenceByOwnedId.get(owned.id) ?? emptyPlannerProductEvidence();
    const baselineTypeBackedPurposes = baselineTypeBackedPurposesFor(owned, productEvidence);
    return {
      ownedProductId: owned.id,
      displayName: [owned.product.brand_name, owned.product.product_name].filter(Boolean).join(" · "),
      productType: productEvidence.productType ?? owned.product.product_type,
      productEvidence,
      knownFacts: productEvidence.knownFacts,
      unknownFields: productEvidence.unknownFields,
      limitations: productEvidence.limitations,
      supportedPurposes: productEvidence.supportedPurposes,
      baselineTypeBackedPurposes,
      inventory: { quantityPercent: owned.quantity_remaining_percent },
      usageHistory: plannerUsageHistory(feedbackStats.get(owned.id)),
    };
  });
  const candidateRetrievalStartedAt = Date.now();
  const shortlist = shortlistCarePlannerCandidates({
    candidates: allPlannerCandidates,
    period,
    dailyCareNeeds,
    incumbentOwnedProductIds,
    texturePreferences: profileTexturePreferences(profile),
  });
  logPlannerTiming("candidate_retrieval", candidateRetrievalStartedAt, {
    requestId,
    eligible_product_count: allPlannerCandidates.length,
    shortlisted_product_count: shortlist.candidates.length,
    capability_gap_count: shortlist.gaps.length,
  });
  const compactProjectionStartedAt = Date.now();
  const compactCandidates = compactPlannerCandidates({
    candidates: shortlist.candidates,
    purposesByOwnedProductId: shortlist.purposesByOwnedProductId,
    dailyCareNeeds,
    period,
  });
  logPlannerTiming("compact_projection", compactProjectionStartedAt, {
    requestId,
    shortlisted_product_count: compactCandidates.length,
  });

  return { fullCandidates: allPlannerCandidates, input: {
    period,
    softPersonalization: {
      texturePreferences: profileTexturePreferences(profile),
      skinGoals: profileSkinGoals(profile),
    },
    routineRolePreferences: routineRolePreferences.map((preference) => ({
      ...preference,
      preferenceRef: `routine_role:${preference.period}:${preference.routine_role}`,
    })),
    personalMemoryContext: personalMemoryContext.slice(0, 5),
    effectiveSkinState,
    dailyDelta,
    longTermBaseline: skinSignals.filter((item) => item.source === "baseline_inherited"),
    todayConfirmed: skinSignals.filter((item) => item.source === "today_confirmed"),
    manualOverrides: skinSignals.filter((item) => item.source === "manual_override"),
    todaySkin: skinSignals.filter((item) => item.source !== "baseline_inherited"),
    longTermContext: {
      skinType: profile?.skin_type ?? null,
      relevantBaseline: skinSignals.filter((item) => item.source === "baseline_inherited").slice(0, 5),
    },
    weather: weatherContext,
    recentHistory: [],
    purposeContext: {
      hasOilinessContext: effectiveSkinState.some((item) => item.status === "present" && item.concern === "oiliness"),
      hasDrynessOrFlakingContext: effectiveSkinState.some((item) => item.status === "present" && (item.concern === "dryness" || item.concern === "flaking")),
    },
    skinSignals,
    eligibleProducts: compactCandidates,
    hardRestrictions: dailyCareNeeds.restrictions.filter((item) => item.severity === "hard").map((item) => item.code),
    unknowns,
    careGuidance,
    baselineRoles: baselinePurposesForPlanner[period].map((purpose) => purposeToRoutineRole[purpose]),
    dailyPriorities: dailyCareNeeds.priorities.map((item) => item.code),
    maxSteps,
  } };
}

export function baselineTypeBackedPurposesFor(
  owned: OwnedProductWithProductRow,
  evidence: PlannerProductEvidence,
): CareStepPurpose[] {
  // Unknown/manual assets may carry a user-entered type. Only an identity that
  // was confirmed through the existing Catalog or signed external flow and is
  // anchored to a Catalog record may receive this deliberately narrow grace.
  if (owned.product.identity_status !== "matched" || !owned.product.catalog_product_id) return [];
  if (evidence.productType && evidence.productType !== owned.product.product_type) return [];
  if (owned.product.product_type === "cleanser" && !evidence.supportedPurposes.includes("cleansing")) {
    return ["cleansing"];
  }
  if (owned.product.product_type === "moisturizer" && !evidence.supportedPurposes.includes("basic_moisturization")) {
    return ["basic_moisturization"];
  }
  return [];
}

function logPlannerTiming(stage: string, startedAt: number, details: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV !== "development") return;
  console.info("[today-care-planner]", {
    stage,
    durationMs: Date.now() - startedAt,
    ...details,
  });
}

function logPreviousRoutineRetention(
  requestId: string,
  reason: PreviousRoutineRetentionReason,
) {
  console.info("[today-care-planner]", {
    stage: "previous_routine_retention",
    requestId,
    reason,
  });
}

async function resolveDecisionProfiles(
  products: OwnedProductWithProductRow[],
  resolver: ProductDecisionResolverService | undefined,
  knowledgeByCatalogId?: ReadonlyMap<string, import("@/server/services/product-knowledge-runtime-availability-service").RuntimeAvailableProductKnowledge>,
): Promise<ReadonlyMap<string, ProductDecisionProfile>> {
  if (knowledgeByCatalogId) {
    return new Map(products.map((owned) => {
      const product = {
        id: owned.product.id,
        product_type: owned.product.product_type as ProductType,
        catalog_product_id: owned.product.catalog_product_id,
      };
      return [product.id, resolveProductDecisionProfile({
        product,
        knowledge: product.catalog_product_id
          ? knowledgeByCatalogId.get(product.catalog_product_id) ?? null
          : null,
      })] as const;
    }));
  }
  if (!resolver) return new Map();

  try {
    const profiles = await resolver.resolveMany(products.map((owned) => ({
      id: owned.product.id,
      product_type: owned.product.product_type as ProductType,
      catalog_product_id: owned.product.catalog_product_id,
    })));
    return new Map(profiles.map((profile) => [profile.product_id, profile]));
  } catch {
    // Product understanding is an optional enrichment. A resolver failure
    // preserves the existing product_type fallback for the entire plan.
    return new Map();
  }
}

/**
 * Captures only the Tier-B facts that the validated selection actually cited.
 * This is a generation-time explanation snapshot, not a second knowledge
 * projection: facts are read exclusively from the candidate already supplied
 * to the Planner, and never from LLM prose.
 */
function snapshotSelectedProductEvidence(
  decision: CarePlannerDecision,
  candidates: CarePlannerInput["eligibleProducts"],
) {
  const candidateByOwnedId = new Map(candidates.map((candidate) => [candidate.ownedProductId, candidate]));
  const fitByOwnedId = new Map(decision.productFitAssessments.selected.map((fit) => [fit.ownedProductId, fit]));
  return decision.selected_steps.flatMap((step) => {
    const candidate = candidateByOwnedId.get(step.ownedProductId);
    if (!candidate) return [];

    const allowedRefs = new Set([
      ...step.evidence_refs,
      ...(fitByOwnedId.get(step.ownedProductId)?.relevantEvidenceRefs ?? []),
    ]);
    const belongsToSelection = (refs: string[]) => refs.some((ref) => allowedRefs.has(ref));
    const evidence = candidate.productEvidence;
    const usage = evidence.usage;
    const usageIsRelevant = usage !== null && belongsToSelection(usage.evidenceRefs);

    return [{
      ownedProductId: step.ownedProductId,
      purpose: step.purpose,
      productType: evidence.productType,
      relevantClaims: evidence.claims
        .filter((claim) => belongsToSelection(claim.evidenceRefs))
        .map((claim) => claim.text)
        .slice(0, 3),
      relevantTextureFacts: evidence.texture && belongsToSelection(evidence.texture.evidenceRefs)
        ? [evidence.texture.description]
        : [],
      relevantUsageFacts: usageIsRelevant ? usage?.instructions.slice(0, 2) ?? [] : [],
      relevantCautions: usageIsRelevant ? usage?.cautions.slice(0, 2) ?? [] : [],
      // Advisory ingredient mentions are presentation/fit context only. They
      // were already separated from hard ingredient facts by the Planner
      // evidence projection and are never read by product safety.
      relevantAdvisoryIngredients: (evidence.advisoryIngredients ?? [])
        .filter((ingredient) => belongsToSelection(ingredient.evidenceRefs))
        .map((ingredient) => ingredient.name)
        .slice(0, 2),
      // Pack facts are attached only to an ingredient actually present in this
      // candidate. They remain advisory product-fit context, never safety.
      relevantIngredientKnowledge: (evidence.ingredientKnowledge ?? []).slice(0, 5),
      // This is a display projection only. Raw advisory mentions stay in the
      // audit snapshot above; consumer copy receives no English INCI or base.
      relevantConsumerIngredients: consumerIngredientDisplayNames(
        (evidence.advisoryIngredients ?? [])
          .filter((ingredient) => belongsToSelection(ingredient.evidenceRefs))
          .map((ingredient) => ingredient.name),
      ),
    }];
  });
}

function buildTodayUserNarrativeInput(input: {
  period: RoutinePeriod;
  plannerInput: CarePlannerInput;
  decision: CarePlannerDecision;
  selectedProductEvidence: Array<{
    ownedProductId: string; purpose: string; productType: ProductType | null;
    relevantClaims: string[]; relevantTextureFacts: string[]; relevantUsageFacts: string[];
    relevantCautions: string[]; relevantAdvisoryIngredients: string[]; relevantConsumerIngredients: string[];
    relevantIngredientKnowledge: Array<{ canonicalName: string; displayNameZh: string; functions: string[]; statementZh: string; boundaries: string[] }>;
  }>;
}): TodayUserNarrativeInput {
  const evidenceByOwnedId = new Map(input.selectedProductEvidence.map((evidence) => [evidence.ownedProductId, evidence]));
  const candidateByOwnedId = new Map(input.plannerInput.eligibleProducts.map((candidate) => [candidate.ownedProductId, candidate]));
  const fitByOwnedId = new Map(input.decision.productFitAssessments.selected.map((fit) => [fit.ownedProductId, fit]));
  const selectedRationaleText = input.decision.selected_steps.flatMap((step) => [
    step.why_today,
    step.why_this_product,
    ...(step.selection_rationale?.relevantDifferences ?? []),
    step.selection_rationale?.whySelectedToday ?? "",
  ]).join(" ");
  return {
    period: input.period,
    softPersonalization: consumerNarrativeSoftPersonalization(
      input.plannerInput.softPersonalization,
      selectedRationaleText,
      input.selectedProductEvidence.flatMap((evidence) => evidence.relevantTextureFacts),
    ),
    purposeOmissions: input.decision.purposeOmissions ?? [],
    steps: input.decision.selected_steps.flatMap((step) => {
      const candidate = candidateByOwnedId.get(step.ownedProductId);
      const evidence = evidenceByOwnedId.get(step.ownedProductId);
      const fit = fitByOwnedId.get(step.ownedProductId);
      if (!candidate || !evidence) return [];
      const selectionRationale = selectionRationaleFor(
        step,
        input.decision.candidateComparisons ?? [],
        candidateByOwnedId,
      );
      const rationaleText = [
        step.why_today,
        step.why_this_product,
        ...(step.selection_rationale?.relevantDifferences ?? []),
        step.selection_rationale?.whySelectedToday ?? "",
      ].join(" ");
      return [{
        ownedProductId: step.ownedProductId,
        productName: candidate.displayName,
        purpose: step.purpose,
        baselineTypeBackedPurpose: candidate.baselineTypeBackedPurposes?.includes(step.purpose as CareStepPurpose) ?? false,
        whyToday: step.why_today,
        whyThisProduct: consumerDecisionRationale([step.why_this_product]).join("；")
          || "这瓶是本次已验证选择。",
        relevantSkinContext: consumerNarrativeSkinContext(
          fit?.relevantSkinSignals ?? [],
          input.plannerInput.skinSignals,
        ),
        relevantWeatherContext: consumerNarrativeWeatherContext(
          fit?.relevantWeatherSignals ?? [],
          input.plannerInput.weather,
        ),
        recentExperience: consumerNarrativeRecentExperience(candidate.usageHistory, rationaleText),
        relevantMemoryContext: consumerNarrativeMemoryContext(
          input.plannerInput.personalMemoryContext ?? [],
          rationaleText,
        ),
        relevantRoutineRolePreferences: (input.plannerInput.routineRolePreferences ?? []).flatMap((preference) =>
          (step.preference_refs ?? []).includes(preference.preferenceRef ?? "")
            ? [{ scope: preference.scope, period: preference.period, routine_role: preference.routine_role, polarity: preference.polarity }]
            : []),
        productFacts: {
          productType: consumerProductTypeLabel(candidate.productType),
          capabilities: consumerCapabilityLabels(candidate.supportedPurposes, step.purpose as CareStepPurpose),
          claims: evidence.relevantClaims,
          texture: evidence.relevantTextureFacts,
          usage: evidence.relevantUsageFacts,
          cautions: evidence.relevantCautions,
          consumerIngredients: evidence.relevantConsumerIngredients,
          ingredientKnowledge: evidence.relevantIngredientKnowledge.map((fact) => ({
            displayNameZh: fact.displayNameZh,
            functions: fact.functions,
            statementZh: fact.statementZh,
            boundaries: fact.boundaries,
          })),
        },
        selectionRationale,
      }];
    }),
  };
}

function buildProductSafetyContextFromBundle(
  profile: ProfileRow | null,
  bundle: TodayProductKnowledgeReadBundle,
): ProductSafetyContext {
  return {
    assessIngredients: true,
    avoidIngredients: [...(profile?.avoid_ingredients ?? [])],
    ingredientDataByCatalogProductId: bundle.safetyIngredientsByCatalogId,
  };
}

// Available in production too: opaque request id and reason codes only, never
// skin records, product facts, prompts, or personal-memory contents.
function logReuseDecision(requestId: string, action: "reuse" | "generate" | "check_full_context", reasonCodes: string[]) {
  console.info("[today-care-planner]", { stage: "reuse_decision", requestId, action, reason_codes: reasonCodes });
}

async function timedPlannerStage<T>(
  stage: string,
  requestId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await operation();
  } finally {
    logPlannerTiming(stage, startedAt, { requestId });
  }
}

function consumerNarrativeSoftPersonalization(
  value: CarePlannerInput["softPersonalization"],
  rationaleText: string,
  selectedTextures: string[],
) {
  const textureLabels: Record<string, string> = { lightweight: "轻薄", rich: "滋润", gel: "啫喱", cream: "面霜", lotion: "乳液", oil: "油润" };
  const goalLabels: Record<string, string> = { hydration: "补水保湿", barrier_support: "屏障维护", oil_control: "控油", blemish_care: "痘痘护理", redness_relief: "泛红舒缓", brightening: "提亮肤色", dark_spots: "淡化色沉", anti_aging: "抗老" };
  const textureContext = `${rationaleText} ${selectedTextures.join(" ")}`;
  return {
    texturePreferences: value.texturePreferences.flatMap((preference) => {
      const label = textureLabels[preference];
      return label && semanticallyRelated(label, textureContext) ? [label] : [];
    }),
    skinGoals: value.skinGoals.flatMap((goal) => {
      const label = goalLabels[goal];
      return label && semanticallyRelated(label, rationaleText) ? [label] : [];
    }),
  };
}

function consumerNarrativeRecentExperience(
  value: CarePlannerInput["eligibleProducts"][number]["usageHistory"],
  rationaleText: string,
) {
  const positiveSignals = value.positiveSignals.filter((signal) => semanticallyRelated(signal, rationaleText)).slice(0, 2);
  const preferenceIssues = value.preferenceIssues.filter((issue) => semanticallyRelated(issue, rationaleText)).slice(0, 2);
  return {
    positiveSignals,
    preferenceIssues,
    summary: value.recentRelevantFeedbackSummary
      && (positiveSignals.length > 0
        || preferenceIssues.length > 0
        || semanticallyRelated(value.recentRelevantFeedbackSummary, rationaleText))
      ? value.recentRelevantFeedbackSummary
      : null,
  };
}

function consumerNarrativeSkinContext(
  relevantSignalIds: string[],
  signals: CarePlannerInput["skinSignals"],
): TodayUserNarrativeInput["steps"][number]["relevantSkinContext"] {
  const allowed = new Set(relevantSignalIds);
  return signals.flatMap((signal) => allowed.has(signal.signalId) ? [{
    concern: signal.concern,
    area: signal.area,
    timeframe: signal.source === "baseline_inherited" ? "baseline" as const : "today" as const,
    comparison: signal.comparison,
  }] : []);
}

function consumerNarrativeWeatherContext(
  relevantSignalIds: string[],
  weather: CarePlannerInput["weather"],
): TodayUserNarrativeInput["steps"][number]["relevantWeatherContext"] {
  if (!weather || relevantSignalIds.length === 0) return [];
  const allowed = new Set(relevantSignalIds);
  const labels = {
    temperature_c: "温度",
    humidity_percent: "湿度",
    uv_index: "紫外线指数",
    weather_code: "天气状况",
  } as const;
  return weather.signals.flatMap((signal) => allowed.has(signal.signalId)
    ? [{ metric: labels[signal.metric], value: signal.value }]
    : []);
}

function consumerNarrativeMemoryContext(values: string[], rationaleText: string) {
  return values.filter((value) => semanticallyRelated(value, rationaleText)).slice(0, 2);
}

const semanticGroups = [
  ["轻薄", "清爽", "不厚重", "轻盈"],
  ["滋润", "厚重", "油润", "封层"],
  ["黏", "粘", "闷"],
  ["稳定", "舒适", "耐受"],
  ["补水", "保湿", "干燥", "起皮"],
  ["控油", "油脂", "出油", "油光"],
  ["泛红", "舒缓", "敏感"],
  ["痘", "粉刺", "闭口", "小疙瘩"],
  ["精简", "简单", "少步骤", "层叠"],
  ["局部", "点涂"],
] as const;

function semanticallyRelated(fact: string, rationaleText: string) {
  const normalizedFact = fact.trim().toLowerCase();
  const normalizedRationale = rationaleText.trim().toLowerCase();
  if (!normalizedFact || !normalizedRationale) return false;
  if (normalizedRationale.includes(normalizedFact) || normalizedFact.includes(normalizedRationale)) return true;
  return semanticGroups.some((group) => (
    group.some((term) => normalizedFact.includes(term))
    && group.some((term) => normalizedRationale.includes(term))
  ));
}

function consumerCapabilityLabels(
  purposes: CareStepPurpose[],
  selectedPurpose: CareStepPurpose,
) {
  const labels: Record<CareStepPurpose, string> = {
    cleansing: "清洁",
    basic_moisturization: "基础保湿",
    hydration_support: "补水支持",
    sun_protection: "防晒",
    optional_treatment: "针对性护理",
  };
  return [...new Set([selectedPurpose, ...purposes])]
    .filter((purpose) => purposes.includes(purpose))
    .map((purpose) => labels[purpose])
    .slice(0, 3);
}

export function plannerUsageHistory(feedback: ProductUsageStats | undefined) {
  const positiveCount = feedback?.positiveCount ?? 0;
  const preferenceIssues = feedback?.preferenceIssueTags?.slice(0, 4) ?? [];
  const summary = feedback?.recentRelevantFeedbackSummary ?? null;
  return {
    usageCount: feedback?.usageCount ?? 0,
    averageRating: feedback?.averageRating ?? null,
    positiveSignals: positiveCount >= 2 ? ["多次体验较稳定"] : [],
    preferenceIssues,
    highReactionCount: feedback?.highReactionCount ?? 0,
    recentRelevantFeedbackSummary: summary,
  };
}

function skinMemoryTopics(checkin: SkinCheckinRow | null): string[] {
  const state = checkin?.daily_state;
  if (!state || typeof state !== "object" || Array.isArray(state) || !("concerns" in state) || !Array.isArray((state as { concerns?: unknown }).concerns)) return [];
  return (state as { concerns: Array<{ kind?: unknown; status?: unknown }> }).concerns
    .flatMap((concern) => concern.status === "present" && typeof concern.kind === "string" ? [concern.kind] : [])
    .slice(0, 6);
}

function profileMemoryBaseline(profile: ProfileRow | null): string[] {
  const value = profile?.long_term_skin_baseline;
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const tendencies = (value as Record<string, unknown>).recurring_tendencies;
  return Array.isArray(tendencies)
    ? tendencies.filter((entry): entry is string => typeof entry === "string").slice(0, 6)
    : [];
}

function profileTexturePreferences(profile: ProfileRow | null) {
  const preferences = profile?.preferences;
  if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) return [];
  const values = (preferences as Record<string, unknown>).texture_preferences;
  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === "string" && (TEXTURE_PREFERENCES as readonly string[]).includes(value))
    : [];
}

function profileSkinGoals(profile: ProfileRow | null) {
  return (profile?.goals ?? []).filter((goal): goal is string => (SKIN_GOALS as readonly string[]).includes(goal));
}

function selectionRationaleFor(
  step: CarePlannerDecision["selected_steps"][number],
  comparisons: NonNullable<CarePlannerDecision["candidateComparisons"]>,
  candidates: Map<string, CarePlannerInput["eligibleProducts"][number]>,
) {
  const rationale = step.selection_rationale;
  if (!rationale || rationale.selectedProductId !== step.ownedProductId) return null;
  const comparison = comparisons.find((item) => item.selectedProductIds.includes(step.ownedProductId));
  const comparisonMode = rationale.comparisonMode ?? comparison?.comparisonMode ?? null;
  const rationaleText = [
    ...rationale.relevantDifferences,
    rationale.whySelectedToday,
    comparison?.comparisonReason ?? "",
  ].join(" ");
  const projectedDifferences = consumerDecisionRationale(rationale.relevantDifferences);
  const relevantDifferences = projectedDifferences.length > 0
    ? projectedDifferences
    : rationale.candidateIds.flatMap((ownedProductId) => {
      const candidate = candidates.get(ownedProductId);
      if (!candidate) return [];
      const facts = consumerAlternativeProductFacts(candidate, step.purpose);
      const availableFacts = [
        ...facts.claims,
        ...facts.texture,
        ...facts.usage,
        ...facts.capabilities,
      ].filter((value, index, values) => values.indexOf(value) === index).slice(0, 3);
      return availableFacts.length > 0 ? [`${candidate.displayName}：${availableFacts.join("；")}`] : [];
    }).slice(0, 4);
  const whySelectedToday = consumerDecisionRationale([rationale.whySelectedToday]).join("；")
    || consumerDecisionRationale([step.why_this_product]).join("；")
    || consumerDecisionRationale([step.why_today]).join("；")
    || "今天的护理安排更偏向已选产品。";
  return {
    comparableCandidateCount: rationale.candidateIds.length,
    relevantDifferences,
    whySelectedToday,
    certainty: rationale.certainty,
    comparisonMode,
    comparableProducts: rationale.candidateIds.flatMap((ownedProductId) => {
      const candidate = candidates.get(ownedProductId);
      if (!candidate || ownedProductId === step.ownedProductId || comparisonMode === null) return [];
      return [{
        ownedProductId,
        productName: candidate.displayName,
        productFacts: consumerAlternativeProductFacts(candidate, step.purpose),
        recentExperience: consumerNarrativeRecentExperience(candidate.usageHistory, rationaleText),
      }];
    }),
    validatedComparisonReason: comparison
      ? consumerDecisionRationale([comparison.comparisonReason]).join("；") || null
      : null,
  };
}

const internalKnowledgeStateFragment = /(?:信息|资料|说明|证据|研究|evidence).*(?:不足|不全|不完整|缺失|缺少|未知|齐全|完整度|可追溯|更完整|更充分|更明确)|(?:缺少|缺失).*(?:产品类型|使用|质地|洗后感|成分|功效)|可靠性|置信度|(?:confidence|reliability|research|verified|draft)/iu;
const openingStateFragment = /(?:已开封|未开封|开封状态|已经在使用|正在使用|使用过)/u;

/**
 * Planner rationale remains the primary decision trace. This projection only
 * removes internal knowledge-state claims; concrete product/context clauses in
 * the same rationale survive and are enriched later by structured facts.
 */
function consumerDecisionRationale(values: string[]) {
  return values
    .flatMap((value) => value.split(/[；;。！？，,]/u))
    .map((value) => value.trim())
    .flatMap((value) => {
      if (!value) return [];
      if (openingStateFragment.test(value)) return [];
      const withoutKnowledgeState = value
        .replace(/(?:有|具备)(?:更|较)?明确的官方(?:说明|信息|资料)/gu, "")
        .replace(/(?:官方)?信息(?:可追溯性强|完整度(?:更)?高|(?:更|较)?齐全|(?:更|较)?完整|(?:更|较)?充分)/gu, "")
        .replace(/(?:信息|资料|证据)(?:更|较)?(?:完整|充分|明确)/gu, "")
        .replace(/(?:官方)?说明(?:更|较)?明确/gu, "")
        .replace(/(?:信息|资料|证据)?可靠性(?:更)?高?/gu, "")
        .replace(/(?:可信|可靠)(?:的)?/gu, "")
        .replace(/\s+/gu, " ")
        .trim();
      if (!withoutKnowledgeState || internalKnowledgeStateFragment.test(withoutKnowledgeState)) return [];
      return [withoutKnowledgeState];
    })
    .slice(0, 6);
}

function consumerAlternativeProductFacts(
  candidate: CarePlannerInput["eligibleProducts"][number],
  selectedPurpose: CareStepPurpose,
): NonNullable<NonNullable<TodayUserNarrativeInput["steps"][number]["selectionRationale"]>["comparableProducts"]>[number]["productFacts"] {
  const evidence = candidate.productEvidence;
  const allowedRefs = new Set(evidence.evidenceRefs);
  const belongsToProduct = (refs: string[]) => refs.some((ref) => allowedRefs.has(ref));
  return {
    productType: consumerProductTypeLabel(candidate.productType),
    capabilities: consumerCapabilityLabels(candidate.supportedPurposes, selectedPurpose),
    claims: evidence.claims.filter((claim) => belongsToProduct(claim.evidenceRefs)).map((claim) => claim.text).slice(0, 3),
    texture: evidence.texture && belongsToProduct(evidence.texture.evidenceRefs) ? [evidence.texture.description] : [],
    usage: evidence.usage && belongsToProduct(evidence.usage.evidenceRefs) ? evidence.usage.instructions.slice(0, 2) : [],
    cautions: evidence.usage && belongsToProduct(evidence.usage.evidenceRefs) ? evidence.usage.cautions.slice(0, 2) : [],
    consumerIngredients: consumerIngredientDisplayNames(
      (evidence.advisoryIngredients ?? [])
        .filter((ingredient) => belongsToProduct(ingredient.evidenceRefs))
        .map((ingredient) => ingredient.name),
    ).slice(0, 2),
    ingredientKnowledge: (evidence.ingredientKnowledge ?? []).slice(0, 3).map((fact) => ({
      displayNameZh: fact.displayNameZh,
      functions: fact.functions,
      statementZh: fact.statementZh,
      boundaries: fact.boundaries,
    })),
  };
}

function consumerProductTypeLabel(value: string | null) {
  return value && value in PRODUCT_TYPE_META
    ? PRODUCT_TYPE_META[value as ProductType].label
    : null;
}

function routineMatches(
  existing: RoutineWithStepsRow,
  skinSnapshot: Json,
  weatherSnapshot: Json,
  plan: RoutinePlan,
  decisionSnapshot: RoutineDecisionSnapshot,
) {
  const existingSteps = existing.steps.map((step) => ({
    owned_product_id: step.owned_product_id,
    step_order: step.step_order,
    role: step.role,
    reason: step.reason,
    reason_code: step.reason_code,
    score: step.score,
    score_breakdown: step.score_breakdown,
  }));
  return stableStringify(existing.skin_snapshot) === stableStringify(skinSnapshot)
    && stableStringify(existing.weather_snapshot) === stableStringify(weatherSnapshot)
    && stableStringify(existing.excluded_products) === stableStringify(plan.excludedProducts)
    && stableStringify(existing.decision_snapshot) === stableStringify(decisionSnapshot)
    && stableStringify(existingSteps) === stableStringify(plan.steps);
}

async function persistRoutineWithTransportRetry(input: {
  repository: RoutineRepository;
  initial: RoutineWithStepsRow | null;
  payload: Parameters<RoutineRepository["replace"]>[0];
  plan: RoutinePlan;
  requestId: string;
}): Promise<RoutineWithStepsRow> {
  const totalStartedAt = Date.now();
  let attempt = 1;
  try {
    while (true) {
      const attemptStartedAt = Date.now();
      try {
        const routine = await input.repository.replace(input.payload);
        logPersistenceEvent("persistence_attempt", {
          requestId: input.requestId,
          period: input.payload.period,
          attempt,
          outcome: "success",
          durationMs: Date.now() - attemptStartedAt,
        });
        return routine;
      } catch (error) {
        const failureKind = persistenceTransportFailureKind(error);
        logPersistenceEvent("persistence_attempt", {
          requestId: input.requestId,
          period: input.payload.period,
          attempt,
          outcome: "failure",
          durationMs: Date.now() - attemptStartedAt,
        });
        logPersistenceEvent("persistence_failure", {
          requestId: input.requestId,
          period: input.payload.period,
          attempt,
          failureKind: failureKind ?? "non_transport",
          durationMs: Date.now() - attemptStartedAt,
        });
        if (!failureKind) throw error;

        let current: RoutineWithStepsRow | null;
        try {
          current = await input.repository.findByDate(
            input.payload.userId,
            input.payload.routineDate,
            input.payload.period,
          );
        } catch {
          // Without a trustworthy read-back, a retry could overwrite a newer write.
          throw error;
        }
        if (current && routineMatches(
          current,
          input.payload.skinSnapshot,
          input.payload.weatherSnapshot,
          input.plan,
          input.payload.decisionSnapshot,
        )) return current;
        if (routineChangedSince(input.initial, current)) {
          if (current) return current;
          throw error;
        }
        if (attempt === 2) throw error;

        logPersistenceEvent("persistence_retry", {
          requestId: input.requestId,
          period: input.payload.period,
          attempt: 2,
          failureKind,
        });
        attempt = 2;
      }
    }
  } finally {
    logPersistenceEvent("persistence_total", {
      requestId: input.requestId,
      period: input.payload.period,
      durationMs: Date.now() - totalStartedAt,
    });
  }
}

function routineChangedSince(
  initial: RoutineWithStepsRow | null,
  current: RoutineWithStepsRow | null,
) {
  if (!initial || !current) return initial !== current;
  return initial.id !== current.id
    || initial.updated_at !== current.updated_at
    || storedTodayDecisionContextFingerprint(initial)
      !== storedTodayDecisionContextFingerprint(current);
}

function persistenceTransportFailureKind(error: unknown) {
  const cause = error instanceof Error
    && error.message === "ROUTINE_WRITE_FAILED"
    && error.cause
    && typeof error.cause === "object"
    ? error.cause as { code?: unknown; message?: unknown; details?: unknown }
    : null;
  const details = cause ? [cause.code, cause.message, cause.details]
    .filter((item): item is string => typeof item === "string")
    .join(" ") : "";
  if (/UND_ERR_CONNECT_TIMEOUT|CONNECTTIMEOUTERROR|ETIMEDOUT/ui.test(details)) return "connect_timeout";
  if (/UND_ERR_SOCKET|ECONNRESET|ECONNREFUSED|EPIPE/ui.test(details)) return "transport_error";
  return null;
}

function logPersistenceEvent(stage: string, details: Record<string, unknown>) {
  console.info("[today-care-planner]", { stage, ...details });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function snapshot(value: SkinCheckinRow | WeatherRow | null): Json {
  if (!value) return {};
  return JSON.parse(JSON.stringify(value)) as Json;
}

function requiredRolesFor(context: RuleContext): ReadonlySet<RoutineRole> {
  if (!context.dailyCareNeeds) return legacyRequiredRoles[context.period];
  return new Set(context.dailyCareNeeds.requiredRoles);
}

function hasRestriction(
  needs: DailyCareNeeds | undefined,
  code: DailyCareNeeds["restrictions"][number]["code"],
) {
  return needs?.restrictions.some((restriction) => restriction.code === code)
    ?? false;
}

function dailyCareNeedsSkinFit(
  role: RoutineRole,
  needs: DailyCareNeeds,
): { bonus: number; labels: string[] } {
  const matches = needs.priorities.flatMap((priority) => {
    const bonus = priorityBonus(priority.code, role);
    return bonus > 0 ? [{ code: priority.code, bonus }] : [];
  });
  const bonus = Math.max(0, ...matches.map((match) => match.bonus));
  return {
    bonus,
    labels: matches
      .filter((match) => match.bonus === bonus)
      .map((match) => priorityLabel(match.code)),
  };
}

function priorityBonus(code: DailyCarePriorityCode, role: RoutineRole) {
  if (code === "hydration" && ["hydration", "moisturizer"].includes(role)) {
    return 15;
  }
  if (code === "barrier_support") {
    if (role === "moisturizer") return 15;
    if (role === "hydration") return 8;
  }
  if (code === "soothing" && ["hydration", "moisturizer"].includes(role)) {
    return 15;
  }
  if (code === "reduce_irritation" && ["hydration", "moisturizer"].includes(role)) {
    return 10;
  }
  if (code === "oil_balance" && role === "hydration") return 8;
  return 0;
}

function priorityLabel(code: DailyCarePriorityCode) {
  const labels: Record<DailyCarePriorityCode, string> = {
    hydration: "补水",
    barrier_support: "屏障维护",
    oil_balance: "油脂平衡",
    soothing: "舒缓",
    reduce_irritation: "减少刺激",
    sun_protection: "防晒",
  };
  return labels[code];
}

function deriveRoutineDailyCareNeeds({
  routineDate,
  period,
  profile,
  checkin,
  weather,
  maxSteps,
}: {
  routineDate: string;
  period: RoutinePeriod;
  profile: ProfileRow | null;
  checkin: SkinCheckinRow | null;
  weather: WeatherRow | null;
  maxSteps: number;
}) {
  const canonicalCheckin = checkin
    ? {
        ...(hasKnownCheckinField(checkin, "dryness_level") ? { drynessLevel: toDailyCareLevel(checkin.dryness_level) } : {}),
        ...(hasKnownCheckinField(checkin, "oiliness_level") ? { oilinessLevel: toDailyCareLevel(checkin.oiliness_level) } : {}),
        ...(hasKnownCheckinField(checkin, "sensitivity_level") ? { sensitivityLevel: toDailyCareLevel(checkin.sensitivity_level) } : {}),
        ...(hasKnownCheckinField(checkin, "redness_level") ? { rednessLevel: toDailyCareLevel(checkin.redness_level) } : {}),
        ...(hasKnownCheckinField(checkin, "acne_level") ? { acneLevel: toDailyCareLevel(checkin.acne_level) } : {}),
      }
    : null;
  const effectiveCheckin = canonicalCheckin
    ? deriveEffectiveDailyCareSignals({
        snapshot: dailySkinMetricSnapshotFor(checkin!),
        canonicalCheckin,
      }).checkin
    : null;

  return deriveDailyCareNeeds({
    routineDate,
    period,
    profile: profile
      ? {
          skinType: toDailyCareSkinType(profile.skin_type),
          sensitivityLevel: toDailyCareLevel(profile.sensitivity_level),
          goals: toDailyCareGoals(profile.goals),
          avoidIngredients: [...profile.avoid_ingredients],
          maxSteps,
        }
      : null,
    checkin: effectiveCheckin,
    weather: weather
      ? {
          temperature: weather.temperature,
          humidity: weather.humidity,
          uvIndex: weather.uv_index,
        }
      : null,
    history: null,
  });
}

function dailySkinMetricSnapshotFor(checkin: SkinCheckinRow) {
  const dailyState = dailyStateSchema.safeParse(checkin.daily_state);
  if (!dailyState.success) return null;

  return buildDailySkinMetricSnapshot({
    recorded_date: checkin.recorded_date,
    daily_state: dailyState.data,
  } as SkinCheckin);
}

async function buildProductSafetyContext({
  profile,
  products,
  knowledge,
  runtimeDraftIngredients,
  requestId,
}: {
  profile: ProfileRow | null;
  products: OwnedProductWithProductRow[];
  knowledge: KnowledgeRepository | undefined;
  runtimeDraftIngredients?: { findTrustedDraftIngredients(catalogProductId: string): Promise<RuntimeDraftIngredients> };
  requestId: string;
}): Promise<ProductSafetyContext> {
  if (!knowledge) {
    return {
      assessIngredients: false,
      avoidIngredients: [...(profile?.avoid_ingredients ?? [])],
      ingredientDataByCatalogProductId: new Map(),
    };
  }

  const catalogProductIds = [...new Set(products.flatMap((owned) =>
    owned.product.catalog_product_id
      ? [owned.product.catalog_product_id]
      : []))];
  const ingredientEntries = await Promise.allSettled(
    catalogProductIds.map(async (catalogProductId) => {
      const catalogProduct = await knowledge.findVerifiedProduct(
        catalogProductId,
        { requestId, queryKind: "safety_catalog_product" },
      );
      if (!catalogProduct) {
        const ingredients = await runtimeDraftIngredients?.findTrustedDraftIngredients(catalogProductId) ?? [];
        return ingredients.length ? [catalogProductId, { reliable: true, ingredients }] as const : null;
      }
      const rows = await knowledge.listVerifiedProductIngredients(
        catalogProductId,
        { requestId, queryKind: "safety_ingredient" },
      );
      if (rows.length === 0) return null;

      const data: ProductSafetyIngredientData = {
        // v0.1 treats a verified catalog link with non-empty confirmed rows as
        // usable matching evidence. It does not claim ingredient completeness.
        reliable: true,
        ingredients: rows.map((row) => ({
          inciName: row.ingredient.inci_name,
          displayName: row.ingredient.display_name,
          aliases: [...row.ingredient.aliases],
        })),
      };
      return [catalogProductId, data] as const;
    }),
  );
  const ingredientDataByCatalogProductId = new Map<
    string,
    ProductSafetyIngredientData
  >();
  for (const entry of ingredientEntries) {
    if (entry.status === "fulfilled" && entry.value) {
      ingredientDataByCatalogProductId.set(entry.value[0], entry.value[1]);
    }
  }

  return {
    assessIngredients: true,
    avoidIngredients: [...(profile?.avoid_ingredients ?? [])],
    ingredientDataByCatalogProductId,
  };
}

function toDailyCareLevel(value: number): DailyCareLevel {
  if (value === 0 || value === 1 || value === 2 || value === 3 || value === 4) {
    return value;
  }
  throw new Error("INVALID_DAILY_CARE_LEVEL");
}

function hasKnownCheckinField(
  checkin: SkinCheckinRow,
  field: "dryness_level" | "oiliness_level" | "redness_level" | "sensitivity_level" | "acne_level",
) {
  return checkin.known_fields?.includes(field) ?? false;
}

function knownCheckinLevel(
  checkin: SkinCheckinRow | null,
  field: "dryness_level" | "oiliness_level" | "sensitivity_level" | "acne_level",
) {
  return checkin && hasKnownCheckinField(checkin, field)
    ? checkin[field]
    : 0;
}

function toDailyCareSkinType(value: string | null): DailyCareSkinType | null {
  if (
    value !== null
    && (DAILY_CARE_SKIN_TYPES as readonly string[]).includes(value)
  ) {
    return value as DailyCareSkinType;
  }
  return null;
}

function toDailyCareGoals(values: string[]): DailyCareGoal[] {
  return values.filter((value): value is DailyCareGoal =>
    (DAILY_CARE_GOALS as readonly string[]).includes(value));
}

const databaseIsoTimestampSchema = z.iso.datetime({ offset: true });

function normalizeRoutineTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !databaseIsoTimestampSchema.safeParse(value).success
  ) {
    throw new TypeError("routines timestamps must be ISO datetimes with a timezone.");
  }

  return new Date(value).toISOString();
}

export function toRoutine(row: RoutineWithStepsRow): Routine {
  const decisionSnapshot = routineDecisionSnapshotSchema.nullable().parse(
    row.decision_snapshot ?? null,
  );
  return routineSchema.parse({
    id: row.id,
    routine_date: row.routine_date,
    period: row.period,
    skin_snapshot: row.skin_snapshot,
    weather_snapshot: row.weather_snapshot,
    decision_snapshot: decisionSnapshot,
    excluded_products: row.excluded_products,
    status: row.status,
    created_at: normalizeRoutineTimestamp(row.created_at),
    updated_at: normalizeRoutineTimestamp(row.updated_at),
    steps: row.steps.map((step) => ({
      id: step.id,
      owned_product_id: step.owned_product_id,
      step_order: step.step_order,
      role: step.role,
      reason: step.reason,
      reason_code: step.reason_code,
      score: step.score,
      score_breakdown: step.score_breakdown,
      product: step.owned_product.product,
    })),
    ...(decisionSnapshot ? {
      explanation: explanationFromDecisionSnapshot(decisionSnapshot),
    } : {}),
  });
}

function dateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
