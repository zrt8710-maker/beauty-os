import "server-only";

import { z } from "zod";

import type { RoutinePeriod, RoutineRole } from "@/schemas/routine";
import type { RoutineRolePreference } from "@/schemas/usage";
import type { CareGuidance } from "@/server/services/care-guidance-retrieval-service";
import { CARE_STEP_PURPOSES, type CareStepPurpose, type PlannerProductEvidence, type PlannerProductFactField } from "@/server/services/planner-product-evidence-service";

const strategySchema = z.enum(["maintain", "simplify", "barrier_focused", "balanced"]);
const fitLevelSchema = z.enum(["strong", "reasonable", "weak", "not_recommended"]);
export const PURPOSE_OMISSION_REASONS = ["not_needed_today", "deferred_by_step_limit", "no_eligible_evidence", "hard_restricted"] as const;
export type PurposeOmissionReason = (typeof PURPOSE_OMISSION_REASONS)[number];
export type PurposeOmission = { purpose: CareStepPurpose; reason: PurposeOmissionReason };
const purposeOmissionSchema = z.object({
  purpose: z.enum(CARE_STEP_PURPOSES),
  reason: z.enum(PURPOSE_OMISSION_REASONS),
}).strict();
const compactText = (maxLength: number) => z.string().trim().min(1).transform((text) => text.slice(0, maxLength));
const selectedProductFitSchema = z.object({
  ownedProductId: z.uuid(),
  relevantSkinSignals: z.array(z.string().trim().min(1).max(160)).max(6),
  supportedPurposes: z.array(z.enum(CARE_STEP_PURPOSES)).max(CARE_STEP_PURPOSES.length).default([]),
  positiveFitReasons: z.array(z.string().trim().min(1).max(180)).max(3).default([]),
  negativeFitReasons: z.array(z.string().trim().min(1).max(180)).max(2).default([]),
  uncertainty: z.array(z.string().trim().min(1).max(180)).max(2).default([]),
  relevantEvidenceRefs: z.array(z.string().trim().min(1).max(120)).max(6),
  relevantWeatherSignals: z.array(z.string().trim().min(1).max(80)).max(4).default([]),
  fitSummary: z.string().trim().min(1).max(220),
  fitLevel: fitLevelSchema,
}).strict();
const selectionRationaleSchema = z.object({
  candidateIds: z.array(z.uuid()).min(1).max(6),
  selectedProductId: z.uuid(),
  relevantDifferences: z.array(z.string().trim().min(1).max(180)).max(3).default([]),
  whySelectedToday: z.string().trim().min(1).max(220),
  certainty: z.enum(["clear", "uncertain"]),
  /** Validator-owned presentation boundary; providers never choose it. */
  comparisonMode: z.enum(["strong", "lightweight_contextual"]).nullable().optional(),
}).strict();
const topAlternativeFitSchema = z.object({
  // Alternatives never decide persistence. Accept a recoverable provider
  // formatting defect here so validation can drop just that comparison.
  ownedProductId: z.string().catch(""),
  fitLevel: fitLevelSchema.catch("weak"),
  supportedPurposes: z.array(z.string()).catch([]),
  shortReason: z.string().catch("未提供替代方案说明。"),
  uncertainty: z.array(z.string()).catch([]),
}).passthrough();
const candidateComparisonSchema = z.object({
  purpose: z.enum(CARE_STEP_PURPOSES),
  candidateIds: z.array(z.uuid()).min(2).max(6),
  selectedProductIds: z.array(z.uuid()).min(1).max(3),
  selectionMode: z.enum(["single", "complementary_multiple"]),
  comparisonReason: compactText(180),
  multipleSelectionReason: compactText(160).nullable(),
  uncertainty: z.array(compactText(160)).min(1).max(1),
  /** Added only after validation; providers never choose this boundary. */
  comparisonMode: z.enum(["strong", "lightweight_contextual"]).optional(),
}).strict();
export const carePlannerDecisionSchema = z.object({
  strategy_summary: z.string().trim().min(1).max(240),
  selected_steps: z.array(z.object({ ownedProductId: z.uuid(), purpose: z.enum(CARE_STEP_PURPOSES), why_today: z.string().trim().min(1).max(180), why_this_product: z.string().trim().min(1).max(180), value_if_removed: compactText(160).optional(), evidence_refs: z.array(z.string().trim().min(1).max(120)).max(6).default([]), preference_refs: z.array(z.string().trim().min(1).max(100)).max(6).optional(), selection_rationale: selectionRationaleSchema.optional() })).min(1).max(8),
  unresolved_needs: z.array(z.string().trim().min(1).max(180)).max(6),
  strategy: strategySchema,
  usedGuidanceIds: z.array(z.string().regex(/^GUIDE-/)).max(6),
  productFitAssessments: z.object({
    selected: z.array(selectedProductFitSchema).max(8),
    topAlternatives: z.array(topAlternativeFitSchema).max(3).default([]),
  }).strict(),
  candidateComparisons: z.array(candidateComparisonSchema).max(5).optional(),
  purposeOmissions: z.array(purposeOmissionSchema).max(CARE_STEP_PURPOSES.length).optional(),
}).strict();
export type CarePlannerDecision = z.infer<typeof carePlannerDecisionSchema>;

/**
 * The production provider emits only decision facts. This is projected into
 * CarePlannerDecision before the established validator runs, so the validator
 * remains the sole safety boundary and consumers keep one decision shape.
 */
export const productionMinimalCarePlannerDecisionSchema = z.object({
  strategy_summary: z.string().trim().min(1).max(240),
  selected_steps: z.array(z.object({
    ownedProductId: z.uuid(),
    purpose: z.enum(CARE_STEP_PURPOSES),
    why_today: z.string().trim().min(1).max(180),
    whySelectedToday: z.string().trim().min(1).max(220),
    evidence_refs: z.array(z.string().trim().min(1).max(120)).max(6).default([]),
    preference_refs: z.array(z.string().trim().min(1).max(100)).max(6).optional(),
    relevantSkinSignalIds: z.array(z.string().trim().min(1).max(160)).max(6).default([]),
    relevantWeatherSignalIds: z.array(z.string().trim().min(1).max(80)).max(4).default([]),
    selection_rationale: z.object({
      candidateIds: z.array(z.uuid()).min(1).max(6),
      relevantDifferences: z.array(z.string().trim().min(1).max(180)).max(3).default([]),
      certainty: z.enum(["clear", "uncertain"]),
    }).strict(),
  }).strict()).min(1).max(8),
  unresolved_needs: z.array(z.string().trim().min(1).max(180)).max(6),
  strategy: strategySchema,
  candidateComparisons: z.array(z.object({
    purpose: z.enum(CARE_STEP_PURPOSES),
    candidateIds: z.array(z.uuid()).min(2).max(6),
    selectedProductIds: z.array(z.uuid()).min(1).max(3),
    selectionMode: z.enum(["single", "complementary_multiple"]),
    comparisonReason: compactText(180),
    multipleSelectionReason: compactText(160).nullable(),
  }).strict()).max(5).default([]),
  // The Planner may only make the care-direction judgment. Every other
  // omission reason is derived and verified after validation.
  notNeededPurposes: z.array(z.enum(CARE_STEP_PURPOSES))
    .max(CARE_STEP_PURPOSES.length)
    .optional(),
}).strict();

export function projectProductionMinimalCarePlannerDecision(
  raw: z.infer<typeof productionMinimalCarePlannerDecisionSchema>,
): CarePlannerDecision {
  return carePlannerDecisionSchema.parse({
    strategy: raw.strategy,
    strategy_summary: raw.strategy_summary,
    unresolved_needs: raw.unresolved_needs,
    purposeOmissions: (raw.notNeededPurposes ?? []).map((purpose) => ({
      purpose,
      reason: "not_needed_today" as const,
    })),
    usedGuidanceIds: [],
    selected_steps: raw.selected_steps.map((step) => ({
      ownedProductId: step.ownedProductId,
      purpose: step.purpose,
      why_today: step.why_today,
      why_this_product: step.whySelectedToday,
      evidence_refs: step.evidence_refs,
      preference_refs: step.preference_refs ?? [],
      selection_rationale: {
        candidateIds: step.selection_rationale.candidateIds,
        selectedProductId: step.ownedProductId,
        relevantDifferences: step.selection_rationale.relevantDifferences,
        whySelectedToday: step.whySelectedToday,
        certainty: step.selection_rationale.certainty,
      },
    })),
    productFitAssessments: {
      selected: raw.selected_steps.map((step) => ({
        ownedProductId: step.ownedProductId,
        relevantSkinSignals: step.relevantSkinSignalIds,
        supportedPurposes: [step.purpose],
        positiveFitReasons: [],
        negativeFitReasons: [],
        uncertainty: [],
        relevantEvidenceRefs: step.evidence_refs,
        relevantWeatherSignals: step.relevantWeatherSignalIds,
        fitSummary: step.whySelectedToday,
        fitLevel: "reasonable",
      })),
      topAlternatives: [],
    },
    candidateComparisons: raw.candidateComparisons.map((comparison) => ({
      ...comparison,
      uncertainty: ["未提供额外不确定性说明。"],
    })),
  });
}

export type CarePlannerInput = {
  period: RoutinePeriod;
  /** Explicit, period-scoped user preference. Soft Planner context, never eligibility or safety. */
  routineRolePreferences?: Array<RoutineRolePreference & { preferenceRef?: string }>;
  /** Durable Profile preferences. Soft comparison context only; never a rule. */
  softPersonalization: {
    texturePreferences: string[];
    skinGoals: string[];
  };
  /** Optional long-term preference hints retrieved from private memory. Soft only. */
  personalMemoryContext?: string[];
  /** Unified read model: overrides take precedence over inherited baseline. */
  effectiveSkinState: unknown[];
  dailyDelta: unknown[];
  longTermBaseline: unknown[];
  todayConfirmed: unknown[];
  manualOverrides: unknown[];
  careGuidance: CareGuidance[];
  /** Backward-compatible aliases for existing provider prompts. */
  todaySkin: unknown;
  longTermContext: unknown;
  weather: {
    temperature: number | null;
    humidity: number | null;
    uvIndex: number | null;
    weatherCode: string | null;
    source: "today_weather_context";
    signals: Array<{ signalId: string; metric: "temperature_c" | "humidity_percent" | "uv_index" | "weather_code"; value: number | string }>;
  } | null;
  recentHistory: unknown[];
  purposeContext: {
    hasOilinessContext: boolean;
    hasDrynessOrFlakingContext: boolean;
  };
  /** Stable references that a fit assessment may cite; they are never inferred by the model. */
  skinSignals: Array<{
    signalId: string;
    concern: string;
    area: string | null;
    status: string;
    grade: number | null;
    source: "today_confirmed" | "manual_override" | "baseline_inherited";
    comparison: string | null;
  }>;
  eligibleProducts: Array<{
    ownedProductId: string; displayName: string; productType: string | null;
    /** Single sanitized Product Knowledge + draft projection for Planner use. */
    productEvidence: PlannerProductEvidence;
    /** Aliases of productEvidence metadata: absence is explicitly unknown. */
    knownFacts: PlannerProductFactField[];
    unknownFields: PlannerProductFactField[];
    limitations: string[];
    /**
     * Narrow, identity-backed baseline roles. They are not Product Knowledge
     * evidence and can never support comparison, safety, or capability claims.
     */
    baselineTypeBackedPurposes?: CareStepPurpose[];
    supportedPurposes: CareStepPurpose[];
    inventory: { quantityPercent: number };
    /** Private, compact 30-day experience for this exact owned product. */
    usageHistory: {
      usageCount: number;
      averageRating: number | null;
      positiveSignals: string[];
      preferenceIssues: string[];
      highReactionCount: number;
      recentRelevantFeedbackSummary: string | null;
    };
  }>;
  hardRestrictions: string[];
  unknowns: string[];
  baselineRoles: RoutineRole[];
  /** Factual care directions the planner may use to justify an extra step. */
  dailyPriorities: string[];
  maxSteps: number;
};
export type CarePlannerProvider = { plan(input: CarePlannerInput): Promise<CarePlannerDecision> };
export type CarePlannerService = { plan(input: CarePlannerInput): Promise<CarePlannerDecision | null>; planWithTrace(input: CarePlannerInput): Promise<{ decision: CarePlannerDecision | null; failureReason: string | null }> };

export type CarePlannerValidationWarning = {
  code:
    | "GUIDANCE_REFERENCE_DROPPED"
    | "TOP_ALTERNATIVE_DROPPED"
    | "UNSELECTED_FIT_DROPPED"
    | "FIT_PURPOSES_NORMALIZED"
    | "SKIN_SIGNAL_REFERENCE_DROPPED"
    | "WEATHER_CONTEXT_REFERENCE_DROPPED"
    | "EVIDENCE_REFERENCE_DROPPED"
    | "PREFERENCE_REFERENCE_DROPPED"
    | "CANDIDATE_COMPARISON_DROPPED"
    | "CANDIDATE_COMPARISON_SANITIZED"
    | "CANDIDATE_COMPARISON_MISSING"
    | "SELECTION_RATIONALE_DROPPED"
    | "COMPARISON_LANGUAGE_SANITIZED"
    | "PRODUCT_NARRATIVE_SANITIZED"
    | "PURPOSE_OMISSION_DROPPED"
    | "POTENTIAL_REDUNDANCY"
    | "USAGE_ORDER_REORDERED"
    | "USAGE_ORDER_CONFLICT";
  ids: string[];
};

export function createCarePlannerService(provider: CarePlannerProvider | null): CarePlannerService {
  async function planWithTrace(input: CarePlannerInput) {
    if (!provider) return { decision: null, failureReason: "CARE_PLANNER_NOT_CONFIGURED" };
    try {
      const parsed = carePlannerDecisionSchema.safeParse(await provider.plan(input));
      if (parsed.success) return { decision: parsed.data, failureReason: null };
      const issuePaths = parsed.error.issues
        .slice(0, 8)
        .map((issue) => issue.path.join(".") || "<root>");
      if (process.env.NODE_ENV === "development") {
        console.info("[today-care-planner]", {
          stage: "provider_schema_parse",
          success: false,
          issuePaths,
          issueCodes: parsed.error.issues.slice(0, 8).map((issue) => issue.code),
        });
      }
      return { decision: null, failureReason: `CARE_PLANNER_SCHEMA_INVALID:${issuePaths.join(",")}` };
    } catch (error) {
      return { decision: null, failureReason: error instanceof Error && error.message ? error.message : "CARE_PLANNER_INVALID_OUTPUT" };
    }
  }
  return { async plan(input) { return (await planWithTrace(input)).decision; }, planWithTrace };
}

export const purposeToRoutineRole: Record<CareStepPurpose, RoutineRole> = {
  cleansing: "cleanser", basic_moisturization: "moisturizer", hydration_support: "hydration", sun_protection: "sunscreen", optional_treatment: "treatment",
};
export const routineRoleToPurpose: Partial<Record<RoutineRole, CareStepPurpose>> = {
  cleanser: "cleansing",
  moisturizer: "basic_moisturization",
  hydration: "hydration_support",
  sunscreen: "sun_protection",
  treatment: "optional_treatment",
};
export const baselinePurposesForPlanner: Record<RoutinePeriod, CareStepPurpose[]> = { am: ["sun_protection"], pm: ["cleansing", "basic_moisturization"] };
const HARD_FACTUAL_PURPOSES: readonly CareStepPurpose[] = [
  "cleansing",
  "sun_protection",
];

export function validateCarePlannerDecisionDetailed(input: { decision: CarePlannerDecision; candidates: CarePlannerInput["eligibleProducts"]; careGuidanceIds: string[]; hardRestrictions: string[]; maxSteps: number; skinSignals: CarePlannerInput["skinSignals"]; weatherSignals?: NonNullable<CarePlannerInput["weather"]>["signals"]; period?: RoutinePeriod; consideredPurposes?: CareStepPurpose[]; routineRolePreferences?: CarePlannerInput["routineRolePreferences"] }) {
  const droppedGuidanceIds = input.decision.usedGuidanceIds.filter((id) => !input.careGuidanceIds.includes(id));
  const warnings: CarePlannerValidationWarning[] = droppedGuidanceIds.length > 0
    ? [{ code: "GUIDANCE_REFERENCE_DROPPED", ids: droppedGuidanceIds }]
    : [];
  const candidateById = new Map(input.candidates.map((candidate) => [candidate.ownedProductId, candidate]));
  const preferenceByRef = new Map((input.routineRolePreferences ?? []).flatMap((preference) =>
    preference.preferenceRef ? [[preference.preferenceRef, preference] as const] : []));
  const strongComparisonCandidatesByPurpose = new Map<CareStepPurpose, string[]>();
  const contextualComparisonCandidatesByPurpose = new Map<CareStepPurpose, string[]>();
  for (const purpose of CARE_STEP_PURPOSES) {
    strongComparisonCandidatesByPurpose.set(
      purpose,
      input.candidates
        .filter((candidate) => candidateEligibleForComparison(candidate, purpose, input.hardRestrictions)
          && candidateMaySupportComparison(candidate, purpose))
        .map((candidate) => candidate.ownedProductId),
    );
    contextualComparisonCandidatesByPurpose.set(
      purpose,
      input.candidates
        .filter((candidate) => candidateMaySupportContextualComparison(candidate, purpose, input.hardRestrictions))
        .map((candidate) => candidate.ownedProductId),
    );
  }
  const sanitizedComparisons = (input.decision.candidateComparisons ?? []).flatMap((comparison) => {
    const validCandidateIds = [...new Set(comparison.candidateIds.filter((id) =>
      contextualComparisonCandidatesByPurpose.get(comparison.purpose)?.includes(id),
    ))];
    const actualSelectedIds = input.decision.selected_steps
      .filter((step) => step.purpose === comparison.purpose)
      .map((step) => step.ownedProductId);
    if (actualSelectedIds.length === 0) {
      warnings.push({ code: "CANDIDATE_COMPARISON_DROPPED", ids: comparison.candidateIds });
      return [];
    }
    const declaredSelectedIds = [...new Set(comparison.selectedProductIds.filter((id) =>
      validCandidateIds.includes(id) && actualSelectedIds.includes(id),
    ))];
    const selectedProductIds = comparison.selectionMode === "single"
      ? [declaredSelectedIds[0] ?? actualSelectedIds[0]!]
      : [...new Set(actualSelectedIds.filter((id) => validCandidateIds.includes(id)))];
    if (validCandidateIds.length < 2 || selectedProductIds.length === 0) {
      warnings.push({ code: "CANDIDATE_COMPARISON_DROPPED", ids: comparison.candidateIds });
      return [];
    }
    if (
      !sameStringSet(validCandidateIds, comparison.candidateIds)
      || !sameStringSet(selectedProductIds, comparison.selectedProductIds)
    ) {
      warnings.push({ code: "CANDIDATE_COMPARISON_SANITIZED", ids: comparison.candidateIds });
    }
    const comparisonReason = sanitizeComparisonReason({
      comparisonReason: comparison.comparisonReason,
      selectedProductId: selectedProductIds[0]!,
      purpose: comparison.purpose,
      candidateById,
    });
    if (comparisonReason !== comparison.comparisonReason) {
      warnings.push({ code: "COMPARISON_LANGUAGE_SANITIZED", ids: selectedProductIds });
    }
    const comparisonMode = validCandidateIds.every((id) => {
      const candidate = candidateById.get(id);
      return candidate !== undefined && candidateMaySupportComparison(candidate, comparison.purpose);
    }) ? "strong" as const : "lightweight_contextual" as const;
    return [{ ...comparison, candidateIds: validCandidateIds, selectedProductIds, comparisonReason, comparisonMode }];
  });
  const invalidAlternatives = input.decision.productFitAssessments.topAlternatives
    .filter((alternative) => {
      const candidate = candidateById.get(alternative.ownedProductId);
      const purposes = alternative.supportedPurposes.filter(
        (purpose): purpose is CareStepPurpose =>
          (CARE_STEP_PURPOSES as readonly string[]).includes(purpose),
      );
      return !candidate
        || purposes.length !== alternative.supportedPurposes.length
        || purposes.some((purpose) => !candidateMaySupportComparison(candidate, purpose));
    })
    .map((alternative) => alternative.ownedProductId);
  if (invalidAlternatives.length > 0) {
    warnings.push({ code: "TOP_ALTERNATIVE_DROPPED", ids: invalidAlternatives });
  }
  const fail = (
    reason: string,
    affected: { purpose?: CareStepPurpose; stepIndex?: number } = {},
  ) => ({
    valid: false as const,
    status: "rejected" as const,
    reason,
    affectedPurpose: affected.purpose ?? null,
    affectedStepIndex: affected.stepIndex ?? null,
    warnings,
    proposedDecision: input.decision,
  });
  const ids = new Set<string>();
  for (const [stepIndex, step] of input.decision.selected_steps.entries()) {
    const candidate = candidateById.get(step.ownedProductId);
    const purpose = step.purpose as CareStepPurpose;
    if (!candidate || ids.has(step.ownedProductId)) {
      return fail("STEP_CONTRACT_INVALID", { purpose, stepIndex });
    }
    if (!candidateMayServePurpose(candidate, purpose)) {
      return fail(isHardFactualPurpose(purpose)
        ? "PURPOSE_NOT_SUPPORTED_BY_EVIDENCE"
        : "AI_JUDGED_INTENT_NO_KNOWN_PRODUCT_FACTS", { purpose, stepIndex });
    }
    if (purpose === "optional_treatment" && input.hardRestrictions.includes("REDUCE_TREATMENT")) {
      return fail("TREATMENT_HARD_RESTRICTED", { purpose, stepIndex });
    }
    ids.add(step.ownedProductId);
  }

  let selectedStepsAfterRedundancy = [...input.decision.selected_steps];
  for (const purpose of CARE_STEP_PURPOSES) {
    const purposeSteps = selectedStepsAfterRedundancy.filter((step) => step.purpose === purpose);
    const competitors = strongComparisonCandidatesByPurpose.get(purpose) ?? [];
    const comparison = sanitizedComparisons.find((item) => item.purpose === purpose);
    if (purposeSteps.length > 0 && competitors.length > 1 && !comparison) {
      warnings.push({ code: "CANDIDATE_COMPARISON_MISSING", ids: competitors });
    }
    if (purposeSteps.length < 2) continue;
    // Redundancy is a care-selection judgment. Preserve the Planner's
    // combination and expose a trace warning rather than rewriting the plan.
    const hasComplementaryRationale = comparison?.selectionMode === "complementary_multiple"
      && Boolean(comparison.multipleSelectionReason)
      && purposeSteps.every((step) => comparison.selectedProductIds.includes(step.ownedProductId));
    if (!hasComplementaryRationale) {
      warnings.push({ code: "POTENTIAL_REDUNDANCY", ids: purposeSteps.map((step) => step.ownedProductId) });
    }
  }
  if (selectedStepsAfterRedundancy.length > input.maxSteps) {
    const affectedStep = selectedStepsAfterRedundancy[input.maxSteps];
    return fail("MAX_STEPS_EXCEEDED", {
      purpose: affectedStep?.purpose as CareStepPurpose | undefined,
      stepIndex: input.maxSteps,
    });
  }

  const usageOrder = enforceExplicitUsageOrder({
    steps: selectedStepsAfterRedundancy,
    candidateById,
    period: input.period,
  });
  if (usageOrder.conflictIds.length > 0) {
    const conflictIds = usageOrder.conflictIds as string[];
    warnings.push({ code: "USAGE_ORDER_CONFLICT", ids: conflictIds });
    const affectedStepIndex = selectedStepsAfterRedundancy.findIndex((step) =>
      conflictIds.includes(step.ownedProductId));
    const affectedStep = selectedStepsAfterRedundancy[affectedStepIndex];
    return fail("USAGE_ORDER_CONFLICT", {
      purpose: affectedStep?.purpose as CareStepPurpose | undefined,
      ...(affectedStepIndex >= 0 ? { stepIndex: affectedStepIndex } : {}),
    });
  }
  selectedStepsAfterRedundancy = usageOrder.steps;
  if (usageOrder.reorderedIds.length > 0) {
    warnings.push({ code: "USAGE_ORDER_REORDERED", ids: usageOrder.reorderedIds });
  }

  const selectedProductIds = new Set(selectedStepsAfterRedundancy.map((step) => step.ownedProductId));
  const unselectedFitIds = input.decision.productFitAssessments.selected
    .filter((assessment) => !selectedProductIds.has(assessment.ownedProductId))
    .map((assessment) => assessment.ownedProductId);
  if (unselectedFitIds.length > 0) {
    warnings.push({ code: "UNSELECTED_FIT_DROPPED", ids: unselectedFitIds });
  }
  const selectedAssessments = input.decision.productFitAssessments.selected.filter(
    (assessment) => selectedProductIds.has(assessment.ownedProductId),
  );
  const rawAssessmentsByProductId = new Map(
    selectedAssessments.map((assessment) => [assessment.ownedProductId, assessment]),
  );
  if (
    rawAssessmentsByProductId.size !== selectedProductIds.size
    || selectedAssessments.length !== selectedProductIds.size
  ) return fail("SELECTED_FIT_ASSESSMENT_COVERAGE_INVALID");

  const skinSignalIds = new Set(input.skinSignals.map((signal) => signal.signalId));
  const weatherSignalIds = new Set((input.weatherSignals ?? []).map((signal) => signal.signalId));
  const sanitizedAssessments = selectedAssessments.map((assessment) => {
    const candidate = candidateById.get(assessment.ownedProductId)!;
    const selectedPurpose = selectedStepsAfterRedundancy.find(
      (step) => step.ownedProductId === assessment.ownedProductId,
    )!.purpose as CareStepPurpose;
    const normalizedPurposes = [...new Set(
      assessment.supportedPurposes.filter((purpose) => candidate.supportedPurposes.includes(purpose)),
    )];
    if (!normalizedPurposes.includes(selectedPurpose)) normalizedPurposes.push(selectedPurpose);
    if (!sameStringSet(normalizedPurposes, assessment.supportedPurposes)) {
      warnings.push({ code: "FIT_PURPOSES_NORMALIZED", ids: [assessment.ownedProductId] });
    }
    const relevantSkinSignals = assessment.relevantSkinSignals.filter((signal) => skinSignalIds.has(signal));
    const droppedSkinSignals = assessment.relevantSkinSignals.filter((signal) => !skinSignalIds.has(signal));
    if (droppedSkinSignals.length > 0) {
      warnings.push({ code: "SKIN_SIGNAL_REFERENCE_DROPPED", ids: droppedSkinSignals });
    }
    const relevantWeatherSignals = assessment.relevantWeatherSignals.filter((signal) => weatherSignalIds.has(signal));
    const droppedWeatherSignals = assessment.relevantWeatherSignals.filter((signal) => !weatherSignalIds.has(signal));
    if (droppedWeatherSignals.length > 0) {
      warnings.push({ code: "WEATHER_CONTEXT_REFERENCE_DROPPED", ids: droppedWeatherSignals });
    }
    const relevantEvidenceRefs = assessment.relevantEvidenceRefs.filter(
      (ref) => candidate.productEvidence.evidenceRefs.includes(ref),
    );
    const droppedEvidenceRefs = assessment.relevantEvidenceRefs.filter(
      (ref) => !candidate.productEvidence.evidenceRefs.includes(ref),
    );
    if (droppedEvidenceRefs.length > 0) {
      warnings.push({ code: "EVIDENCE_REFERENCE_DROPPED", ids: droppedEvidenceRefs });
    }
    return {
      ...assessment,
      supportedPurposes: normalizedPurposes,
      relevantSkinSignals,
      relevantWeatherSignals,
      relevantEvidenceRefs,
      fitSummary: sanitizeProductNarrative(assessment.fitSummary, candidate),
    };
  });
  for (const [stepIndex, step] of selectedStepsAfterRedundancy.entries()) {
    const candidate = candidateById.get(step.ownedProductId)!;
    if (
      step.evidence_refs.length > 0
      && !step.evidence_refs.some((ref) => candidate.productEvidence.evidenceRefs.includes(ref))
    ) return fail("SELECTED_PRODUCT_FACT_UNSUPPORTED", {
      purpose: step.purpose as CareStepPurpose,
      stepIndex,
    });
    const validPreferenceRefs = (step.preference_refs ?? []).filter((ref) => {
      const preference = preferenceByRef.get(ref);
      return preference !== undefined && preference.period === input.period
        && routineRoleToPurpose[preference.routine_role] === step.purpose;
    });
    const droppedPreferenceRefs = (step.preference_refs ?? []).filter((ref) => !validPreferenceRefs.includes(ref));
    if (droppedPreferenceRefs.length > 0) warnings.push({ code: "PREFERENCE_REFERENCE_DROPPED", ids: droppedPreferenceRefs });
    const matchingAvoid = (input.routineRolePreferences ?? []).find((preference) =>
      preference.period === input.period
      && preference.polarity === "avoid"
      && routineRoleToPurpose[preference.routine_role] === step.purpose);
    if (matchingAvoid?.preferenceRef && !validPreferenceRefs.includes(matchingAvoid.preferenceRef)) {
      return fail("EXPLICIT_PREFERENCE_REFERENCE_MISSING", { purpose: step.purpose as CareStepPurpose, stepIndex });
    }
  }
  const sanitizedSteps = selectedStepsAfterRedundancy.map((step) => {
    const candidate = candidateById.get(step.ownedProductId)!;
    const purpose = step.purpose as CareStepPurpose;
    const evidenceRefs = step.evidence_refs.filter((ref) =>
      candidate.productEvidence.evidenceRefs.includes(ref),
    );
    const droppedEvidenceRefs = step.evidence_refs.filter((ref) => !evidenceRefs.includes(ref));
    if (droppedEvidenceRefs.length > 0) {
      warnings.push({ code: "EVIDENCE_REFERENCE_DROPPED", ids: droppedEvidenceRefs });
    }
    const whyThisProduct = sanitizeProductNarrative(step.why_this_product, candidate);
    if (whyThisProduct !== step.why_this_product) {
      warnings.push({ code: "PRODUCT_NARRATIVE_SANITIZED", ids: [step.ownedProductId] });
    }
    const selectionRationale = sanitizeSelectionRationale({
      rationale: step.selection_rationale,
      selectedProductId: step.ownedProductId,
      purpose,
      candidateById,
      hardRestrictions: input.hardRestrictions,
    });
    if (step.selection_rationale && !selectionRationale) {
      warnings.push({ code: "SELECTION_RATIONALE_DROPPED", ids: [step.ownedProductId] });
    }
    const preferenceRefs = (step.preference_refs ?? []).filter((ref) => {
      const preference = preferenceByRef.get(ref);
      return preference !== undefined
        && preference.period === input.period
        && routineRoleToPurpose[preference.routine_role] === purpose;
    });
    return { ...step, why_this_product: whyThisProduct, evidence_refs: evidenceRefs, preference_refs: preferenceRefs, selection_rationale: selectionRationale ?? undefined };
  });
  for (const [stepIndex, step] of sanitizedSteps.entries()) {
    const candidate = candidateById.get(step.ownedProductId)!;
    const purpose = step.purpose as CareStepPurpose;
    // Low-risk intents may be Planner judgments, but they still need a real
    // cited product fact unless deterministic evidence already supports them.
    if (
      !isHardFactualPurpose(purpose)
      && !candidate.supportedPurposes.includes(purpose)
      && !(candidate.baselineTypeBackedPurposes?.includes(purpose) ?? false)
      && step.evidence_refs.length === 0
    ) return fail("AI_JUDGED_INTENT_EVIDENCE_MISSING", { purpose, stepIndex });
  }
  const notRecommendedAssessment = sanitizedAssessments.find((assessment) => assessment.fitLevel === "not_recommended");
  if (notRecommendedAssessment) {
    const affectedStepIndex = sanitizedSteps.findIndex(
      (step) => step.ownedProductId === notRecommendedAssessment.ownedProductId,
    );
    return fail("STEP_FIT_ASSESSMENT_INVALID", {
      purpose: sanitizedSteps[affectedStepIndex]?.purpose as CareStepPurpose | undefined,
      ...(affectedStepIndex >= 0 ? { stepIndex: affectedStepIndex } : {}),
    });
  }
  const purposeOmissions = validatePurposeOmissions({
    proposed: input.decision.purposeOmissions ?? [],
    consideredPurposes: input.consideredPurposes ?? [],
    selectedPurposes: new Set(sanitizedSteps.map((step) => step.purpose as CareStepPurpose)),
    candidates: input.candidates,
    hardRestrictions: input.hardRestrictions,
    maxSteps: input.maxSteps,
    selectedStepCount: sanitizedSteps.length,
    warnings,
  });

  const decision = {
    ...input.decision,
    usedGuidanceIds: input.decision.usedGuidanceIds.filter((id) => input.careGuidanceIds.includes(id)),
    selected_steps: sanitizedSteps,
    candidateComparisons: sanitizedComparisons,
    purposeOmissions,
    productFitAssessments: {
      selected: sanitizedAssessments,
      topAlternatives: input.decision.productFitAssessments.topAlternatives.filter(
        (alternative) => !invalidAlternatives.includes(alternative.ownedProductId),
      ),
    },
  };
  return {
    valid: true as const,
    status: warnings.length > 0 ? "valid_with_warnings" as const : "valid" as const,
    warnings,
    droppedGuidanceIds,
    proposedDecision: input.decision,
    selectedSteps: decision.selected_steps.map((step) => ({ ownedProductId: step.ownedProductId, purpose: step.purpose as CareStepPurpose })),
    decision,
  };
}

function validatePurposeOmissions(input: {
  proposed: PurposeOmission[];
  consideredPurposes: CareStepPurpose[];
  selectedPurposes: Set<CareStepPurpose>;
  candidates: CarePlannerInput["eligibleProducts"];
  hardRestrictions: string[];
  maxSteps: number;
  selectedStepCount: number;
  warnings: CarePlannerValidationWarning[];
}): PurposeOmission[] {
  const considered = new Set(input.consideredPurposes);
  const proposedByPurpose = new Map<CareStepPurpose, PurposeOmission>();
  const drop = (purpose: CareStepPurpose, reason: string) => {
    input.warnings.push({ code: "PURPOSE_OMISSION_DROPPED", ids: [purpose] });
    if (process.env.NODE_ENV === "development") {
      console.info("[today-care-planner]", {
        stage: "purpose_omission_dropped",
        warningCode: "PURPOSE_OMISSION_DROPPED",
        affectedPurpose: purpose,
        reason,
      });
    }
  };
  for (const omission of input.proposed) {
    if (!considered.has(omission.purpose)) {
      drop(omission.purpose, "outside_considered_scope");
      continue;
    }
    if (input.selectedPurposes.has(omission.purpose)) {
      drop(omission.purpose, "purpose_selected");
      continue;
    }
    if (proposedByPurpose.has(omission.purpose)) {
      drop(omission.purpose, "duplicate");
      continue;
    }
    if (omission.reason !== "not_needed_today") {
      drop(omission.purpose, "planner_reason_ignored");
      continue;
    }
    proposedByPurpose.set(omission.purpose, omission);
  }
  return [...considered].flatMap((purpose) => {
    if (input.selectedPurposes.has(purpose)) return [];
    const hardRestricted = purpose === "optional_treatment"
      && input.hardRestrictions.includes("REDUCE_TREATMENT");
    const hasEligibleCandidate = input.candidates.some((candidate) => candidateMayServePurpose(candidate, purpose));
    const reason: PurposeOmissionReason | null = hardRestricted
      ? "hard_restricted"
      : !hasEligibleCandidate
        ? "no_eligible_evidence"
        : input.selectedStepCount >= input.maxSteps
          ? "deferred_by_step_limit"
          : proposedByPurpose.has(purpose)
            ? "not_needed_today"
            : null;
    return reason ? [{ purpose, reason }] : [];
  });
}

type SelectedPlannerStep = CarePlannerDecision["selected_steps"][number];

/**
 * This is deliberately a small contract parser, not natural-language ranking.
 * It acts only on source-backed `usage.instructions` that state an unambiguous
 * sequence constraint. Local application (for example, \"局部点涂\") does not
 * create an ordering constraint.
 */
function enforceExplicitUsageOrder(input: {
  steps: SelectedPlannerStep[];
  candidateById: Map<string, CarePlannerInput["eligibleProducts"][number]>;
  period: RoutinePeriod | undefined;
}) {
  const constraints = new Map<string, { afterCleansing: boolean; lastLeaveOn: boolean }>();
  for (const step of input.steps) {
    const instructions = input.candidateById.get(step.ownedProductId)?.productEvidence.usage?.instructions ?? [];
    const joined = instructions.join(" ");
    const afterCleansing = /洁面(?:后|之后)(?:使用|涂抹|应用)?/u.test(joined);
    const explicitLastSkincareStep = /护肤(?:流程)?(?:的)?最后一步/u.test(joined);
    const sunscreenMorningLastStep = input.period === "am"
      && step.purpose === "sun_protection"
      && /(?:防晒(?:为|是)?早间最后一步|早间最后一步(?:为|是)?防晒)/u.test(joined);
    constraints.set(step.ownedProductId, {
      afterCleansing,
      lastLeaveOn: explicitLastSkincareStep || sunscreenMorningLastStep,
    });
  }

  const lastLeaveOnIds = input.steps
    .filter((step) => constraints.get(step.ownedProductId)?.lastLeaveOn)
    .map((step) => step.ownedProductId);
  if (lastLeaveOnIds.length > 1) {
    return { steps: input.steps, reorderedIds: [], conflictIds: lastLeaveOnIds };
  }

  const ordered = [...input.steps];
  const reorderedIds = new Set<string>();
  for (const step of [...ordered]) {
    if (!constraints.get(step.ownedProductId)?.afterCleansing) continue;
    const lastCleansingIndex = ordered.reduce(
      (index, item, currentIndex) => item.purpose === "cleansing" ? currentIndex : index,
      -1,
    );
    const currentIndex = ordered.findIndex((item) => item.ownedProductId === step.ownedProductId);
    if (lastCleansingIndex >= 0 && currentIndex < lastCleansingIndex) {
      ordered.splice(currentIndex, 1);
      ordered.splice(lastCleansingIndex, 0, step);
      reorderedIds.add(step.ownedProductId);
    }
  }

  const lastLeaveOnId = lastLeaveOnIds[0];
  if (lastLeaveOnId) {
    const currentIndex = ordered.findIndex((step) => step.ownedProductId === lastLeaveOnId);
    const lastLeaveOnIndex = ordered.reduce(
      (index, step, currentIndex) => step.purpose !== "cleansing" ? currentIndex : index,
      -1,
    );
    if (currentIndex >= 0 && currentIndex < lastLeaveOnIndex) {
      const [lastStep] = ordered.splice(currentIndex, 1);
      ordered.push(lastStep!);
      reorderedIds.add(lastLeaveOnId);
    }
  }
  return { steps: ordered, reorderedIds: [...reorderedIds], conflictIds: [] };
}

function sanitizeSelectionRationale(input: {
  rationale: CarePlannerDecision["selected_steps"][number]["selection_rationale"] | undefined;
  selectedProductId: string;
  purpose: CareStepPurpose;
  candidateById: Map<string, CarePlannerInput["eligibleProducts"][number]>;
  hardRestrictions: string[];
}) {
  const rationale = input.rationale;
  if (!rationale || rationale.selectedProductId !== input.selectedProductId) return null;
  const selected = input.candidateById.get(input.selectedProductId);
  if (!selected || !candidateMayServePurpose(selected, input.purpose)) return null;
  const candidateIds = [...new Set(rationale.candidateIds.filter((id) => {
    const candidate = input.candidateById.get(id);
    return candidate !== undefined && candidateMaySupportContextualComparison(
      candidate,
      input.purpose,
      input.hardRestrictions,
    );
  }))];
  if (!candidateIds.includes(input.selectedProductId)) candidateIds.unshift(input.selectedProductId);
  const comparisonMode = !candidateMaySupportContextualComparison(
    selected,
    input.purpose,
    input.hardRestrictions,
  ) || candidateIds.length < 2
    ? null
    : candidateIds.every((id) => {
        const candidate = input.candidateById.get(id);
        return candidate !== undefined && candidateMaySupportComparison(candidate, input.purpose);
      })
      ? "strong" as const
      : "lightweight_contextual" as const;
  return {
    ...rationale,
    candidateIds,
    comparisonMode,
  };
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  return left.length === right.length
    && left.every((value) => right.includes(value));
}

function isHardFactualPurpose(purpose: CareStepPurpose) {
  return HARD_FACTUAL_PURPOSES.includes(purpose);
}

export function candidateMayServePurpose(
  candidate: CarePlannerInput["eligibleProducts"][number],
  purpose: CareStepPurpose,
) {
  const baselineTypeBacked = candidate.baselineTypeBackedPurposes?.includes(purpose) ?? false;
  if (isHardFactualPurpose(purpose)) {
    return candidate.supportedPurposes.includes(purpose) || baselineTypeBacked;
  }
  // For ordinary care judgments, known source-referenced product facts are
  // sufficient to let the Planner reason. They are not a new capability or a
  // medical efficacy claim.
  return candidate.supportedPurposes.includes(purpose)
    || baselineTypeBacked
    || (
      !["cleanser", "makeup_remover", "sunscreen"].includes(candidate.productType ?? "")
      && candidate.productEvidence.evidenceRefs.length > 0
    );
}

function candidateMaySupportComparison(
  candidate: CarePlannerInput["eligibleProducts"][number],
  purpose: CareStepPurpose,
) {
  // A type-backed baseline role is enough to perform a basic step, but never
  // evidence that this product is preferable to another owned product.
  return candidate.supportedPurposes.includes(purpose);
}

function candidateMaySupportContextualComparison(
  candidate: CarePlannerInput["eligibleProducts"][number],
  purpose: CareStepPurpose,
  hardRestrictions: string[],
) {
  if (!candidateEligibleForComparison(candidate, purpose, hardRestrictions)) return false;
  if (candidateMaySupportComparison(candidate, purpose)) return true;
  if (purpose === "cleansing") return isSourceBackedCleanserComparisonAlternative(candidate);
  if (isHardFactualPurpose(purpose)) return false;
  if (candidate.baselineTypeBackedPurposes?.includes(purpose)) return false;
  return candidate.productEvidence.usableSkincareEvidence
    && candidate.productEvidence.evidenceRefs.length > 0
    && candidateMayServePurpose(candidate, purpose);
}

function candidateEligibleForComparison(
  candidate: CarePlannerInput["eligibleProducts"][number],
  purpose: CareStepPurpose,
  hardRestrictions: string[],
) {
  return candidate.inventory.quantityPercent > 0
    && !(purpose === "optional_treatment" && hardRestrictions.includes("REDUCE_TREATMENT"));
}

/**
 * A confirmed cleanser may be explained as a lightweight alternative when
 * its own source-backed facts explicitly describe facial cleansing. This is
 * comparison-only: strong comparison and selection still require the
 * ordinary supportedPurposes contract.
 */
function isSourceBackedCleanserComparisonAlternative(
  candidate: CarePlannerInput["eligibleProducts"][number],
) {
  const evidence = candidate.productEvidence;
  const confirmedCleanser = candidate.productType === "cleanser"
    && (candidate.baselineTypeBackedPurposes?.includes("cleansing") ?? false);
  if (!confirmedCleanser || !evidence.usableSkincareEvidence) return false;
  const sourceRefs = new Set(evidence.evidenceRefs);
  const hasAllowedRef = (refs: string[]) => refs.some((ref) => sourceRefs.has(ref));
  const cleansingFact = /(?:洁面|面部清洁|清洁面部|洗面)/u;
  return (evidence.usage !== null
      && hasAllowedRef(evidence.usage.evidenceRefs)
      && evidence.usage.instructions.some((instruction) => cleansingFact.test(instruction)))
    || evidence.claims.some((claim) => (
      hasAllowedRef(claim.evidenceRefs) && cleansingFact.test(claim.text)
    ));
}

const unsupportedComparativeLanguage = /\b(?:best|better|gentler|milder|stronger|lightest|most suitable|more hydrating|more moisturizing|superior)\b|更(?:好|温和|适合|贴合|强|保湿|补水|清爽|轻薄|有效)|最(?:好|温和|适合|贴合|强|保湿|补水|清爽|轻薄|有效)/iu;
const unsupportedRiskLanguage = /(?:irritation|刺激|安全).{0,6}(?:risk|风险)|(?:risk|风险).{0,6}(?:irritation|刺激|安全)/iu;
const verifiedLanguage = /\bverified(?:\s+(?:source|evidence))?\b|(?:正式|已经|已)?验证(?:来源|证据)?/giu;

function sanitizeComparisonReason(input: {
  comparisonReason: string;
  selectedProductId: string;
  purpose: CareStepPurpose;
  candidateById: Map<string, CarePlannerInput["eligibleProducts"][number]>;
}) {
  const selected = input.candidateById.get(input.selectedProductId);
  const hasUnsupportedProvenance = selected?.productEvidence.provenance !== "formal_verified"
    && verifiedLanguage.test(input.comparisonReason);
  verifiedLanguage.lastIndex = 0;
  const locallySanitized = input.comparisonReason
    .replace(/(.{1,50}?)更适合今天/gu, "今天更偏向$1")
    .replace(/(.{1,50}?)是更好的选择/gu, "今天更偏向$1");
  if (
    !unsupportedComparativeLanguage.test(locallySanitized)
    && !unsupportedRiskLanguage.test(locallySanitized)
    && !hasUnsupportedProvenance
  ) return locallySanitized;
  return `今天更偏向 ${selected?.displayName ?? "所选产品"}。`;
}

function sanitizeProductNarrative(
  narrative: string,
  candidate: CarePlannerInput["eligibleProducts"][number],
) {
  if (candidate.productEvidence.provenance === "formal_verified") return narrative;
  return narrative
    .replace(/且为verified来源/giu, "且有来源支持")
    .replace(/\bverified(?:\s+(?:source|evidence))?\b/giu, "source-backed")
    .replace(/(?:正式|已经|已)?验证(?:来源|证据)?/gu, "有来源支持");
}

export function validateCarePlannerDecision(input: { decision: CarePlannerDecision; candidates: CarePlannerInput["eligibleProducts"]; baselineRoles: RoutineRole[]; dailyPriorities: string[]; careGuidanceIds: string[]; maxSteps: number; period: RoutinePeriod; purposeContext: CarePlannerInput["purposeContext"]; skinSignals: CarePlannerInput["skinSignals"] }) {
  const result = validateCarePlannerDecisionDetailed({
    ...input,
    hardRestrictions: [],
  });
  return result.valid ? { selectedOwnedProductIds: result.selectedSteps.map((step) => step.ownedProductId), decision: result.decision } : null;
}
