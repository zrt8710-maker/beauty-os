import "server-only";

import { parseConversationFirstRawOutput, type SkinConversationRequest } from "@/schemas/skin-conversation";
import { SKIN_ASSESSMENT_FRAMEWORK_PROMPT } from "./assessment-framework-prompt";
import { SkinConversationProviderError, type SkinConversationProvider } from "./provider";
import { deriveActiveQuestionContext, parseDeterministicShortAnswer } from "./contextual-turn-interpretation";
import { deriveConversationPriority } from "./conversation-priority";
import { IncrementalReplyJsonExtractor, readStructuredResponseStream } from "./structured-reply-stream";

const observationSchema = { type: "object", additionalProperties: false, required: ["locations", "tightness", "flaking", "roughness", "visible_shine", "blemish_count", "blemish_distribution", "pain_tenderness", "small_bumps", "blackheads", "itching", "burning", "triggers", "duration", "baseline_comparison"], properties: {
  locations: { type: "array", items: { type: "string" }, maxItems: 8 }, tightness: { type: ["string", "null"] }, flaking: { type: ["string", "null"] }, roughness: { type: ["string", "null"] }, visible_shine: { type: ["string", "null"] }, blemish_count: { type: ["string", "null"] }, blemish_distribution: { type: ["string", "null"] }, pain_tenderness: { type: ["string", "null"] }, small_bumps: { type: ["string", "null"] }, blackheads: { type: ["string", "null"] }, itching: { type: ["string", "null"] }, burning: { type: ["string", "null"] }, triggers: { type: "array", items: { type: "string" }, maxItems: 6 }, duration: { type: ["string", "null"] }, baseline_comparison: { type: ["string", "null"] },
} } as const;
const dailyStateSchema = { type: ["object", "null"], additionalProperties: false, required: ["version", "summary", "concerns"], properties: {
  version: { type: "integer", enum: [2] }, summary: { type: ["string", "null"], maxLength: 2000 }, concerns: { type: "array", maxItems: 24, items: { type: "object", additionalProperties: false, required: ["kind", "status", "areas", "attributes", "user_wording", "source"], properties: {
    kind: { type: "string", enum: ["oiliness", "dryness", "flaking", "roughness", "redness", "stinging", "itching", "burning", "blemishes", "small_bumps", "blackheads", "visible_pores", "uneven_tone", "dullness", "post_blemish_marks"] }, status: { type: "string", enum: ["present", "absent"] }, areas: { type: "array", minItems: 1, maxItems: 4, items: { type: "string", enum: ["t_zone", "forehead", "hairline", "nose", "nose_wings", "cheeks", "chin", "eye_area", "full_face", "other"] } }, attributes: { type: "object", additionalProperties: false, properties: { severity: { type: "string", enum: ["slight", "mild", "moderate", "marked"] }, amount: { type: "string", enum: ["isolated", "few", "several", "many", "widespread"] }, distribution: { type: "string", enum: ["localized", "scattered", "clustered", "widespread"] }, onset: { type: "string", enum: ["today", "recent", "ongoing", "unknown"] }, duration: { type: "string", enum: ["transient", "part_day", "all_day", "several_days", "unknown"] }, persistence: { type: "string", enum: ["transient", "recurrent", "persistent", "unknown"] }, trigger: { type: "string", maxLength: 120 }, tenderness: { type: "string", enum: ["absent", "present", "unknown"] }, baseline_comparison: { type: "string", enum: ["less_than_usual", "usual", "more_than_usual", "new", "unknown"] } } }, user_wording: { type: "array", maxItems: 6, items: { type: "string", maxLength: 120 } }, source: { type: "array", minItems: 1, maxItems: 4, items: { type: "string", enum: ["conversation"] } },
  } } } },
} as const;
const responseSchema = { type: "object", additionalProperties: false, required: ["reply"], properties: {
  reply: { type: "string", minLength: 1 },
  assessments: { type: "array", maxItems: 5, items: { type: "object", additionalProperties: false, required: ["field", "status", "level", "evidence"], properties: {
    field: { type: "string", enum: ["dryness_level", "oiliness_level", "redness_level", "sensitivity_level", "acne_level"] },
    status: { type: "string", enum: ["known", "unknown"] }, level: { type: ["integer", "null"], minimum: 0, maximum: 4 }, evidence: { type: "string", minLength: 1 },
  } } },
  observations: observationSchema,
  daily_state: dailyStateSchema,
  normal_day_evidence: { type: ["object", "null"], additionalProperties: false, required: ["user_statements"], properties: { user_statements: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", minLength: 1, maxLength: 500 } } } },
  readiness: { type: "string", enum: ["continue", "confirm", "ready"] }, clarification: { type: ["string", "null"] }, confidence: { type: "integer", minimum: 0, maximum: 100 }, suggested_followup: { type: ["string", "null"] }, conversational_intent: { type: "string", enum: ["continue", "complete"] },
} } as const;

export function createVolcengineSkinConversationProvider(options: { apiKey: string; model: string; baseUrl: string; fetchImpl?: typeof fetch }): SkinConversationProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  return { providerCode: "volcengine_responses", model: options.model, async extract(input, callbacks) {
    const inputForModel = modelInput(input);
    callbacks?.context_assembly?.();
    let response: Response;
    try {
      callbacks?.provider_request_started?.();
      response = await fetchImpl(options.baseUrl, { method: "POST", headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({
        model: options.model,
        store: false,
        stream: true,
        thinking: { type: "disabled" },
        instructions: SKIN_ASSESSMENT_FRAMEWORK_PROMPT,
        input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(inputForModel) }] }],
        text: { format: { type: "json_schema", name: "skin_conversation_assessment", strict: true, schema: responseSchema } },
        max_output_tokens: 1800,
      }) });
    } catch (error) { throw new SkinConversationProviderError("Skin conversation provider network request failed.", "network"); }
    if (!response.ok || response.body === null) throw new SkinConversationProviderError(`Skin conversation provider failed (${response.status}).`, "http");
    try {
      const replyExtractor = new IncrementalReplyJsonExtractor();
      const outputText = response.headers.get("content-type")?.includes("text/event-stream")
        ? await readStructuredResponseStream(response.body, {
          onFirstEvent: () => callbacks?.provider_first_event?.(),
          onOutputTextDelta: (delta) => {
            for (const replyDelta of replyExtractor.push(delta)) callbacks?.onReplyDelta?.(replyDelta);
          },
        })
        : outputTextFromResponse(await response.json() as { output_text?: unknown; output?: unknown });
      if (!outputText) throw new Error("Skin conversation provider returned no structured output.");
      let candidateText = outputText;
      try { candidateText = JSON.stringify(sanitizeProviderOutput(normalizeContinuingDailyState(JSON.parse(outputText)))); } catch { /* recover the reply from partial JSON below */ }
      const result = parseConversationFirstRawOutput(candidateText);
      callbacks?.provider_completed?.();
      return result;
    } catch (error) {
      throw new SkinConversationProviderError("Skin conversation provider returned an invalid structured response.", "response");
    }
  } };
}

export function createConfiguredVolcengineSkinConversationProvider(): SkinConversationProvider | null {
  const apiKey = process.env.VOLCENGINE_AGENT_PLAN_KEY?.trim();
  const model = process.env.VOLCENGINE_AGENT_PLAN_MODEL?.trim();
  const baseUrl = process.env.VOLCENGINE_AGENT_PLAN_BASE_URL?.trim();
  return apiKey && model && baseUrl ? createVolcengineSkinConversationProvider({ apiKey, model, baseUrl }) : null;
}

function modelInput(input: SkinConversationRequest) {
  const activeQuestion = deriveActiveQuestionContext(input); const deterministicAnswer = parseDeterministicShortAnswer(input.message, activeQuestion); const conversationPriority = deriveConversationPriority(input);
  return { conversation_priority: conversationPriority, user_message: input.message, active_question_context: activeQuestion, deterministic_short_answer: deterministicAnswer, conversation_context: buildConversationContext(input), personalMemoryContext: input.personalMemoryContext, today_existing_known_state: input.existing_checkin ? {
    known_fields: input.existing_checkin.known_fields,
    values: Object.fromEntries(input.existing_checkin.known_fields.map((field) => [field, input.existing_checkin![field]])),
  } : null, today_existing_daily_state: input.existing_checkin?.daily_state ?? null, limited_profile_context: input.profile_context, active_turn_context: input.active_turn_context, current_turn_context: "This context is supplied by Beauty OS for the active browser interaction only. Do not use or assume provider conversation memory." };
}

/** Compact, non-durable context that helps the model talk naturally; only validated output may become facts. */
export function buildConversationContext(input: SkinConversationRequest) {
  const history = input.active_turn_context ?? [];
  const allText = history.join(" ");
  const concernFamilies = ["油", "干", "起皮", "泛红", "刺痛", "发痒", "灼热", "痘", "闭口", "黑头"].filter((word) => allText.includes(word));
  const explicitAbsences = ["没有", "不痒", "不刺痛", "不红"].filter((word) => allText.includes(word));
  const lastAssistant = [...history].reverse().find((entry) => entry.startsWith("Beauty OS：")) ?? null;
  return {
    profile_background: input.profile_context,
    confirmed_facts_so_far: input.existing_checkin?.daily_state ?? null,
    concerns_already_discussed: concernFamilies,
    explicit_absence_language_seen: explicitAbsences,
    current_unresolved_topic: lastAssistant,
    final_supplementation_already_offered: input.completion_confirmation_pending ?? false,
    user_explicitly_confirmed_completion: /^(没有了|没了|没别的|没有别的|差不多(?:就这些)?|就这些|先这样|可以了)[。！!，,\s]*$/u.test(input.message.trim()),
    recent_conversation: history,
  };
}

function normalizeContinuingDailyState(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  return ["continue", "confirm"].includes(String((value as { readiness?: unknown }).readiness)) ? { ...value, daily_state: null } : value;
}

function outputTextFromResponse(payload: { output_text?: unknown; output?: unknown }) {
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return null;
  for (const item of payload.output) {
    if (typeof item !== "object" || item === null || !("content" in item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (typeof content === "object" && content !== null && "text" in content && typeof content.text === "string") return content.text;
    }
  }
  return null;
}

/** Removes recoverable, concern-inapplicable optional attributes before the durable schema validates. */
export function sanitizeProviderOutput(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const output = value as Record<string, unknown>;
  const state = output.daily_state;
  if (typeof state !== "object" || state === null || Array.isArray(state)) return output;
  const candidate = state as Record<string, unknown>;
  if (candidate.version !== 2 || !Array.isArray(candidate.concerns)) return output;
  const amountKinds = new Set(["flaking", "blemishes", "small_bumps", "blackheads", "visible_pores"]);
  const tendernessKinds = new Set(["blemishes", "small_bumps"]);
  const triggerKinds = new Set(["oiliness", "dryness", "flaking", "redness", "stinging", "itching", "burning"]);
  const concerns = candidate.concerns.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return item;
    const concern = item as Record<string, unknown>;
    if (typeof concern.attributes !== "object" || concern.attributes === null || Array.isArray(concern.attributes) || typeof concern.kind !== "string") return concern;
    const attributes = { ...(concern.attributes as Record<string, unknown>) };
    if (!amountKinds.has(concern.kind)) { delete attributes.amount; delete attributes.distribution; }
    if (!tendernessKinds.has(concern.kind)) delete attributes.tenderness;
    if (!triggerKinds.has(concern.kind)) delete attributes.trigger;
    return { ...concern, attributes };
  });
  return { ...output, daily_state: { ...candidate, concerns } };
}
