import { describe, expect, it } from "vitest";

import type { SkinConversationProvider } from "@/server/skin-conversation/provider";
import { createSkinConversationService } from "@/server/services/skin-conversation-service";

const date = "2026-08-29";
const observations = { locations: [], tightness: null, flaking: null, roughness: null, visible_shine: null, blemish_count: null, blemish_distribution: null, pain_tenderness: null, small_bumps: null, blackheads: null, itching: null, burning: null, triggers: [], duration: null, baseline_comparison: null };
const request = (message: string, history: string[] = [], extra: Record<string, unknown> = {}) => ({ message, active_turn_context: history, recorded_date: date, existing_checkin: null, profile_context: null, completion_confirmation_pending: false, ...extra });
const v2State = (concerns: object[], summary = "今天已确认的皮肤状态。") => ({ version: 2 as const, summary, concerns });
const concern = (patch: object = {}) => ({ kind: "oiliness", status: "present", areas: ["t_zone"], attributes: { severity: "slight" }, user_wording: [], source: ["conversation"], ...patch });

describe("SkinConversationService current contract", () => {
  it("honors the provider's natural completion signal while keeping structured hints non-durable", async () => {
    const result = await extract({ reply: "你说的鼻子下午出油，我想先确认一下有没有其他地方也这样。", assessments: [{ field: "oiliness_level", status: "known", level: 2, evidence: "用户提到下午鼻子出油" }], daily_state: v2State([concern()]), readiness: "ready", observations }, request("鼻子下午明显出油"));
    expect(result).toMatchObject({ readiness: "confirm", completion_available: true, daily_state: null, changed_fields: ["oiliness_level"] });
    expect(result.proposed_checkin.known_fields).toEqual(["oiliness_level"]);
  });

  it("turns a provider completion hint into confirm, not ready or a saved daily state", async () => {
    const result = await extract({ reply: "今天出油和平时差不多。", readiness: "ready", assessments: [{ field: "oiliness_level", status: "known", level: 1, evidence: "用户确认" }] }, request("差不多", ["用户：今天有点油", "Beauty OS：今天出油和平时比，差不多还是更明显？"]));
    expect(result).toMatchObject({ readiness: "confirm", completion_available: true, daily_state: null });
    expect(result.changed_fields).toEqual(["oiliness_level"]);
  });

  it("turns a natural finish such as 没有了 into confirm, not ready", async () => {
    const result = await extract({ reply: "好，我按这些整理。" }, request("没有了", ["用户：今天有点油", "Beauty OS：还有其他今天想记下的吗？没有的话我就按这些整理。"]));
    expect(result).toMatchObject({ readiness: "confirm", completion_available: true, daily_state: null });
  });

  it("keeps a no-special-changes day as confirm until the user triggers finalize", async () => {
    const result = await extract({ reply: "好，我按这些整理。", readiness: "ready", daily_state: v2State([], "今天没有补充特别的皮肤变化。"), normal_day_evidence: { user_statements: ["今天没什么特别的"] } }, request("今天没什么特别的"));
    expect(result).toMatchObject({ readiness: "confirm", completion_available: true, daily_state: null });
    expect(result.proposed_checkin.known_fields).toEqual([]);
  });

  it.each(["今天没什么变化", "和平常差不多，没哪里不舒服", "今天状态挺稳定的", "没发现什么新的问题"])
  ("finalizes a semantically identified normal day without phrase rules: %s", async (normalDay) => {
    const result = await extract(
      { reply: "好，我按今天的情况整理。", daily_state: v2State([], "今天没有补充特别的皮肤变化。"), normal_day_evidence: { user_statements: [normalDay] } },
      request("请根据完整对话整理今天的皮肤状态。", ["用户：" + normalDay], {
        finalize_requested: true,
        completion_confirmation_pending: true,
        personalMemoryContext: ["用户长期容易长痘。"],
      }),
    );

    expect(result).toMatchObject({ readiness: "ready", daily_state: { version: 2, summary: "今天没有补充特别的皮肤变化。", concerns: [] } });
    expect(result.daily_state?.version === 2 && result.daily_state.concerns.some((concern) => concern.status === "absent")).toBe(false);
    expect(result.proposed_checkin.known_fields).toEqual([]);
    expect(result.changed_fields).toEqual([]);
  });

  it("strictly accepts a V2 daily state only when finalize_requested is true", async () => {
    const output = { reply: "好，我按这些整理。", assessments: [{ field: "oiliness_level", status: "known", level: 1, evidence: "用户确认 T 区轻微出油" }], daily_state: v2State([concern()]) };
    const result = await extract(output, request("请根据完整对话整理今天的皮肤状态。", ["用户：T区有点油"], { finalize_requested: true, completion_confirmation_pending: true }));
    expect(result).toMatchObject({ readiness: "ready", daily_state: v2State([expect.objectContaining({ kind: "oiliness" })]) });
    expect(result.proposed_checkin.daily_state).toEqual(result.daily_state);
    expect(result.proposed_checkin.known_fields).toEqual(["oiliness_level"]);
  });

  it("rejects an empty conversation instead of manufacturing a normal day", async () => {
    await expect(extract({ reply: "好，我按这些整理。", daily_state: { version: 2, summary: null, concerns: [] } }, request("请根据完整对话整理今天的皮肤状态。", [], { finalize_requested: true, completion_confirmation_pending: true }))).rejects.toMatchObject({ stage: "durable_fact_validation" });
  });

  it("rejects provider-declared normal-day evidence that is not grounded in a user turn", async () => {
    await expect(extract(
      { reply: "好，我按这些整理。", daily_state: v2State([], "今天没有特别变化。"), normal_day_evidence: { user_statements: ["今天没有特别变化。"] } },
      request("请根据完整对话整理今天的皮肤状态。", ["用户：鼻翼摸起来不太对"], { finalize_requested: true, completion_confirmation_pending: true }),
    )).rejects.toMatchObject({ stage: "durable_fact_validation" });
  });

  it("fails closed when grounded normal-day evidence coexists with unexplained substantive skin input", async () => {
    await expect(extract(
      { reply: "好，我按这些整理。", daily_state: v2State([], "今天状态稳定。"), normal_day_evidence: { user_statements: ["今天状态挺稳定的"] } },
      request("请根据完整对话整理今天的皮肤状态。", ["用户：今天状态挺稳定的", "用户：不过鼻翼摸起来不太对"], { finalize_requested: true, completion_confirmation_pending: true }),
    )).rejects.toMatchObject({ stage: "durable_fact_validation" });
  });

  it("does not accept a completion-only turn as normal-day evidence", async () => {
    await expect(extract(
      { reply: "好，我按这些整理。", daily_state: v2State([], "今天没有特别变化。"), normal_day_evidence: { user_statements: ["没有了"] } },
      request("请根据完整对话整理今天的皮肤状态。", ["用户：没有了"], { finalize_requested: true, completion_confirmation_pending: true }),
    )).rejects.toMatchObject({ stage: "durable_fact_validation" });
  });

  it("does not treat uncertainty as a normal-day statement", async () => {
    await expect(extract(
      { reply: "我们可以先按你实际感觉慢慢说。" },
      request("请根据完整对话整理今天的皮肤状态。", ["用户：不知道"], { finalize_requested: true, completion_confirmation_pending: true }),
    )).rejects.toMatchObject({ stage: "durable_fact_validation" });
  });

  it("retains multiple confirmed V2 concerns together after finalization", async () => {
    const concerns = [concern(), concern({ kind: "flaking", areas: ["nose_wings"], attributes: { severity: "slight" } }), concern({ kind: "small_bumps", areas: ["forehead"], attributes: { amount: "several", distribution: "clustered" } })];
    const result = await extract({ reply: "好，我按这些整理。", daily_state: v2State(concerns) }, request("请根据完整对话整理今天的皮肤状态。", ["用户：T区油，鼻翼起皮，额头还有小疙瘩"], { finalize_requested: true, completion_confirmation_pending: true }));
    expect(result.daily_state?.version === 2 && result.daily_state.concerns.map((item) => item.kind)).toEqual(["oiliness", "flaking", "small_bumps"]);
  });

  it("retains only the explicit oiliness fact when the user says everything else is normal", async () => {
    const result = await extract(
      { reply: "好，我按这些整理。" },
      request("请根据完整对话整理今天的皮肤状态。", ["用户：今天鼻子有点油，其他没什么。"], { finalize_requested: true, completion_confirmation_pending: true }),
    );
    expect(result.daily_state?.version === 2 && result.daily_state.concerns).toEqual([
      expect.objectContaining({ kind: "oiliness", status: "present", areas: ["nose"] }),
    ]);
  });

  it("keeps a valid reply when optional structured data is malformed", async () => {
    const result = await extract({ reply: "我们先看看今天脸颊的感觉。", assessments: [{ field: "oiliness_level", status: "known", level: null, evidence: "invalid" }], daily_state: { version: 2, summary: null, concerns: [] }, unexpected_debug: { ignored: true } }, request("脸颊有点干"));
    expect(result).toMatchObject({ reply: "我们先看看今天脸颊的感觉。", readiness: "continue", daily_state: null });
    expect(result.changed_fields).toEqual([]);
  });

  it("keeps a hard provider failure separate from optional structured-data tolerance", async () => {
    const provider: SkinConversationProvider = { providerCode: "test", model: "test", extract: async () => { throw new Error("provider unavailable"); } };
    await expect(createSkinConversationService(provider).extract(request("T区"))).rejects.toThrow("provider unavailable");
  });

  it("does not turn Profile baseline into a daily fact", async () => {
    const result = await extract({ reply: "今天还好，我们继续按你实际感觉说。" }, request("今天还好", [], { profile_context: { skin_type: "oily", sensitivity_level: 3, skin_goals: ["oil_control"], long_term_skin_baseline: { usual_oily_areas: ["t_zone"], usual_dry_areas: [], recurring_tendencies: [] } } }));
    expect(result.proposed_checkin.known_fields).toEqual([]);
    expect(result.daily_state).toBeNull();
  });
});

async function extract(output: object, input: Record<string, unknown>) {
  const provider: SkinConversationProvider = { providerCode: "test", model: "test", extract: async () => output as never };
  return createSkinConversationService(provider).extract(input);
}
