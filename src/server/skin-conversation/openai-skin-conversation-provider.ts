import "server-only";

import { parseConversationFirstRawOutput, type SkinConversationRequest } from "@/schemas/skin-conversation";
import { SKIN_ASSESSMENT_FRAMEWORK_PROMPT } from "./assessment-framework-prompt";
import type { SkinConversationProvider } from "./provider";
import { deriveConversationPriority } from "./conversation-priority";
import { buildConversationContext } from "./volcengine-skin-conversation-provider";
import { IncrementalReplyJsonExtractor, readStructuredResponseStream } from "./structured-reply-stream";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
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
  readiness: { type: "string", enum: ["continue", "ready"] }, clarification: { type: ["string", "null"] }, confidence: { type: "integer", minimum: 0, maximum: 100 }, suggested_followup: { type: ["string", "null"] }, conversational_intent: { type: "string", enum: ["continue", "complete"] },
} } as const;

export function createOpenAiSkinConversationProvider(options: { apiKey: string; model?: string; fetchImpl?: typeof fetch }): SkinConversationProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? "gpt-4.1-mini";
  return { providerCode: "openai_responses", model, async extract(input, callbacks) {
    const inputForModel = modelInput(input);
    callbacks?.context_assembly?.();
    callbacks?.provider_request_started?.();
    const response = await fetchImpl(OPENAI_RESPONSES_URL, { method: "POST", headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({
      model, store: false, instructions: SKIN_ASSESSMENT_FRAMEWORK_PROMPT,
      input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(inputForModel) }] }],
      text: { format: { type: "json_schema", name: "skin_conversation_assessment", strict: true, schema: responseSchema } }, max_output_tokens: 1800, stream: true,
    }) });
    if (!response.ok || response.body === null) throw new Error(`Skin conversation provider failed (${response.status}).`);
    const replyExtractor = new IncrementalReplyJsonExtractor();
    const outputText = response.headers.get("content-type")?.includes("text/event-stream")
      ? await readStructuredResponseStream(response.body, {
        onFirstEvent: () => callbacks?.provider_first_event?.(),
        onOutputTextDelta: (delta) => {
          for (const replyDelta of replyExtractor.push(delta)) callbacks?.onReplyDelta?.(replyDelta);
        },
      })
      : (await response.json() as { output_text?: unknown }).output_text;
    if (typeof outputText !== "string") throw new Error("Skin conversation provider returned no structured output.");
    const result = parseConversationFirstRawOutput(outputText);
    callbacks?.provider_completed?.();
    return result;
  } };
}

export function createConfiguredOpenAiSkinConversationProvider(): SkinConversationProvider | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  return apiKey ? createOpenAiSkinConversationProvider({ apiKey, model: process.env.OPENAI_SKIN_CONVERSATION_MODEL?.trim() || undefined }) : null;
}

function modelInput(input: SkinConversationRequest) {
  return { conversation_priority: deriveConversationPriority(input), conversation_context: buildConversationContext(input), personalMemoryContext: input.personalMemoryContext, user_message: input.message, today_existing_known_state: input.existing_checkin ? {
    known_fields: input.existing_checkin.known_fields,
    values: Object.fromEntries(input.existing_checkin.known_fields.map((field) => [field, input.existing_checkin![field]])),
  } : null, today_existing_daily_state: input.existing_checkin?.daily_state ?? null, active_turn_context: input.active_turn_context, limited_profile_context: input.profile_context, current_turn_context: "This context is supplied by Beauty OS for the active browser interaction only. Do not use or assume provider conversation memory." };
}
