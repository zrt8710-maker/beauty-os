import { describe, expect, it, vi } from "vitest";

import { createOpenAiSkinConversationProvider } from "@/server/skin-conversation/openai-skin-conversation-provider";

const output = { reply: "已整理，请确认。", assessments: ["dryness_level", "oiliness_level", "redness_level", "sensitivity_level", "acne_level"].map((field) => ({ field, status: "unknown", level: null, evidence: "未提及" })), observations: { locations: [], tightness: null, flaking: null, roughness: null, visible_shine: null, blemish_count: null, blemish_distribution: null, pain_tenderness: null, small_bumps: null, blackheads: null, itching: null, burning: null, triggers: [], duration: null, baseline_comparison: null }, daily_state: null, readiness: "continue", clarification: "今天主要是干紧、油、红、刺痒，还是长痘？", confidence: 60 };

describe("OpenAI Skin Conversation provider", () => {
  it("uses a stateless strict structured-output Responses request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: JSON.stringify(output) }), { status: 200 }));
    const provider = createOpenAiSkinConversationProvider({ apiKey: "test-key", model: "test-model", fetchImpl });
    await provider.extract({ message: "脸不舒服", active_turn_context: [], recorded_date: "2026-08-29", existing_checkin: null, profile_context: null });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "test-model", store: false, text: { format: { type: "json_schema", strict: true, schema: { properties: { normal_day_evidence: expect.any(Object) } } } } });
    expect(body).not.toHaveProperty("conversation");
    expect(body).not.toHaveProperty("previous_response_id");
    expect(body).not.toHaveProperty("tools");
  });

  it("receives the same compact history, baseline, and completion context as the default provider", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: JSON.stringify(output) }), { status: 200 }));
    const provider = createOpenAiSkinConversationProvider({ apiKey: "test-key", model: "test-model", fetchImpl });
    await provider.extract({ message: "差不多", active_turn_context: ["用户：T区有点油", "Beauty OS：T区出油和平时比呢？"], recorded_date: "2026-09-01", existing_checkin: null, profile_context: { skin_type: "oily", sensitivity_level: 1, skin_goals: ["oil_control"], long_term_skin_baseline: { usual_oily_areas: ["t_zone"], usual_dry_areas: [], recurring_tendencies: [{ kind: "blackheads", usual_areas: ["nose"], tendency: "recurring", frequency: "recurring", usual_intensity: "noticeable", source: "user_declared" }] } } });
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body));
    const modelInput = JSON.parse(body.input[0].content[0].text);
    expect(modelInput).toMatchObject({ active_turn_context: ["用户：T区有点油", "Beauty OS：T区出油和平时比呢？"], limited_profile_context: { long_term_skin_baseline: { usual_oily_areas: ["t_zone"] } }, conversation_priority: { today_concerns: ["oiliness"], eligible_profile_topic: { concern: "blackheads" } }, conversation_context: { recent_conversation: ["用户：T区有点油", "Beauty OS：T区出油和平时比呢？"] } });
  });

  it("accepts a reply-only provider response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: "{\"reply\":\"x\"}" }), { status: 200 }));
    const provider = createOpenAiSkinConversationProvider({ apiKey: "test-key", fetchImpl });
    await expect(provider.extract({ message: "脸不舒服", active_turn_context: [], recorded_date: "2026-08-29", existing_checkin: null, profile_context: null })).resolves.toMatchObject({ reply: "x", assessments: [] });
  });

  it("preserves a valid reply when optional structured JSON is truncated", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: "{\"reply\":\"好，我按这些整理。\",\"assessments\":[" }), { status: 200 }));
    const provider = createOpenAiSkinConversationProvider({ apiKey: "test-key", fetchImpl });
    await expect(provider.extract({ message: "没有了", active_turn_context: [], recorded_date: "2026-09-01", existing_checkin: null, profile_context: null })).resolves.toMatchObject({ reply: "好，我按这些整理。", assessments: [] });
  });
});
