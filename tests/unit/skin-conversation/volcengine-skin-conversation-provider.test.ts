import { describe, expect, it, vi } from "vitest";

import { buildConversationContext, createVolcengineSkinConversationProvider } from "@/server/skin-conversation/volcengine-skin-conversation-provider";
import { sanitizeProviderOutput } from "@/server/skin-conversation/volcengine-skin-conversation-provider";

const output = { reply: "我需要确认一下痘痘的数量和部位。", assessments: ["dryness_level", "oiliness_level", "redness_level", "sensitivity_level", "acne_level"].map((field) => ({ field, status: "unknown", level: null, evidence: "未提及或无法安全分级" })), observations: { locations: [], tightness: null, flaking: null, roughness: null, visible_shine: null, blemish_count: null, blemish_distribution: null, pain_tenderness: null, small_bumps: null, blackheads: null, itching: null, burning: null, triggers: [], duration: null, baseline_comparison: null }, daily_state: null, readiness: "continue", clarification: "大概有几颗，主要在哪个部位？", confidence: 70 };

describe("Volcengine Skin Conversation provider", () => {
  it("streams natural dialogue without an assessment schema or questionnaire context", async () => {
    const encoder = new TextEncoder();
    const reply = "整张脸都有点油啊，那今天先按这个感受聊。";
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const delta of [reply.slice(0, 9), reply.slice(9)]) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "response.output_text.delta", delta })}\n\n`));
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "response.completed" })}\n\n`));
        controller.close();
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    const provider = createVolcengineSkinConversationProvider({ apiKey: "test-key", model: "test", baseUrl: "https://example.test/responses", fetchImpl });
    const deltas: string[] = [];
    const result = await provider.extract({ message: "是整张脸都有点油", active_turn_context: ["用户：今天有点油", "Beauty OS：是 T 区还是整张脸？"], recorded_date: "2026-09-23", existing_checkin: null, profile_context: null }, { onReplyDelta: (delta) => deltas.push(delta) });
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body));
    const context = JSON.parse(body.input[0].content[0].text);
    expect(body).not.toHaveProperty("text");
    expect(body.instructions).toContain("只输出要对用户说的话");
    expect(context.active_turn_context).toHaveLength(2);
    expect(context).not.toHaveProperty("conversation_priority");
    expect(deltas.join("")).toBe(reply);
    expect(result).toMatchObject({ reply, assessments: [] });
  });

  it("keeps T-zone oiliness usable when the model includes unsupported optional attributes", () => {
    const value = sanitizeProviderOutput({ ...output, readiness: "ready", clarification: null, daily_state: { version: 2, summary: "今天 T 区中度出油，脸颊一点点。", concerns: [{ kind: "oiliness", status: "present", areas: ["t_zone", "cheeks"], attributes: { severity: "moderate", amount: "some", distribution: "localized" }, user_wording: ["T区中度出油，脸颊一点点"], source: ["conversation"] }] } }) as typeof output;
    expect((value.daily_state as unknown as { concerns: Array<{ attributes: Record<string, unknown> }> }).concerns[0].attributes).toEqual({ severity: "moderate" });
  });
  it("sends a fresh no-tools stateless structured-output request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: JSON.stringify(output) }), { status: 200 }));
    const provider = createVolcengineSkinConversationProvider({ apiKey: "test-key", model: "doubao-seed-2.1-turbo", baseUrl: "https://example.test/api/plan/v3/responses", fetchImpl });
    await provider.extract({ finalize_requested: true, message: "今天长痘了。", active_turn_context: [], recorded_date: "2026-08-29", existing_checkin: null, profile_context: null });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(url).toBe("https://example.test/api/plan/v3/responses");
    expect(body).toMatchObject({ model: "doubao-seed-2.1-turbo", store: false, thinking: { type: "disabled" }, text: { format: { type: "json_schema", strict: true, schema: { properties: { normal_day_evidence: expect.any(Object) } } } } });
    expect(body.instructions).toContain("Only reply is mandatory");
    expect(body.instructions).toContain("at most one useful question");
    expect(body.instructions).toContain("不知道是不是闭口");
    expect(body.instructions).toContain("不知道怎么判断程度");
    expect(body.instructions).toContain("one sentence at most");
    expect(body.instructions).toContain("never a complete routine or plan");
    expect(body.instructions).toContain("today_concerns");
    expect(body.instructions).toContain("unresolved_user_concerns");
    expect(body.instructions).toContain("not a script");
    expect(body.instructions).toContain("The user controls completion");
    expect(body.instructions).toContain("do not impose a fixed area");
    expect(body.instructions).toContain("optional background, not a conversation obligation");
    expect(body.text.format.schema.required).toEqual(["reply"]);
    expect(body.text.format.schema.properties).toHaveProperty("suggested_followup");
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("web_search");
    expect(body).not.toHaveProperty("conversation");
    expect(body).not.toHaveProperty("previous_response_id");
    expect(body).not.toHaveProperty("memory");
    expect(body.input[0].content[0].text).toContain("limited_profile_context");
  });

  it("passes only the approved long-term profile background to Doubao", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: JSON.stringify(output) }), { status: 200 }));
    const provider = createVolcengineSkinConversationProvider({ apiKey: "test-key", model: "doubao-seed-2.1-turbo", baseUrl: "https://example.test/responses", fetchImpl });
    await provider.extract({ finalize_requested: true, message: "鼻子下午比平时油很多", active_turn_context: [], recorded_date: "2026-08-29", existing_checkin: null, profile_context: { skin_type: "oily", sensitivity_level: 2, skin_goals: ["oil_control"] } });
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body));
    const modelInput = JSON.parse(body.input[0].content[0].text);
    expect(modelInput.limited_profile_context).toEqual({ skin_type: "oily", sensitivity_level: 2, skin_goals: ["oil_control"] });
    expect(modelInput.conversation_priority).toMatchObject({ today_concerns: ["oiliness"], baseline_eligibility: [expect.objectContaining({ concern: "oiliness", has_profile_baseline: false, baseline_unknown: true })] });
    expect(JSON.stringify(modelInput)).not.toContain("texture_preferences");
    expect(JSON.stringify(modelInput)).not.toContain("avoid_ingredients");
    expect(JSON.stringify(modelInput)).not.toContain("location");
  });

  it("passes complete v0.3.1 baseline data into the active provider turn", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: JSON.stringify(output) }), { status: 200 }));
    const provider = createVolcengineSkinConversationProvider({ apiKey: "test-key", model: "test", baseUrl: "https://example.test/responses", fetchImpl });
    await provider.extract({ finalize_requested: true, message: "今天有点油", active_turn_context: [], recorded_date: "2026-08-31", existing_checkin: null, profile_context: { skin_type: "oily", sensitivity_level: 2, skin_goals: ["oil_control", "blemish_care"], long_term_skin_baseline: { usual_oily_areas: ["t_zone"], usual_dry_areas: [], recurring_tendencies: [{ kind: "blackheads", usual_areas: ["nose"], tendency: "recurring", frequency: "recurring", usual_intensity: "noticeable", source: "user_declared" }, { kind: "small_bumps", usual_areas: ["forehead"], tendency: "frequent", frequency: "frequent", usual_intensity: "unknown", source: "user_declared" }] } } });
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body));
    const modelInput = JSON.parse(body.input[0].content[0].text);
    expect(modelInput.limited_profile_context).toMatchObject({ skin_type: "oily", sensitivity_level: 2, skin_goals: ["oil_control", "blemish_care"], long_term_skin_baseline: { usual_oily_areas: ["t_zone"] } });
    expect(modelInput.limited_profile_context.long_term_skin_baseline.recurring_tendencies).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "blackheads", usual_areas: ["nose"], frequency: "recurring", usual_intensity: "noticeable" })]));
    expect(modelInput.conversation_priority.baseline_eligibility).toEqual(expect.arrayContaining([expect.objectContaining({ concern: "oiliness", has_profile_baseline: true, profile_baseline_areas: ["t_zone"] })]));
  });

  it("passes all same-turn concerns without forcing a next concern", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: JSON.stringify(output) }), { status: 200 }));
    const provider = createVolcengineSkinConversationProvider({ apiKey: "test-key", model: "test", baseUrl: "https://example.test/responses", fetchImpl });
    await provider.extract({ finalize_requested: true, message: "T区有点油，脸颊有点干，鼻子还有黑头", active_turn_context: [], recorded_date: "2026-09-01", existing_checkin: null, profile_context: { skin_type: "combination", sensitivity_level: 1, skin_goals: [], long_term_skin_baseline: { usual_oily_areas: ["t_zone"], usual_dry_areas: [], recurring_tendencies: [] } } });
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body));
    const modelInput = JSON.parse(body.input[0].content[0].text);
    expect(modelInput.conversation_priority).toMatchObject({ today_concerns: ["oiliness", "dryness", "blackheads"], unresolved_user_concerns: ["oiliness", "dryness", "blackheads"] });
    expect(modelInput.conversation_priority).not.toHaveProperty("active_concern");
    expect(modelInput.conversation_priority.baseline_eligibility).toEqual(expect.arrayContaining([expect.objectContaining({ concern: "oiliness", has_profile_baseline: true, baseline_unknown: false }), expect.objectContaining({ concern: "dryness", has_profile_baseline: false, has_conversation_baseline: false, baseline_unknown: true })]));
  });

  it("sends one Profile topic rather than a forced candidate question after user concerns are resolved", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: JSON.stringify(output) }), { status: 200 }));
    const provider = createVolcengineSkinConversationProvider({ apiKey: "test-key", model: "test", baseUrl: "https://example.test/responses", fetchImpl });
    await provider.extract({ finalize_requested: true, message: "差不多", active_turn_context: ["用户：T区有点油", "Beauty OS：T区出油和平时比，今天差不多还是更明显？"], recorded_date: "2026-09-01", existing_checkin: null, profile_context: { skin_type: "oily", sensitivity_level: 1, skin_goals: [], long_term_skin_baseline: { usual_oily_areas: ["t_zone"], usual_dry_areas: [], recurring_tendencies: [{ kind: "blackheads", usual_areas: ["nose"], tendency: "recurring", source: "user_declared" }] } } });
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body));
    const modelInput = JSON.parse(body.input[0].content[0].text);
    expect(modelInput.conversation_priority.eligible_profile_topic).toEqual({ concern: "blackheads", areas: ["nose"], reason: "relevant_recurring_tendency" });
  });

  it("rejects provider errors but accepts a reply-only conversational response", async () => {
    const unavailable = createVolcengineSkinConversationProvider({ apiKey: "test-key", model: "doubao-seed-2.1-turbo", baseUrl: "https://example.test/responses", fetchImpl: vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })) });
    await expect(unavailable.extract({ finalize_requested: true, message: "今天长痘了。", active_turn_context: [], recorded_date: "2026-08-29", existing_checkin: null, profile_context: null })).rejects.toThrow("503");
    const malformed = createVolcengineSkinConversationProvider({ apiKey: "test-key", model: "doubao-seed-2.1-turbo", baseUrl: "https://example.test/responses", fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: "{\"reply\":\"x\"}" }), { status: 200 })) });
    await expect(malformed.extract({ finalize_requested: true, message: "今天长痘了。", active_turn_context: [], recorded_date: "2026-08-29", existing_checkin: null, profile_context: null })).resolves.toMatchObject({ reply: "x", assessments: [] });
  });

  it("keeps a completed turn usable when optional structured JSON is truncated after a valid reply", async () => {
    const provider = createVolcengineSkinConversationProvider({ apiKey: "test-key", model: "test", baseUrl: "https://example.test/responses", fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: "{\"reply\":\"好，我按这些整理。\",\"daily_state\":[" }), { status: 200 })) });
    await expect(provider.extract({ finalize_requested: true, message: "没有了", active_turn_context: ["Beauty OS：还有其他今天想记下的吗？没有的话我就按这些整理。"], recorded_date: "2026-09-01", existing_checkin: null, profile_context: null })).resolves.toMatchObject({ reply: "好，我按这些整理。", assessments: [] });
  });

  it("preserves a valid reply when raw optional structured fields are incompatible", async () => {
    const raw = { reply: "脸颊这边先看看是粗糙还是紧绷。", daily_state: { version: 2, summary: null, concerns: [] }, assessments: [{ field: "oiliness_level", status: "known", level: null, evidence: "bad enum combination" }], debug: "ignore" };
    const provider = createVolcengineSkinConversationProvider({ apiKey: "test-key", model: "test", baseUrl: "https://example.test/responses", fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: JSON.stringify(raw) }), { status: 200 })) });
    const result = await provider.extract({ finalize_requested: true, message: "脸颊有点干", active_turn_context: [], recorded_date: "2026-08-30", existing_checkin: null, profile_context: null });
    expect(result).toMatchObject({ reply: raw.reply, assessments: [] });
    expect(result.daily_state).toBeUndefined();
  });

  it("accepts the Volcengine Responses output content shape", async () => {
    const provider = createVolcengineSkinConversationProvider({ apiKey: "test-key", model: "doubao-seed-2.1-turbo", baseUrl: "https://example.test/responses", fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] }), { status: 200 })) });
    await expect(provider.extract({ finalize_requested: true, message: "今天长痘了。", active_turn_context: [], recorded_date: "2026-08-29", existing_checkin: null, profile_context: null })).resolves.toMatchObject({ readiness: "continue" });
  });

  it("normalizes any provisional daily state from a continuing response", async () => {
    const provisional = { ...output, daily_state: { version: 2, summary: "", concerns: [] } };
    const provider = createVolcengineSkinConversationProvider({ apiKey: "test-key", model: "doubao-seed-2.1-turbo", baseUrl: "https://example.test/responses", fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: JSON.stringify(provisional) }), { status: 200 })) });
    await expect(provider.extract({ finalize_requested: true, message: "额头有很多闭口", active_turn_context: [], recorded_date: "2026-08-30", existing_checkin: null, profile_context: null })).resolves.toMatchObject({ readiness: "continue", daily_state: null });
  });

  it("supplies compact conversational context without treating history as durable facts", () => {
    const context = buildConversationContext({ message: "鼻翼有点起皮", active_turn_context: ["用户：今天有点油", "Beauty OS：T区还是全脸？", "用户：T区"], recorded_date: "2026-08-30", existing_checkin: null, profile_context: { skin_type: "oily", sensitivity_level: 1, skin_goals: ["oil_control"] }, completion_confirmation_pending: true });
    expect(context).toMatchObject({ profile_background: { skin_type: "oily" }, concerns_already_discussed: ["油"], final_supplementation_already_offered: true, user_explicitly_confirmed_completion: false });
    expect(context.confirmed_facts_so_far).toBeNull();
  });
});
