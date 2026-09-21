import "server-only";
import { providerRequestSignal } from "@/server/integrations/provider-request-timeout";
import {
  productionMinimalCarePlannerDecisionSchema,
  projectProductionMinimalCarePlannerDecision,
  type CarePlannerDecision,
  type CarePlannerInput,
  type CarePlannerProvider,
} from "./today-care-planner-service";

const instructions = "You are Beauty OS's non-medical Today Care Planner. Use the compact input exactly as labeled. routineRolePreferences contains explicit user soft preferences scoped to one period and routine role. Respect an avoid preference strongly in its matching period under normal circumstances, but never treat it as safety, deterministic eligibility, a hard exclusion, or a permanent ban. It does not apply to another period or become dislike of any specific product. If current context justifies selecting a role despite an explicit avoid preference, the selected step's why_today and whySelectedToday must acknowledge the scoped preference and clearly explain the current contextual reason. A prefer preference is also soft and cannot force an unnecessary step. profileSoftPreferences are durable Profile context: texturePreferences are soft preferences only, useful to differentiate otherwise suitable options; skinGoals are long-term priorities, useful only when compatible with today's skin state and safety. Neither may override current skin needs, safety, evidence, recent adverse feedback, inventory eligibility, hardRestrictions, or force a treatment or extra step. When durable Profile preferences conflict with personalMemoryContext, Profile takes precedence. personalMemoryContext is optional private, long-term preference context. It may help compare otherwise suitable candidates, routine complexity, texture, local-care habits, and natural rationale. It is soft only: never treat it as today's skin fact, Profile, product fact, Usage History, safety data, a hard rule, or permanent exclusion; it cannot override daily signals, Profile, inventory eligibility, product usage, avoid ingredients, or hardRestrictions. skinContext.signals with source today_confirmed or manual_override are observations from today; source baseline_inherited is long-term background only and must never be rewritten as a fact observed today. weatherContext is environmental context only and must never be turned into a skin symptom. todayTargetedCareSignals lists only today's confirmed/manual blemishes or small_bumps signals. A baseline-only acne, blackhead, blemish, or small-bumps tendency never makes an anti-blemish step required today: it may be considered as optional care, and if selected the explanation must not imply a new blemish today. A signal in todayTargetedCareSignals may be a main care focus when the selected product facts support a limited, non-medical judgment. In relevantSkinSignals and relevantWeatherSignals cite only supplied signalId values. In evidence_refs cite only refs listed on that same eligible product. Choose only eligible products. Each eligible product has private usageHistory for this exact owned product from the recent 30 days and the requested period only; reaction safety remains cross-period before Planner eligibility. usageHistory is soft personalization only: use stable positive experience or repeated preference issues to distinguish otherwise suitable candidates, fit judgment, and selection rationale; never turn it into a fixed score, a medical fact, a permanent ban, or a claim about another user. Do not expose numeric ratings or counts. Products with repeated high-level reactions have already been removed by hard safety and cannot be reintroduced. cleansing and sun_protection are hard factual purposes: select them only when that candidate's supportedPurposes contains the purpose. hydration_support, basic_moisturization, and optional_treatment are ordinary care judgments: you may consider them from the candidate's known product facts, claims, texture, usage, cautions, ingredients, ingredientKnowledge, and usageHistory, together with current skin context, profile, and weather. Each ingredients entry labels applicability as hard, advisory, or both. evidenceRefs supports every labeled meaning; when hard and advisory refs differ, hardEvidenceRefs and advisoryEvidenceRefs preserve them separately. Hard means a normalized product ingredient fact; advisory means a source-referenced mention for ordinary fit comparison only. ingredientKnowledge is a compact, sourced cosmetic/formulation fact about an ingredient actually present in that same product. Its functions are short labels; use statementZh for an explainable Chinese fact and boundaries to prevent overclaiming. It is advisory fit material, never proof of a medical effect, safety outcome, or formal product capability. Use it only in combination with product-level facts and current context; never make a single ingredient deterministically explain a skin outcome. Do not treat product type as the entire answer for basic_moisturization: an emulsion, lotion, cream, or serum-like product may serve as a light moisturizing finish only when its name/identity, claims, texture, usage, formulation facts, and today's context together support that limited judgment. An ingredient's advisory applicability is for limited fit comparison only: never use one ingredient to claim a certain skin outcome, safety, medical efficacy, or a formal capability. When candidates compete for the same purpose, compare their relevant ingredient mentions, ingredientKnowledge, claims, texture, usage, cautions, usageHistory, profileSoftPreferences, skin context, weather, and personalMemoryContext where those facts actually differ; do not compare only supportedPurposes. For every selected step, selection_rationale must name its real candidate IDs (including the selected ID), one to three relevant factual differences, why this product is preferred today, and whether the distinction is clear or uncertain. It is a concise judgment trace, not a score or a claim of superiority. For an AI-judged intent that is not listed in supportedPurposes, cite at least one real evidence ref and describe it as a limited consideration, never as verified efficacy or medical treatment. Assess only selected products. Compare candidates where useful, but do not infer an absent fact. baselineRoles and dailyPriorities are advisory context, not mandatory steps. You may select multiple same-purpose products when they have distinct value; state the distinction briefly. For every selected step, value_if_removed must name only the distinct purpose value lost, not predict harm or a skin outcome; omit a step if no distinct value would be lost. Weather may inform routine weight, product feel, layering, and sun-protection judgment when the supplied facts make that reasoning relevant; never turn weather into a skin symptom. Never describe unselected candidates as risky or irritating without explicit caution evidence. Never call draft_derived or candidate evidence verified. Never write gentler, stronger, better, more hydrating, or equivalent superiority language without explicit head-to-head evidence. If candidates cannot be distinguished, choose a reasonable minimum-sufficient option and mark selection_rationale certainty uncertain. Keep all text brief. careGuidance is advisory; hardRestrictions are inviolable. Return only the supplied JSON schema.";
const productionInstructions = instructions.replace(
  "For every selected step, value_if_removed must name only the distinct purpose value lost, not predict harm or a skin outcome; omit a step if no distinct value would be lost. ",
  "",
);
const MAX_OUTPUT_TOKENS = 4000;
// Real production Planner calls with the full decision context have completed
// successfully between 50s and 56s. Keep this deadline Planner-specific so
// narration providers retain their shorter shared failure budget.
const TODAY_CARE_PLANNER_TIMEOUT_MS = 75_000;
export function createVolcengineTodayCarePlannerProvider(options: { apiKey: string; model: string; baseUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number }): CarePlannerProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  // Short-term operational rollback only. Production defaults to Minimal and
  // both branches immediately normalize to the same validated decision shape.
  const useFullOutputContract = process.env.TODAY_CARE_PLANNER_OUTPUT_CONTRACT === "full";
  const outputContractInstructions = useFullOutputContract
    ? "The response schema is authoritative: selected_steps has no role, and selection_rationale contains only candidateIds, selectedProductId, relevantDifferences, whySelectedToday, and certainty. Put any alternative-specific comparison wording only in candidateComparisons.comparisonReason. Copy only applicable supplied preferenceRef values into preference_refs."
    : "The response schema is authoritative. For every selected step, return why_today for why this step is needed today; return whySelectedToday for why this owned product is chosen today; cite only supplied evidence_refs, relevantSkinSignalIds, relevantWeatherSignalIds, and applicable preferenceRef values in preference_refs. selection_rationale contains only real candidateIds, relevantDifferences, and certainty. Return candidateComparisons only for real comparisons, using its supplied membership and mode fields. notNeededPurposes may list only current, unselected purposes in the daily care scope that you judge are not needed today. Do not list step limits, unavailable evidence, or hard restrictions; those are determined after validation. Do not mention individual unselected products.";
  return { async plan(input: CarePlannerInput) {
    const startedAt = Date.now();
    const requestInstructions = `${productionInstructions} Every ownedProductId, selection_rationale.candidateIds, candidateComparisons.candidateIds, and candidateComparisons.selectedProductIds must copy a complete UUID verbatim from eligibleProducts[].ownedProductId. Never use a product name, alias, catalog_product_id, products.id, source ref, shortened UUID, or an ID you create yourself. ${outputContractInstructions}`;
    const providerInput = toProviderInput(input);
    const serializedProviderInput = JSON.stringify(providerInput);
    const responseSchema = useFullOutputContract ? fullResponseSchema : productionMinimalResponseSchema;
    const requestBody = {
      model: options.model,
      store: false,
      thinking: { type: "disabled" },
      instructions: requestInstructions,
      input: [{ role: "user", content: [{ type: "input_text", text: serializedProviderInput }] }],
      text: { format: { type: "json_schema", name: "today_care_planner", strict: true, schema: responseSchema } },
      max_output_tokens: MAX_OUTPUT_TOKENS,
    };
    const serializedRequestBody = JSON.stringify(requestBody);
    logPlannerPayloadSize({
      instructions: requestInstructions,
      schema: responseSchema,
      input: providerInput,
      totalSerializedChars: serializedRequestBody.length,
    });
    let response: Response | null = null;
    let transportFailure: ReturnType<typeof classifyTransportFailure> | null = null;
    try {
    response = await fetchImpl(options.baseUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
      signal: providerRequestSignal(options.timeoutMs ?? TODAY_CARE_PLANNER_TIMEOUT_MS),
      body: serializedRequestBody,
    });
    } catch (error) {
      transportFailure = classifyTransportFailure(error);
      throw error;
    } finally {
      if (process.env.NODE_ENV === "development") {
        const durationMs = Date.now() - startedAt;
        console.info("[today-care-planner]", {
          stage: "provider_request",
          durationMs,
          status: response?.status ?? "network_error",
          ...(transportFailure ? { duration_ms: durationMs, ...transportFailure } : {}),
        });
      }
    }
    if (!response || !response.ok) throw new Error("CARE_PLANNER_UNAVAILABLE");
    const payload = await response.json() as ProviderPayload;
    const extraction = extractProviderOutput(payload);
    logProviderResponseMetadata("provider_response_metadata", payload, extraction.metadata);
    const text = extraction.text;
    if (typeof text !== "string") throw new Error("CARE_PLANNER_INVALID_OUTPUT");
    const parsed = parseProviderJson(text, "provider_output_parse");
    if (parsed.success) return normalizeProviderDecision(parsed.value, useFullOutputContract);
    const structurallyClosed = closeCompleteJsonStructure(text);
    if (structurallyClosed === null) throw new Error("CARE_PLANNER_MALFORMED_OUTPUT");
    try {
      const value = JSON.parse(structurallyClosed);
      if (process.env.NODE_ENV === "development") {
        console.info("[today-care-planner]", { stage: "provider_output_structural_close", outputChars: text.length });
      }
      return normalizeProviderDecision(value, useFullOutputContract);
    } catch {
      throw new Error("CARE_PLANNER_MALFORMED_OUTPUT");
    }
  } };
}

function logPlannerPayloadSize(input: {
  instructions: string;
  schema: unknown;
  input: ReturnType<typeof toProviderInput>;
  totalSerializedChars: number;
}) {
  const eligibleProducts = input.input.eligibleProducts;
  const productChars = eligibleProducts.map(serializedChars);
  console.info("[today-care-planner]", {
    stage: "planner_payload_size",
    instructions_chars: input.instructions.length,
    schema_chars: serializedChars(input.schema),
    skin_context_chars: serializedChars({
      signals: input.input.skinContext.signals,
      todayTargetedCareSignals: input.input.skinContext.todayTargetedCareSignals,
    }),
    profile_chars: serializedChars({
      profileSoftPreferences: input.input.profileSoftPreferences,
      longTermProfile: input.input.skinContext.longTermProfile,
    }),
    weather_chars: serializedChars(input.input.weatherContext),
    memory_chars: serializedChars(input.input.personalMemoryContext),
    care_guidance_chars: serializedChars(input.input.careGuidance),
    eligible_products_chars: serializedChars(eligibleProducts),
    product_count: eligibleProducts.length,
    product_chars_min: productChars.length ? Math.min(...productChars) : 0,
    product_chars_max: productChars.length ? Math.max(...productChars) : 0,
    product_chars_avg: productChars.length
      ? Math.round(productChars.reduce((sum, value) => sum + value, 0) / productChars.length)
      : 0,
    planner_product_chars: productChars,
    planner_total_payload_chars: input.totalSerializedChars,
    total_serialized_chars: input.totalSerializedChars,
  });
}

function serializedChars(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0;
}

type TransportFailureKind =
  | "abort_timeout"
  | "connect_timeout"
  | "dns/network"
  | "connection_reset"
  | "other_transport";

function classifyTransportFailure(error: unknown): {
  error_name: string;
  cause_code: string | null;
  failure_kind: TransportFailureKind;
} {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  const causeCode = transportCauseCode(error);
  if (errorName === "TimeoutError") {
    return { error_name: errorName, cause_code: causeCode, failure_kind: "abort_timeout" };
  }
  if (causeCode === "UND_ERR_CONNECT_TIMEOUT") {
    return { error_name: errorName, cause_code: causeCode, failure_kind: "connect_timeout" };
  }
  if (causeCode === "ECONNRESET" || causeCode === "UND_ERR_SOCKET" || causeCode === "EPIPE") {
    return { error_name: errorName, cause_code: causeCode, failure_kind: "connection_reset" };
  }
  if (["ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED"].includes(causeCode ?? "")) {
    return { error_name: errorName, cause_code: causeCode, failure_kind: "dns/network" };
  }
  return { error_name: errorName, cause_code: causeCode, failure_kind: "other_transport" };
}

function transportCauseCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const directCode = "code" in error ? error.code : null;
  if (typeof directCode === "string") return directCode;
  const cause = "cause" in error ? error.cause : null;
  if (!cause || typeof cause !== "object" || !("code" in cause)) return null;
  return typeof cause.code === "string" ? cause.code : null;
}

function parseProviderJson(text: string, stage: "provider_output_parse") {
  try {
    const value = JSON.parse(text);
    return { success: true as const, value };
  } catch (error) {
    logOutputParse(stage, {
      success: false,
      outputChars: text.length,
      parseError: error instanceof Error ? error.message : "JSON_PARSE_FAILED",
    });
    return { success: false as const };
  }
}

function logOutputParse(stage: string, details: Record<string, unknown>) {
  if (process.env.NODE_ENV === "development") {
    console.info("[today-care-planner]", { stage, ...details });
  }
}

type ProviderPayload = {
  output_text?: unknown;
  output?: unknown;
  usage?: Record<string, unknown>;
  incomplete_details?: Record<string, unknown>;
  error?: Record<string, unknown>;
  stop_reason?: unknown;
  finish_reason?: unknown;
  status?: unknown;
  max_output_tokens?: unknown;
  choices?: Array<{ finish_reason?: unknown }>;
};

type ProviderOutputExtraction = {
  text: string | null;
  metadata: {
    extractionPath: "top_level_output_text" | "concatenated_segments" | "none";
    outputTextSegmentCount: number;
    outputTextSegmentCharLengths: number[];
    outputItemStatuses: Array<string | null>;
  };
};

function logProviderResponseMetadata(stage: string, payload: ProviderPayload, extraction: ProviderOutputExtraction["metadata"]) {
  if (process.env.NODE_ENV !== "development") return;
  const usage = payload.usage ?? {};
  const finishReason = stringValue(payload.finish_reason)
    ?? stringValue(payload.stop_reason)
    ?? stringValue(payload.choices?.[0]?.finish_reason)
    ?? null;
  console.info("[today-care-planner]", {
    stage,
    responseStatus: stringValue(payload.status),
    finishReason,
    incompleteReason: stringValue(payload.incomplete_details?.reason),
    errorCode: stringValue(payload.error?.code),
    inputTokens: numberValue(usage.input_tokens) ?? numberValue(usage.prompt_tokens),
    outputTokens: numberValue(usage.output_tokens) ?? numberValue(usage.completion_tokens),
    maxOutputTokens: numberValue(payload.max_output_tokens) ?? MAX_OUTPUT_TOKENS,
    ...extraction,
  });
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractProviderOutput(payload: ProviderPayload): ProviderOutputExtraction {
  const outputItemStatuses = Array.isArray(payload.output)
    ? payload.output.map((item) => item && typeof item === "object" && "status" in item ? stringValue(item.status) : null)
    : [];
  if (typeof payload.output_text === "string") {
    return {
      text: payload.output_text,
      metadata: {
        extractionPath: "top_level_output_text",
        outputTextSegmentCount: 1,
        outputTextSegmentCharLengths: [payload.output_text.length],
        outputItemStatuses,
      },
    };
  }
  if (!Array.isArray(payload.output)) {
    return { text: null, metadata: { extractionPath: "none", outputTextSegmentCount: 0, outputTextSegmentCharLengths: [], outputItemStatuses } };
  }
  const segments: string[] = [];
  for (const outputItem of payload.output) {
    if (!outputItem || typeof outputItem !== "object" || !("content" in outputItem)) continue;
    const content = outputItem.content;
    if (!Array.isArray(content)) continue;
    for (const contentItem of content) {
      if (
        contentItem
        && typeof contentItem === "object"
        && "type" in contentItem
        && contentItem.type === "output_text"
        && "text" in contentItem
        && typeof contentItem.text === "string"
      ) {
        segments.push(contentItem.text);
      }
    }
  }
  return {
    text: segments.length > 0 ? segments.join("") : null,
    metadata: {
      extractionPath: segments.length > 0 ? "concatenated_segments" : "none",
      outputTextSegmentCount: segments.length,
      outputTextSegmentCharLengths: segments.map((segment) => segment.length),
      outputItemStatuses,
    },
  };
}

/**
 * Only closes an otherwise complete JSON document. It never completes a
 * string, invents a value, or asks another model to recreate a decision.
 */
function closeCompleteJsonStructure(text: string) {
  const closers: string[] = [];
  let inString = false;
  let escaping = false;
  for (const char of text) {
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      closers.push("}");
    } else if (char === "[") {
      closers.push("]");
    } else if (char === "}" || char === "]") {
      if (closers.pop() !== char) return null;
    }
  }
  if (inString || closers.length === 0) return null;
  return `${text}${closers.reverse().join("")}`;
}

function toProviderInput(input: CarePlannerInput) {
  return {
    personalMemoryContext: input.personalMemoryContext?.slice(0, 5) ?? [],
    profileSoftPreferences: input.softPersonalization,
    routineRolePreferences: input.routineRolePreferences ?? [],
    period: input.period,
    skinContext: {
      signals: input.skinSignals ?? [],
      todayTargetedCareSignals: (input.skinSignals ?? []).filter((signal) =>
        (signal.source === "today_confirmed" || signal.source === "manual_override")
        && (signal.concern === "blemishes" || signal.concern === "small_bumps"),
      ),
      longTermProfile: input.longTermContext,
    },
    weatherContext: input.weather,
    recentHistory: input.recentHistory,
    eligibleProducts: input.eligibleProducts.map(toProviderProduct),
    careGuidance: input.careGuidance,
    hardRestrictions: input.hardRestrictions,
    unknowns: input.unknowns,
    baselineRoles: input.baselineRoles,
    dailyPriorities: input.dailyPriorities,
    purposeContext: input.purposeContext,
    maxSteps: input.maxSteps,
  };
}

type PlannerProduct = CarePlannerInput["eligibleProducts"][number];
type ProductIngredient = {
  name: string;
  applicability: "hard" | "advisory" | "both";
  evidenceRefs?: string[];
  hardEvidenceRefs?: string[];
  advisoryEvidenceRefs?: string[];
  advisoryName?: string;
};

function toProviderProduct(product: PlannerProduct) {
  const evidence = product.productEvidence;
  return {
    ownedProductId: product.ownedProductId,
    displayName: product.displayName,
    productType: product.productType,
    supportedPurposes: product.supportedPurposes,
    baselineTypeBackedPurposes: product.baselineTypeBackedPurposes,
    productEvidence: {
      claims: evidence.claims,
      usage: evidence.usage,
      texture: evidence.texture,
      ingredients: mergeProviderIngredients(evidence.ingredients, evidence.advisoryIngredients),
      ingredientKnowledge: evidence.ingredientKnowledge,
      evidenceRefs: evidence.evidenceRefs,
      provenance: evidence.provenance,
      unknownFields: evidence.unknownFields,
    },
    inventory: { quantityBucket: quantityBucket(product.inventory.quantityPercent) },
    usageHistory: product.usageHistory,
  };
}

function quantityBucket(value: number) {
  if (value <= 10) return "nearly_empty";
  if (value <= 30) return "low";
  if (value <= 70) return "medium";
  return "high";
}

function mergeProviderIngredients(
  hard: PlannerProduct["productEvidence"]["ingredients"],
  advisory: PlannerProduct["productEvidence"]["advisoryIngredients"],
): ProductIngredient[] {
  const advisoryByName = new Map<string, Array<(typeof advisory)[number]>>();
  for (const ingredient of advisory) {
    const key = ingredientKey(ingredient.name);
    advisoryByName.set(key, [...(advisoryByName.get(key) ?? []), ingredient]);
  }

  const merged: ProductIngredient[] = hard.map((ingredient) => {
    const key = ingredientKey(ingredient.normalizedName);
    const matchingAdvisory = advisoryByName.get(key)?.shift();
    if (!matchingAdvisory) {
      return {
        name: ingredient.normalizedName,
        applicability: "hard",
        evidenceRefs: ingredient.evidenceRefs,
      };
    }
    const sharedEvidence = sameStrings(
      ingredient.evidenceRefs,
      matchingAdvisory.evidenceRefs,
    );
    return {
      name: ingredient.normalizedName,
      applicability: "both",
      ...(sharedEvidence
        ? { evidenceRefs: ingredient.evidenceRefs }
        : {
            hardEvidenceRefs: ingredient.evidenceRefs,
            advisoryEvidenceRefs: matchingAdvisory.evidenceRefs,
          }),
      ...(matchingAdvisory.name === ingredient.normalizedName
        ? {}
        : { advisoryName: matchingAdvisory.name }),
    };
  });
  for (const ingredients of advisoryByName.values()) {
    for (const ingredient of ingredients) {
      merged.push({
        name: ingredient.name,
        applicability: "advisory",
        evidenceRefs: ingredient.evidenceRefs,
      });
    }
  }
  return merged;
}

function ingredientKey(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

const fullResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["strategy", "strategy_summary", "selected_steps", "unresolved_needs", "usedGuidanceIds", "productFitAssessments", "candidateComparisons"],
  properties: {
    strategy: { type: "string", enum: ["maintain", "simplify", "barrier_focused", "balanced"] },
    strategy_summary: { type: "string", minLength: 1, maxLength: 180 },
    selected_steps: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ownedProductId", "purpose", "why_today", "why_this_product", "evidence_refs", "preference_refs", "selection_rationale"],
        properties: {
          ownedProductId: { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" },
          purpose: { type: "string", enum: ["cleansing", "basic_moisturization", "hydration_support", "sun_protection", "optional_treatment"] },
          why_today: { type: "string", minLength: 1, maxLength: 90 },
          why_this_product: { type: "string", minLength: 1, maxLength: 90 },
          value_if_removed: { type: "string", minLength: 1, maxLength: 100 },
          evidence_refs: { type: "array", maxItems: 3, items: { type: "string", minLength: 1, maxLength: 120 } },
          preference_refs: { type: "array", maxItems: 6, items: { type: "string", minLength: 1, maxLength: 100 } },
          selection_rationale: { type: "object", additionalProperties: false, required: ["candidateIds", "selectedProductId", "relevantDifferences", "whySelectedToday", "certainty"], properties: {
            candidateIds: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" } },
            selectedProductId: { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" },
            relevantDifferences: { type: "array", maxItems: 2, items: { type: "string", minLength: 1, maxLength: 90 } },
            whySelectedToday: { type: "string", minLength: 1, maxLength: 110 },
            certainty: { type: "string", enum: ["clear", "uncertain"] },
          } },
        },
      },
    },
    unresolved_needs: { type: "array", maxItems: 4, items: { type: "string", minLength: 1, maxLength: 120 } },
    usedGuidanceIds: { type: "array", maxItems: 6, items: { type: "string", pattern: "^GUIDE-" } },
    productFitAssessments: {
      type: "object",
      additionalProperties: false,
      required: ["selected"],
      properties: {
        selected: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["ownedProductId", "relevantSkinSignals", "relevantWeatherSignals", "relevantEvidenceRefs", "fitSummary", "fitLevel", "uncertainty"],
            properties: {
              ownedProductId: { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" },
              relevantSkinSignals: { type: "array", maxItems: 4, items: { type: "string", minLength: 1, maxLength: 160 } },
              relevantWeatherSignals: { type: "array", maxItems: 4, items: { type: "string", minLength: 1, maxLength: 80 } },
              relevantEvidenceRefs: { type: "array", maxItems: 3, items: { type: "string", minLength: 1, maxLength: 120 } },
              fitSummary: { type: "string", minLength: 1, maxLength: 90 },
              fitLevel: { type: "string", enum: ["strong", "reasonable", "weak", "not_recommended"] },
              uncertainty: { type: "array", maxItems: 1, items: { type: "string", minLength: 1, maxLength: 120 } },
            },
          },
        },
      },
    },
    candidateComparisons: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["purpose", "candidateIds", "selectedProductIds", "selectionMode", "comparisonReason", "multipleSelectionReason", "uncertainty"],
        properties: {
          purpose: { type: "string", enum: ["cleansing", "basic_moisturization", "hydration_support", "sun_protection", "optional_treatment"] },
          candidateIds: { type: "array", minItems: 2, maxItems: 6, items: { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" } },
          selectedProductIds: { type: "array", minItems: 1, maxItems: 3, items: { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" } },
          selectionMode: { type: "string", enum: ["single", "complementary_multiple"] },
          comparisonReason: { type: "string", minLength: 1, maxLength: 90 },
          multipleSelectionReason: { type: ["string", "null"], maxLength: 90 },
          uncertainty: { type: "array", minItems: 1, maxItems: 1, items: { type: "string", minLength: 1, maxLength: 100 } },
        },
      },
    },
  },
};

const uuidSchema = { type: "string", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" };
const purposeSchema = { type: "string", enum: ["cleansing", "basic_moisturization", "hydration_support", "sun_protection", "optional_treatment"] };
const productionMinimalResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["strategy", "strategy_summary", "selected_steps", "unresolved_needs", "candidateComparisons", "notNeededPurposes"],
  properties: {
    strategy: { type: "string", enum: ["maintain", "simplify", "barrier_focused", "balanced"] },
    strategy_summary: { type: "string", minLength: 1, maxLength: 180 },
    selected_steps: {
      type: "array", minItems: 1, maxItems: 8,
      items: {
        type: "object", additionalProperties: false,
        required: ["ownedProductId", "purpose", "why_today", "whySelectedToday", "evidence_refs", "preference_refs", "relevantSkinSignalIds", "relevantWeatherSignalIds", "selection_rationale"],
        properties: {
          ownedProductId: uuidSchema,
          purpose: purposeSchema,
          why_today: { type: "string", minLength: 1, maxLength: 90 },
          whySelectedToday: { type: "string", minLength: 1, maxLength: 110 },
          evidence_refs: { type: "array", maxItems: 3, items: { type: "string", minLength: 1, maxLength: 120 } },
          preference_refs: { type: "array", maxItems: 6, items: { type: "string", minLength: 1, maxLength: 100 } },
          relevantSkinSignalIds: { type: "array", maxItems: 4, items: { type: "string", minLength: 1, maxLength: 160 } },
          relevantWeatherSignalIds: { type: "array", maxItems: 4, items: { type: "string", minLength: 1, maxLength: 80 } },
          selection_rationale: {
            type: "object", additionalProperties: false,
            required: ["candidateIds", "relevantDifferences", "certainty"],
            properties: {
              candidateIds: { type: "array", minItems: 1, maxItems: 6, items: uuidSchema },
              relevantDifferences: { type: "array", maxItems: 2, items: { type: "string", minLength: 1, maxLength: 90 } },
              certainty: { type: "string", enum: ["clear", "uncertain"] },
            },
          },
        },
      },
    },
    unresolved_needs: { type: "array", maxItems: 4, items: { type: "string", minLength: 1, maxLength: 120 } },
    notNeededPurposes: { type: "array", maxItems: 5, items: purposeSchema },
    candidateComparisons: {
      type: "array", maxItems: 5,
      items: {
        type: "object", additionalProperties: false,
        required: ["purpose", "candidateIds", "selectedProductIds", "selectionMode", "comparisonReason", "multipleSelectionReason"],
        properties: {
          purpose: purposeSchema,
          candidateIds: { type: "array", minItems: 2, maxItems: 6, items: uuidSchema },
          selectedProductIds: { type: "array", minItems: 1, maxItems: 3, items: uuidSchema },
          selectionMode: { type: "string", enum: ["single", "complementary_multiple"] },
          comparisonReason: { type: "string", minLength: 1, maxLength: 90 },
          multipleSelectionReason: { type: ["string", "null"], maxLength: 90 },
        },
      },
    },
  },
};

function normalizeProviderDecision(value: unknown, useFullOutputContract: boolean): CarePlannerDecision {
  if (useFullOutputContract) return value as CarePlannerDecision;
  const parsed = productionMinimalCarePlannerDecisionSchema.safeParse(value);
  if (!parsed.success) throw new Error("CARE_PLANNER_MINIMAL_SCHEMA_INVALID");
  return projectProductionMinimalCarePlannerDecision(parsed.data);
}

export function createConfiguredTodayCarePlannerProvider(): CarePlannerProvider | null {
  const apiKey = (process.env.TODAY_CARE_PLANNER_KEY ?? process.env.VOLCENGINE_AGENT_PLAN_KEY)?.trim();
  const model = (process.env.TODAY_CARE_PLANNER_MODEL ?? process.env.VOLCENGINE_AGENT_PLAN_MODEL)?.trim();
  const baseUrl = (process.env.TODAY_CARE_PLANNER_BASE_URL ?? process.env.VOLCENGINE_AGENT_PLAN_BASE_URL)?.trim();
  return apiKey && model && baseUrl ? createVolcengineTodayCarePlannerProvider({ apiKey, model, baseUrl }) : null;
}
