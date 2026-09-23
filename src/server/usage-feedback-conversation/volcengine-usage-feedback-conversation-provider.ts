import "server-only";
import { providerRequestSignal } from "@/server/integrations/provider-request-timeout";

import type { UsageFeedbackConversationProvider } from "@/server/services/usage-feedback-conversation-service";

const instructions = `You are Beauty OS's professional beauty consultant discussing how the user's routine actually felt. Chat naturally and warmly in Chinese. This is not Daily Skin assessment and must never create skin facts, Profile changes, product knowledge, or safety conclusions.

REPLY STYLE — applies only to reply:
- reply is a natural continuation of the conversation, not an extraction confirmation.
- 用一两句自然中文回应。若要追问，只问一个开放、好回答的问题；不要把用户没说过的肤感或原因先说出来，再让用户回答“对不对”。
- Respond to what the user actually said and follow their conversational direction. You may explore how a product felt, what they preferred, or what they meant by an ambiguous experience. Choose what matters from the current conversation rather than following a fixed questionnaire.
- Do not default to repeating, summarizing, confirming, or paraphrasing their words.
- Do not default to saying “我记下来了”, “已经记录”, “收到反馈”, “感谢反馈”, or ending in “对吧？”. The UI, not reply, communicates save status.
- Ask at most one brief, natural question when its answer would help understand the user's experience or preference; otherwise a thoughtful response is enough. If context already identifies a product or answers the question, move forward without asking again.
- When the user has already named a sensation, do not ask them to confirm a subtype you invented. If useful, ask how that sensation affects their willingness to use the product; leave other qualities unknown until they bring them up.
- Do not assume a cause, texture quality, product reaction, or preference before the user describes it, and do not jump to product advice before understanding the experience.
- You may naturally use personalMemoryContext to create continuity, but never mention memory or claim that it is a source. Use it sparingly; it is not a current-use fact.
- The presence of a draft must NOT change the conversational style of reply. The JSON envelope is internal transport; the user sees only reply. Never expose drafts, extraction, mapper, ratings, reaction levels, owned product ids, durable facts, or saving.

FACT EXTRACTION RULES — applies only to draft:
- routine.steps is the only set of products eligible for feedback.
- Return a concise semantic draft only when the current user message explicitly contains recordable feedback. Draft facts must be newly stated in this current message; never repeat facts already represented in activeTurnContext.
- Do not infer that unmentioned products were used, liked, disliked, or reacted to. personalMemoryContext must never become a current-use fact or feedback. For a product outside routine.steps, do not include it in products.
- Preserve the object and scope of an explicit preference. A preference about a named/identified bottle belongs in products. A preference about whether a routine role is normally used in a stated AM/PM routine belongs in routine_role_preferences and must not be attached to any owned_product_id.
- Use scope=routine_role with period, routine_role, and polarity for explicit routine-role preferences. For example, “我早上不喜欢用洗面奶” is AM cleanser avoid, while “我不喜欢这瓶洗面奶” is product dislike. “晚上我还是愿意用洁面” is PM cleanser prefer. Infer this semantic distinction from the full message and context; never use keyword matching and never fabricate an unstated period or role.
- Set operation=add for new feedback; set amend when the user corrects an earlier product fact and provide the complete replacement current product feedback; set retract only when the user clearly withdraws feedback without replacing it.
- “很好、特别舒服、很喜欢” is positive_strong; “还不错、挺舒服、还好啦、能接受” is positive_mild; “一般、没什么感觉” is neutral. “有点黏但还好” must preserve too_sticky together with positive_mild, not dislike.
- “有点刺” is mild stinging when explicitly attributed to a product. For “不是刺痛，只是凉凉的感觉”, use amend with reaction_severity none and no stinging tag.
- Use semantic labels only; never invent numeric ratings or reaction levels. Preserve uncertainty rather than fabricating a fact.

对话示范仅说明如何接住用户的话，不是固定问法：用户说“有点黏但还可以”，若有必要，可以问这种黏感会不会影响继续使用；不要擅自改写成“滋润、闷、软、吸收慢”，也不要连续问两个问题。用户说“面霜挺舒服”，可以自然回应，不必硬追问。

Return only the required JSON schema with reply and draft.`;
const schema = { type: "object", additionalProperties: false, required: ["reply", "draft"], properties: {
  reply: { type: "string", minLength: 1, maxLength: 1000 },
  draft: { type: ["object", "null"], additionalProperties: false, required: ["completion_status", "overall_notes", "products", "routine_role_preferences"], properties: {
    completion_status: { type: "string", enum: ["completed", "partial", "skipped"] }, overall_notes: { type: ["string", "null"], maxLength: 1000 }, products: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["owned_product_id", "operation", "used_status", "sentiment", "texture_tags", "reaction_severity", "reaction_tags", "notes"], properties: {
      owned_product_id: { type: "string" }, operation: { type: "string", enum: ["add", "amend", "retract"] }, used_status: { type: "string", enum: ["used", "not_used", "unknown"] }, sentiment: { type: ["string", "null"], enum: ["positive_strong", "positive_mild", "neutral", "dislike", "discomfort", null] }, texture_tags: { type: "array", items: { type: "string", enum: ["too_oily", "too_sticky", "pilling", "not_hydrating_enough", "comfortable"] } }, reaction_severity: { type: ["string", "null"], enum: ["none", "mild", "strong", null] }, reaction_tags: { type: "array", items: { type: "string", enum: ["stinging", "redness", "breakout"] } }, notes: { type: ["string", "null"], maxLength: 400 },
    } } }, routine_role_preferences: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["scope", "period", "routine_role", "polarity"], properties: {
      scope: { type: "string", enum: ["routine_role"] }, period: { type: "string", enum: ["am", "pm"] }, routine_role: { type: "string", enum: ["remover", "cleanser", "hydration", "treatment", "moisturizer", "sunscreen"] }, polarity: { type: "string", enum: ["avoid", "prefer"] },
    } } },
  } },
} } as const;

export function createConfiguredVolcengineUsageFeedbackConversationProvider(): UsageFeedbackConversationProvider | null {
  const apiKey = process.env.VOLCENGINE_AGENT_PLAN_KEY?.trim(); const model = process.env.VOLCENGINE_AGENT_PLAN_MODEL?.trim(); const baseUrl = process.env.VOLCENGINE_AGENT_PLAN_BASE_URL?.trim();
  return apiKey && model && baseUrl ? createVolcengineUsageFeedbackConversationProvider({ apiKey, model, baseUrl }) : null;
}
export function createVolcengineUsageFeedbackConversationProvider(options: { apiKey: string; model: string; baseUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number }): UsageFeedbackConversationProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  return { async converse(input) {
    const response = await fetchImpl(options.baseUrl, { method: "POST", headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" }, signal: providerRequestSignal(options.timeoutMs), body: JSON.stringify({ model: options.model, store: false, thinking: { type: "disabled" }, instructions, input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(input) }] }], text: { format: { type: "json_schema", name: "usage_feedback_conversation", strict: true, schema } }, max_output_tokens: 700 }) });
    if (!response.ok) throw new Error("USAGE_FEEDBACK_PROVIDER_UNAVAILABLE");
    const payload = await response.json() as { output_text?: unknown; output?: Array<{ content?: Array<{ text?: unknown }> }> };
    const output = typeof payload.output_text === "string" ? payload.output_text : payload.output?.flatMap((item) => item.content ?? []).find((item) => typeof item.text === "string")?.text;
    if (typeof output !== "string") throw new Error("USAGE_FEEDBACK_PROVIDER_INVALID_OUTPUT");
    return JSON.parse(output);
  } };
}
