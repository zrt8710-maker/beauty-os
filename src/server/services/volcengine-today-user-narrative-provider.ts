import "server-only";
import { providerRequestSignal } from "@/server/integrations/provider-request-timeout";

import {
  TodayUserNarrativeProviderError,
  type NarrativeProviderFailureDetails,
  type TodayUserNarrativeInput,
  type TodayUserNarrativeProvider,
} from "./today-user-narrative-service";

const instructions = "You are Beauty OS's consumer-facing private skincare assistant. Write natural, warm Chinese only. You receive a fixed, already validated routine plus a bounded set of relevant facts loaded for this same request. You only organize that decision and those facts into user language: do not select products, change steps, add a product, or invent a user-specific fact. input.steps is the fixed final routine order; any sequencing or practical-use language must agree with that order. The page separately shows why this step is needed today. purposeOmissions is an already validated, purpose-level decision trace. Return exactly the same purpose and reason entries in purposeOmissions. Its message may only express that supplied reason in natural Chinese; never infer a new omission reason, name an unselected product, or turn it into a recommendation. If purposeOmissions is empty, return an empty array. If baselineTypeBackedPurpose is true, this is only a conservative basic step based on the user's confirmed product identity and type: reason must stay as simple as ‘今天需要完成基础清洁/保湿，这瓶是你已有的对应产品，可以承担这一步’ in natural Chinese. Do not add product facts, texture, ingredients, capabilities, safety, preferences, weather, recent experience, or comparison; comparison_note must be null. Otherwise, whyThisProduct and selectionRationale are the validated Planner's primary explanation of why this decision was made today. Preserve their decision logic and express it naturally; do not independently reconstruct or replace the selection reasoning. Product facts support, enrich, and make that rationale concrete. reason must make three links clear when the supplied facts permit them: why this step matters now, why this named product was selected, and how its relevant capability, claim, ingredient, texture, or usage fact connects to that need. Product facts are supporting material, not a database dump: never list them without explaining why they matter. relevantSkinContext contains only signals used by this validated step. A timeframe of today may be phrased as 今天、今日 or 当前. A timeframe of baseline is long-term context and may only be phrased as 平时、通常 or 长期倾向; never turn it into today's observation. relevantWeatherContext is present only when weather affected this validated step; mention it only when it makes the decision easier to understand, and never turn weather into a skin symptom. Distinguish user-specific facts from general skincare background. A statement about this user's observed condition must come from relevantSkinContext, weather, Profile, Usage, Memory, or Product Knowledge and preserve its timeframe. Ordinary non-medical care background may be stated generically—for example, morning cleansing can remove overnight oil, evening cleansing commonly removes sunscreen or surface dirt, and avoiding excessive post-cleansing tightness can be a practical goal. Never rewrite that background as an unsupported observation such as “you produced a lot of oil last night” or “your face has heavy residue today.” Use texture only when it connects to the supplied skin context or softPersonalization.texturePreferences. softPersonalization, recentExperience, and relevantMemoryContext are already relevance-filtered soft context: mention them only when they help explain this exact choice. A skin goal or memory is long-term context, never a claim about today's symptom. Return comparison_note separately from reason. comparison_note is required and non-null exactly when selectionRationale.comparisonMode is strong or lightweight_contextual, at least one comparableProducts entry is supplied, relevantDifferences and whySelectedToday are non-empty, the selected product has a concrete product fact, and an alternative has a supplied product type, usage, capability, or claim. In that case, write one or two natural sentences explaining why this product is preferred today among the user's existing products. Use whySelectedToday and relevantDifferences as the primary decision trace, then use both products' known facts and relevant context to make it concrete. validatedComparisonReason is secondary supporting context. Do not make a comparison in reason. When those conditions are not all met, comparison_note must be null. selectionRationale.comparableProducts contains only validator-retained real alternatives and their bounded known facts. Missing fields are absent dimensions, never negative product signals. When a comparable product is present and its facts make the contrast useful, name its exact productName and explain the known facts that make today's choice lean toward the selected product. Never infer a missing difference or rank either product absolutely. Do not repeat the same preference claim across steps. usage is one or two concrete operation sentences only: where this step sits in the supplied order, amount, area, local application, last-step use, or areas to avoid when those facts are supplied. usage must never explain why the product was selected. ingredientKnowledge contains compact Chinese facts about ingredients actually in that product; you may use at most one or two only when they help this exact fit. Its functions are short labels, statementZh is the ingredient explanation, and boundaries prevent overclaiming. Explain an ingredient only through these supplied facts and alongside the product's claim, texture, capability, or usage; never infer a certain efficacy or safety outcome from one ingredient. Mention at most one or two supplied consumerIngredients only when they materially help explain the fit. Do not output raw English INCI names. The person, not the product database, must be the subject of the explanation. Do not mention evidence, confidence, advisory, draft, verified, unknown, source, supported purpose, runtime, validator, comparison uncertainty, score, ranking, candidate IDs, or technical fields. Do not claim an ingredient will certainly cause a skin outcome. Return only the supplied JSON schema.";

const productionInstructions = instructions
  .replace(
    "If baselineTypeBackedPurpose is true,",
    "relevantRoutineRolePreferences contains explicit user preferences about whether a role belongs in one AM/PM routine. Preserve that exact scope: describe it only as an early/late routine-step tendency, never as dislike or preference for the selected product. Product recentExperience is about that exact product and must never be generalized into a routine-role or period preference. If a selected step conflicts with an avoid preference, preserve the Planner's supplied contextual reason and acknowledge the preference rather than pretending it does not exist. If baselineTypeBackedPurpose is true,",
  )
  .replace("If baselineTypeBackedPurpose is true,", "If baselineTypeBackedPurpose is true and selectionRationale is null,")
  .replace(
    "do not name it unless its name materially helps understanding.",
    "you may name only a product listed in selectionRationale.comparableProducts when its name makes the contrast clearer.",
  );

export function createVolcengineTodayUserNarrativeProvider(options: { apiKey: string; model: string; baseUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number }): TodayUserNarrativeProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async narrate(input: TodayUserNarrativeInput) {
      const startedAt = Date.now();
      let response: Response | null = null;
      try {
        response = await fetchImpl(options.baseUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
          signal: providerRequestSignal(options.timeoutMs),
          body: JSON.stringify({
            model: options.model,
            store: false,
            thinking: { type: "disabled" },
            instructions: `${productionInstructions} selectionRationale.comparisonMode is an internal boundary and must never be verbalized. For both lightweight_contextual and strong comparisons, follow the validated Planner rationale rather than making a new selection argument. Consumer value has this priority: whySelectedToday and relevantDifferences, today's need or long-term context, the current purpose, the selected and alternative products' supplied known facts, then only relevant preference or actual experience, ending with why this run leans toward the selected product. Select the most relevant two or three supporting facts; do not list every field. If the alternative has only a supplied facial-cleansing product type or usage fact, you may naturally say it can handle daily facial cleansing; do not turn that into a stronger capability claim. Name the real alternative when available. A useful shape is “B 可以承担 X；今天因为 Y，所以这次更偏向 A”, but do not copy facts from this example. Partial Product Knowledge is expected: a missing field only limits what you may say about that dimension. Never treat missing knowledge, fuller documentation, clearer official wording, evidence availability, reliability, or confidence as a product advantage, disadvantage, or preference reason. Never guess an absent texture, finish feel, ingredient, capability, or claim. Contextual phrases such as “今天更偏向”, “更符合今天的需求”, and “这次先选” are allowed when supported by supplied facts. Never say 优于、不如、更好、最好、更强, or imply generalized absolute superiority.`,
            input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(input) }] }],
            text: { format: { type: "json_schema", name: "today_user_narrative", strict: true, schema: responseSchema } },
            max_output_tokens: 1500,
          }),
        });
      } finally {
        if (process.env.NODE_ENV === "development") {
          console.info("[today-care-planner]", { stage: "consumer_narrative_provider", durationMs: Date.now() - startedAt, status: response?.status ?? "network_error" });
        }
      }
      if (!response || !response.ok) {
        throw new TodayUserNarrativeProviderError("http_failure", emptyFailureDetails(response?.status ?? null));
      }
      let payload: ProviderPayload;
      try {
        payload = await response.json() as ProviderPayload;
      } catch {
        throw new TodayUserNarrativeProviderError("other_response_failure", emptyFailureDetails(response.status));
      }
      const extraction = extractOutputText(payload);
      const details = providerFailureDetails(response.status, payload, extraction);
      if (extraction.text === null) {
        throw new TodayUserNarrativeProviderError(
          extraction.hasEmptyText ? "empty_output" : "extraction_failure",
          details,
        );
      }
      const parsed = parseNarrativeJson(extraction.text, details);
      if (parsed.success) return parsed.value;
      throw new TodayUserNarrativeProviderError(parsed.subtype, details);
    },
  };
}

type ProviderPayload = {
  output_text?: unknown;
  output?: unknown;
  status?: unknown;
  finish_reason?: unknown;
  incomplete_details?: { reason?: unknown } | null;
  error?: { code?: unknown } | null;
  usage?: { input_tokens?: unknown; output_tokens?: unknown } | null;
};

function extractOutputText(payload: ProviderPayload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return { text: payload.output_text, path: "top_level_output_text" as const, segmentCount: 1, segmentLengths: [payload.output_text.length], hasEmptyText: false };
  }
  const segments: string[] = [];
  let hasEmptyText = typeof payload.output_text === "string";
  if (Array.isArray(payload.output)) {
    for (const outputItem of payload.output) {
      if (!outputItem || typeof outputItem !== "object" || !("content" in outputItem) || !Array.isArray(outputItem.content)) continue;
      for (const content of outputItem.content) {
        if (!content || typeof content !== "object" || !("type" in content) || content.type !== "output_text" || !("text" in content) || typeof content.text !== "string") continue;
        hasEmptyText ||= content.text.trim().length === 0;
        if (content.text.trim()) segments.push(content.text);
      }
    }
  }
  return {
    text: segments.length ? segments.join("") : null,
    path: segments.length ? "concatenated_segments" as const : "none" as const,
    segmentCount: segments.length,
    segmentLengths: segments.map((segment) => segment.length),
    hasEmptyText,
  };
}

function parseNarrativeJson(text: string, details: NarrativeProviderFailureDetails):
  | { success: true; value: unknown }
  | { success: false; subtype: "malformed_json" | "incomplete_or_truncated" } {
  try {
    return { success: true, value: JSON.parse(text) };
  } catch {
    const extracted = extractCompleteJsonObject(text);
    if (extracted !== null) {
      try {
        return { success: true, value: JSON.parse(extracted) };
      } catch {
        // Continue to the only safe structural recovery below.
      }
    }
    const closed = closeCompleteJsonStructure(text);
    if (closed !== null) {
      try {
        return { success: true, value: JSON.parse(closed) };
      } catch {
        // The model's business content is not complete enough to recover.
      }
    }
    return {
      success: false,
      subtype: details.incompleteReason !== null || looksTruncated(text)
        ? "incomplete_or_truncated"
        : "malformed_json",
    };
  }
}

function extractCompleteJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}

function closeCompleteJsonStructure(text: string) {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") stack.push("}");
    else if (character === "[") stack.push("]");
    else if (character === "}" || character === "]") {
      if (stack.pop() !== character) return null;
    }
  }
  return inString || stack.length === 0 ? null : `${text}${stack.reverse().join("")}`;
}

function looksTruncated(text: string) {
  return /(?:[,:]|")\s*$/u.test(text) || !/[}\]]\s*$/u.test(text);
}

function providerFailureDetails(
  responseStatus: number,
  payload: ProviderPayload,
  extraction: ReturnType<typeof extractOutputText>,
): NarrativeProviderFailureDetails {
  const outputItems = Array.isArray(payload.output) ? payload.output.filter(
    (item): item is Record<string, unknown> => item !== null && typeof item === "object",
  ) : [];
  return {
    responseStatus,
    finishReason: stringOrNull(payload.finish_reason)
      ?? outputItems.map((item) => stringOrNull(item.finish_reason)).find((value) => value !== null)
      ?? null,
    incompleteReason: stringOrNull(payload.incomplete_details?.reason),
    outputTextSegmentCount: extraction.segmentCount,
    outputChars: extraction.text?.length ?? 0,
    inputTokens: numberOrNull(payload.usage?.input_tokens),
    outputTokens: numberOrNull(payload.usage?.output_tokens),
  };
}

function emptyFailureDetails(responseStatus: number | null): NarrativeProviderFailureDetails {
  return { responseStatus, finishReason: null, incompleteReason: null, outputTextSegmentCount: 0, outputChars: 0, inputTokens: null, outputTokens: null };
}
function stringOrNull(value: unknown) { return typeof value === "string" ? value : null; }
function numberOrNull(value: unknown) { return typeof value === "number" ? value : null; }

const responseSchema = {
  type: "object", additionalProperties: false, required: ["entries", "purposeOmissions"], properties: {
    entries: {
      type: "array", maxItems: 8, items: {
        type: "object", additionalProperties: false,
        required: ["ownedProductId", "reason", "comparison_note", "usage"],
        properties: {
          ownedProductId: { type: "string" },
          reason: { type: "string", minLength: 1, maxLength: 700 },
          comparison_note: { type: ["string", "null"], maxLength: 420 },
          usage: { type: "string", minLength: 1, maxLength: 360 },
        },
      },
    },
    purposeOmissions: {
      type: "array", maxItems: 5, items: {
        type: "object", additionalProperties: false,
        required: ["purpose", "reason", "message"],
        properties: {
          purpose: { type: "string", enum: ["cleansing", "basic_moisturization", "hydration_support", "sun_protection", "optional_treatment"] },
          reason: { type: "string", enum: ["not_needed_today", "deferred_by_step_limit", "no_eligible_evidence", "hard_restricted"] },
          message: { type: "string", minLength: 1, maxLength: 240 },
        },
      },
    },
  },
};

export function createConfiguredTodayUserNarrativeProvider(): TodayUserNarrativeProvider | null {
  const apiKey = (process.env.TODAY_CARE_NARRATIVE_KEY ?? process.env.TODAY_CARE_PLANNER_KEY ?? process.env.VOLCENGINE_AGENT_PLAN_KEY)?.trim();
  const model = (process.env.TODAY_CARE_NARRATIVE_MODEL ?? process.env.TODAY_CARE_PLANNER_MODEL ?? process.env.VOLCENGINE_AGENT_PLAN_MODEL)?.trim();
  const baseUrl = (process.env.TODAY_CARE_NARRATIVE_BASE_URL ?? process.env.TODAY_CARE_PLANNER_BASE_URL ?? process.env.VOLCENGINE_AGENT_PLAN_BASE_URL)?.trim();
  return apiKey && model && baseUrl ? createVolcengineTodayUserNarrativeProvider({ apiKey, model, baseUrl }) : null;
}
