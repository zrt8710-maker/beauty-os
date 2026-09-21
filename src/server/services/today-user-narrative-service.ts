import "server-only";

import { z } from "zod";

import type { RoutinePeriod } from "@/schemas/routine";
import type { RoutineRolePreference } from "@/schemas/usage";
import type { PurposeOmission } from "@/server/services/today-care-planner-service";

const entrySchema = z.object({
  ownedProductId: z.uuid(),
  /** Consumer-facing selection explanation: need + fit, never use directions. */
  reason: z.string().trim().min(1).max(700),
  /** Present only for an already validated, genuinely competing choice. */
  comparison_note: z.string().trim().min(1).max(420).nullable(),
  /** Consumer-facing operation only; it must not repeat selection rationale. */
  usage: z.string().trim().min(1).max(360),
}).strict();

const purposeOmissionEntrySchema = z.object({
  purpose: z.enum(["cleansing", "basic_moisturization", "hydration_support", "sun_protection", "optional_treatment"]),
  reason: z.enum(["not_needed_today", "deferred_by_step_limit", "no_eligible_evidence", "hard_restricted"]),
  message: z.string().trim().min(1).max(240),
}).strict();
const outputSchema = z.object({
  entries: z.array(entrySchema).max(8),
  purposeOmissions: z.array(purposeOmissionEntrySchema).max(5).optional(),
}).strict();
const consumerBoundaryRules = [
  { code: "source_term", pattern: /source/iu },
  { code: "evidence_term", pattern: /evidence/iu },
  { code: "confidence_term", pattern: /confidence/iu },
  { code: "research_lifecycle", pattern: /(?:draft|verified)/iu },
  { code: "internal_planner_term", pattern: /(?:advisory|unknown|runtime|validator|supported[_\s-]?purpose)/iu },
  { code: "insufficient_evidence", pattern: /(?:资料不足|证据不足|数据不足)/u },
  { code: "candidate_language", pattern: /(?:其他产品也可以|候选)/u },
] as const;
const absoluteComparisonLanguage = /(?:优于|不如|更好|最好|更高级|更强)/u;

type ConsumerBoundaryRule = typeof consumerBoundaryRules[number]["code"];
type NarrativeRejectionReason =
  | `provider_failure.${NarrativeProviderFailureSubtype}`
  | "step_coverage_invalid"
  | "raw_ingredient_leak"
  | "comparison_language_boundary"
  | "comparison_note_contract"
  | `consumer_boundary.${ConsumerBoundaryRule}`;

export type NarrativeProviderFailureSubtype =
  | "http_failure"
  | "empty_output"
  | "extraction_failure"
  | "malformed_json"
  | "output_schema_failure"
  | "incomplete_or_truncated"
  | "other_response_failure";

export type NarrativeProviderFailureDetails = {
  responseStatus: number | null;
  finishReason: string | null;
  incompleteReason: string | null;
  outputTextSegmentCount: number;
  outputChars: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

export class TodayUserNarrativeProviderError extends Error {
  constructor(
    readonly subtype: NarrativeProviderFailureSubtype,
    readonly details: NarrativeProviderFailureDetails,
  ) {
    super(`TODAY_USER_NARRATIVE_${subtype.toUpperCase()}`);
    this.name = "TodayUserNarrativeProviderError";
  }
}

export type TodayUserNarrativeInput = {
  period: RoutinePeriod;
  /** Consumer-readable, soft Profile context. It can explain a tie-break only. */
  softPersonalization: {
    texturePreferences: string[];
    skinGoals: string[];
  };
  /** Validator-owned purpose omissions. Narration may only express these facts. */
  purposeOmissions?: PurposeOmission[];
  steps: Array<{
    ownedProductId: string;
    productName: string;
    purpose: string;
    /** A narrow identity/type-backed baseline step, not product evidence. */
    baselineTypeBackedPurpose?: boolean;
    whyToday: string;
    /** Sanitized Planner decision rationale; primary explanation trace. */
    whyThisProduct: string;
    /** Consumer-safe facts for only the signals this validated step used. */
    relevantSkinContext: Array<{
      concern: string;
      area: string | null;
      timeframe: "today" | "baseline";
      comparison: string | null;
    }>;
    /** Present only when validated weather evidence actually affected this step. */
    relevantWeatherContext: Array<{
      metric: "温度" | "湿度" | "紫外线指数" | "天气状况";
      value: number | string;
    }>;
    /** Compact durable experience only when the validated choice relied on it. */
    recentExperience: {
      positiveSignals: string[];
      preferenceIssues: string[];
      summary: string | null;
    };
    /** Private long-term hints only when they visibly influenced this choice. */
    relevantMemoryContext: string[];
    /** Exact routine-role preference scope for this step; never a product opinion. */
    relevantRoutineRolePreferences?: RoutineRolePreference[];
    productFacts: {
      /** Confirmed identity/type only; null means this dimension is absent. */
      productType: string | null;
      capabilities: string[];
      claims: string[];
      texture: string[];
      usage: string[];
      cautions: string[];
      /** Already consumer-safe Chinese ingredient names; no raw INCI. */
      consumerIngredients: string[];
      /** Generation-time ingredient facts; never raw INCI or source metadata. */
      ingredientKnowledge?: Array<{
        displayNameZh: string;
        functions: string[];
        statementZh: string;
        boundaries: string[];
      }>;
    };
    selectionRationale: {
      /** Count only; raw candidate IDs never enter consumer narration. */
      comparableCandidateCount: number;
      /** Planner differences with internal knowledge-state metadata removed. */
      relevantDifferences: string[];
      /** Planner's primary today-specific selection reason, consumer-sanitized. */
      whySelectedToday: string;
      certainty: "clear" | "uncertain";
      /** Validator-owned comparison boundary; never inferred from raw rationale. */
      comparisonMode?: "strong" | "lightweight_contextual" | null;
      /** Validator-retained alternatives only, with a bounded consumer fact projection. */
      comparableProducts?: Array<{
        ownedProductId: string;
        productName: string;
        productFacts: {
          productType: string | null;
          capabilities: string[];
          claims: string[];
          texture: string[];
          usage: string[];
          cautions: string[];
          consumerIngredients: string[];
          ingredientKnowledge: Array<{
            displayNameZh: string;
            functions: string[];
            statementZh: string;
            boundaries: string[];
          }>;
        };
        /** Included only when actual experience participated in the validated rationale. */
        recentExperience?: {
          positiveSignals: string[];
          preferenceIssues: string[];
          summary: string | null;
        };
      }>;
      /** Consumer-sanitized validator rationale; secondary to Planner rationale. */
      validatedComparisonReason?: string | null;
    } | null;
  }>;
};

export type TodayUserNarrative = z.infer<typeof outputSchema>;
export type TodayUserNarrativeProvider = { narrate(input: TodayUserNarrativeInput): Promise<unknown> };
export type TodayUserNarrativeService = { narrate(input: TodayUserNarrativeInput): Promise<TodayUserNarrative | null> };

/**
 * The narrative provider is intentionally outside care selection. It runs
 * only after a Planner decision is valid and can never cause fallback or
 * change the selected products. It also has no access to current DB state:
 * every supplied fact is generation-time data destined for the snapshot.
 */
export function createTodayUserNarrativeService(provider: TodayUserNarrativeProvider | null): TodayUserNarrativeService {
  return {
    async narrate(input) {
      if (!provider || input.steps.length === 0) return null;

      let rawOutput: unknown;
      try {
        rawOutput = await provider.narrate(input);
      } catch (error) {
        if (error instanceof TodayUserNarrativeProviderError) {
          logNarrativeRejection(`provider_failure.${error.subtype}`, input, error.details);
        } else {
          logNarrativeRejection("provider_failure.other_response_failure", input);
        }
        return null;
      }

      const parsed = outputSchema.safeParse(rawOutput);
      if (!parsed.success) {
        logNarrativeRejection("provider_failure.output_schema_failure", input, { schemaIssueCount: parsed.error.issues.length });
        return null;
      }

      // “候选”及“其他产品也可以”是模型偶发泄漏的内部表述，不是
      // 选品、安全或比较结论。先局部中性化，再由下面所有既有边界复检。
      const output = neutralizeCandidateLanguage(parsed.data);
      const requested = new Set(input.steps.map((step) => step.ownedProductId));
      if (output.entries.length !== input.steps.length || output.entries.some((entry) => !requested.has(entry.ownedProductId))) {
        logNarrativeRejection("step_coverage_invalid", input, { outputEntryCount: output.entries.length });
        return null;
      }
      if (!samePurposeOmissions(output.purposeOmissions ?? [], input.purposeOmissions ?? [])) {
        logNarrativeRejection("provider_failure.output_schema_failure", input, { omissionCoverageInvalid: 1 });
        return null;
      }
      const boundaryRule = consumerBoundaryRuleFor(output);
      if (boundaryRule) {
        logNarrativeRejection(`consumer_boundary.${boundaryRule}`, input);
        return null;
      }
      if (output.entries.some((entry) => containsRawIngredientLeak(entry.reason, input.steps) || containsRawIngredientLeak(entry.usage, input.steps) || (entry.comparison_note !== null && containsRawIngredientLeak(entry.comparison_note, input.steps)))) {
        logNarrativeRejection("raw_ingredient_leak", input);
        return null;
      }
      if (output.entries.some((entry) => {
        const step = input.steps.find((item) => item.ownedProductId === entry.ownedProductId)!;
        const comparisonText = `${entry.reason}\n${entry.comparison_note ?? ""}`;
        const mode = step.selectionRationale?.comparisonMode;
        return mode === "lightweight_contextual"
          ? absoluteComparisonLanguage.test(comparisonText)
          : mode === "strong" && absoluteComparisonLanguage.test(comparisonText);
      })) {
        logNarrativeRejection("comparison_language_boundary", input);
        return null;
      }
      if (output.entries.some((entry) => {
        const step = input.steps.find((item) => item.ownedProductId === entry.ownedProductId)!;
        if (step.selectionRationale?.comparisonMode === "lightweight_contextual" && !requiresComparisonNote(step)) {
          return false;
        }
        return requiresComparisonNote(step) ? entry.comparison_note === null : entry.comparison_note !== null;
      })) {
        logNarrativeRejection("comparison_note_contract", input);
        return null;
      }

      const entries = input.steps.map((step) => {
        const entry = output.entries.find((item) => item.ownedProductId === step.ownedProductId)!;
        if (shouldUseBaselineTypeBackedReason(step)) {
          return { ...entry, reason: baselineTypeBackedReason(step.purpose), comparison_note: null };
        }
        if (step.selectionRationale?.comparisonMode === "lightweight_contextual" && !requiresComparisonNote(step)) {
          return { ...entry, comparison_note: null };
        }
        return entry;
      });
      return input.purposeOmissions?.length
        ? { entries, purposeOmissions: output.purposeOmissions ?? [] }
        : { entries };
    },
  };
}

function logNarrativeRejection(
  reason: NarrativeRejectionReason,
  input: TodayUserNarrativeInput,
  details: Record<string, string | number | null> = {},
) {
  if (process.env.NODE_ENV !== "development") return;
  console.info("[today-user-narrative]", {
    stage: "narration_rejected",
    reason,
    requestedStepCount: input.steps.length,
    ...details,
  });
}

/** Returns only a fixed rule code; no provider text is retained or logged. */
function consumerBoundaryRuleFor(output: TodayUserNarrative): ConsumerBoundaryRule | null {
  for (const entry of output.entries) {
    const values = [entry.reason, entry.usage, entry.comparison_note].filter(
      (value): value is string => value !== null,
    );
    for (const value of values) {
      const rule = consumerBoundaryRules.find((candidate) => candidate.pattern.test(value));
      if (rule) return rule.code;
    }
  }
  for (const omission of output.purposeOmissions ?? []) {
    const rule = consumerBoundaryRules.find((candidate) => candidate.pattern.test(omission.message));
    if (rule) return rule.code;
  }
  return null;
}

function samePurposeOmissions(
  actual: NonNullable<TodayUserNarrative["purposeOmissions"]>,
  expected: PurposeOmission[],
) {
  const key = (value: { purpose: string; reason: string }) => `${value.purpose}:${value.reason}`;
  const actualKeys = actual.map(key);
  const expectedKeys = expected.map(key);
  return new Set(actualKeys).size === actualKeys.length
    && new Set(expectedKeys).size === expectedKeys.length
    && actualKeys.length === expectedKeys.length
    && actualKeys.every((value) => expectedKeys.includes(value));
}

function neutralizeCandidateLanguage(output: TodayUserNarrative): TodayUserNarrative {
  const sanitize = (value: string) => value
    .replace(/另一款候选产品/gu, "另一件产品")
    .replace(/另一款候选/gu, "另一件产品")
    .replace(/其他产品也可以/gu, "另一件产品也并非不适合")
    .replace(/候选产品/gu, "另一件产品")
    .replace(/候选/gu, "另一件产品");

  return {
    entries: output.entries.map((entry) => ({
      ...entry,
      reason: sanitize(entry.reason),
      usage: sanitize(entry.usage),
      comparison_note: entry.comparison_note === null
        ? null
        : sanitize(entry.comparison_note),
    })),
    ...(output.purposeOmissions ? {
      purposeOmissions: output.purposeOmissions.map((omission) => ({
        ...omission,
        message: sanitize(omission.message),
      })),
    } : {}),
  };
}

function requiresComparisonNote(step: TodayUserNarrativeInput["steps"][number]) {
  const rationale = step.selectionRationale;
  return rationale !== null
    && rationale.comparisonMode !== null
    && rationale.comparableCandidateCount >= 2
    && (rationale.comparableProducts?.length ?? 0) > 0
    && rationale.relevantDifferences.length > 0
    && rationale.whySelectedToday.trim().length > 0
    && productFactsHaveConsumerValue(step.productFacts)
    && rationale.comparableProducts!.some((product) => productFactsIdentifyPurpose(product.productFacts));
}

function productFactsHaveConsumerValue(facts: TodayUserNarrativeInput["steps"][number]["productFacts"]) {
  return facts.claims.length > 0
    || facts.texture.length > 0
    || facts.usage.length > 0
    || facts.capabilities.length > 0
    || facts.consumerIngredients.length > 0
    || (facts.ingredientKnowledge?.length ?? 0) > 0;
}

function productFactsIdentifyPurpose(facts: TodayUserNarrativeInput["steps"][number]["productFacts"]) {
  return facts.productType !== null
    || facts.usage.length > 0
    || facts.capabilities.length > 0
    || facts.claims.length > 0;
}

function shouldUseBaselineTypeBackedReason(step: TodayUserNarrativeInput["steps"][number]) {
  return step.baselineTypeBackedPurpose === true
    && step.selectionRationale === null;
}

function baselineTypeBackedReason(purpose: string) {
  return purpose === "cleansing"
    ? "今天需要完成基础清洁，这瓶是你已有的洁面产品，可以承担这一步。"
    : "今天需要完成基础保湿，这瓶是你已有的保湿产品，可以承担这一步。";
}

function containsRawIngredientLeak(narrative: string, steps: TodayUserNarrativeInput["steps"]) {
  // A product brand can legitimately contain Latin text. Only reject an exact
  // raw INCI mention that was not passed as a consumer-display ingredient.
  const rawIngredientNames = steps.flatMap((step) => step.productFacts.consumerIngredients)
    .filter((name) => /[a-z]/iu.test(name));
  return rawIngredientNames.some((name) => narrative.includes(name));
}
