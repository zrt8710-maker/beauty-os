import { describe, expect, it } from "vitest";

import type { SkinConversationProvider } from "@/server/skin-conversation/provider";
import { createSkinConversationService } from "@/server/services/skin-conversation-service";

const request = (message: string, history: string[] = []) => ({ message, active_turn_context: history, recorded_date: "2026-08-31", existing_checkin: null, profile_context: null, completion_confirmation_pending: false });

describe("conversation-first Daily Skin", () => {
  it("does not require optional extraction or a follow-up to keep chatting", async () => {
    const result = await extract({ reply: "T区我记下了。" }, request("T区", ["Beauty OS：主要是哪里出油？"]));
    expect(result.readiness).toBe("continue");
    expect(result.clarification).toBeUndefined();
    expect(result.changed_fields).toEqual([]);
  });

  it.each([
    { daily_state: { version: 2, summary: null, concerns: [] } },
    { assessments: [{ field: "oiliness_level", status: "known", level: null, evidence: "invalid hint" }] },
    { unexpected_debug: { planning: "ignore this" } },
  ])("keeps a valid reply when optional structured data is invalid or unknown", async (optional) => {
    const result = await extract({ reply: "我们先看看今天脸颊的感觉。", ...optional }, request("脸颊有点干"));
    expect(result.reply).toBe("我们先看看今天脸颊的感觉。");
    expect(result.readiness).toBe("continue");
    expect(result.daily_state).toBeNull();
  });

  it("allows provider failure only when reply itself is missing or invalid", async () => {
    await expect(extract({ daily_state: null }, request("脸颊有点干"))).rejects.toThrow();
    await expect(extract({ reply: "   ", confidence: 60 }, request("脸颊有点干"))).rejects.toThrow();
  });

  it("makes natural completion available without creating a canonical state", async () => {
    const result = await extract({ reply: "好，我按这些整理。" }, request("就这些", ["Beauty OS：还有其他今天想记下的吗？没有的话我就按这些整理。"]));
    expect(result.readiness).toBe("confirm");
    expect(result.completion_available).toBe(true);
    expect(result.unknown_fields).toHaveLength(5);
    expect(result.daily_state).toBeNull();
  });

  it("uses a provider completion intent only for one optional final invitation", async () => {
    const result = await extract({ reply: "我已经大致了解了。", conversational_intent: "complete" }, request("差不多", ["用户：T区有点油", "Beauty OS：今天出油和平时比呢？"]));
    expect(result.readiness).toBe("confirm");
    expect(result.completion_available).toBe(true);
  });

  it("exposes finalize availability when the provider marks a settled turn confirm or ready", async () => {
    const result = await extract({ reply: "好，我来整理今天的情况。", readiness: "ready" }, request("差不多", ["用户：今天有点油", "Beauty OS：和平时比，今天出油程度差不多吗？"]));
    expect(result).toMatchObject({ readiness: "confirm", completion_available: true, daily_state: null });
  });

  it("does not let an optional Profile topic block the model's natural completion", async () => {
    const result = await extract({ reply: "还有什么今天特别想记下的吗？没有的话我就按这些整理。", conversational_intent: "complete", daily_state: { version: 2, summary: "不应生成", concerns: [] } }, { ...request("差不多", ["用户：T区有点油", "Beauty OS：T区出油和平时比，今天差不多还是更明显？"]), profile_context: { skin_type: "oily", sensitivity_level: 1, skin_goals: [], long_term_skin_baseline: { usual_oily_areas: ["t_zone"], usual_dry_areas: [], recurring_tendencies: [{ kind: "blackheads", usual_areas: ["nose"], tendency: "recurring", source: "user_declared" }] } } });
    expect(result.readiness).toBe("confirm");
    expect(result.completion_available).toBe(true);
    expect(result.reply).toContain("还有什么今天特别想记下的吗");
    expect(result.daily_state).toBeNull();
    expect(result.changed_fields).toEqual([]);
  });

  it("allows a focused nose-dryness conversation to close without surveying unrelated Profile tendencies", async () => {
    const result = await extract(
      { reply: "鼻翼的干燥已经说清楚了，今天先按这些整理也可以。", conversational_intent: "complete" },
      {
        ...request("其他没什么", ["用户：今天鼻翼有点干", "Beauty OS：鼻翼现在更像紧绷、粗糙，还是有起皮？", "用户：有一点紧绷"]),
        profile_context: {
          skin_type: "oily",
          sensitivity_level: 1,
          skin_goals: ["blemish_care"],
          long_term_skin_baseline: {
            usual_oily_areas: ["t_zone"],
            usual_dry_areas: ["nose_wings"],
            recurring_tendencies: [{ kind: "blackheads", usual_areas: ["nose"], tendency: "recurring", source: "user_declared" }],
          },
        },
      },
    );
    expect(result).toMatchObject({ readiness: "confirm", completion_available: true, daily_state: null });
  });

  it("does not let an unresolved today-new area block the model's natural completion", async () => {
    const result = await extract({ reply: "还有什么今天特别想记下的吗？", conversational_intent: "complete" }, { ...request("脸颊有点干"), profile_context: { skin_type: "combination", sensitivity_level: 1, skin_goals: [], long_term_skin_baseline: { usual_oily_areas: ["t_zone"], usual_dry_areas: ["nose_wings"], recurring_tendencies: [] } } });
    expect(result.readiness).toBe("confirm");
    expect(result.completion_available).toBe(true);
  });

  it("does not replace the provider's natural wording with a deterministic Profile question", async () => {
    const result = await extract({ reply: "好，我们继续看看。", conversational_intent: "continue" }, { ...request("差不多", ["用户：T区有点油", "Beauty OS：T区出油和平时比，今天差不多还是更明显？"]), profile_context: { skin_type: "oily", sensitivity_level: 1, skin_goals: [], long_term_skin_baseline: { usual_oily_areas: ["t_zone"], usual_dry_areas: [], recurring_tendencies: [{ kind: "blackheads", usual_areas: ["nose"], tendency: "recurring", source: "user_declared" }] } } });
    expect(result.readiness).toBe("continue");
    expect(result.reply).toBe("好，我们继续看看。");
  });

  it("keeps a contextual comparison answer in the conversation rather than generating a report", async () => {
    const result = await extract({ reply: "今天出油和平时差不多。", conversational_intent: "complete", assessments: [{ field: "oiliness_level", status: "known", level: 1, evidence: "用户确认有一点油感" }] }, request("差不多", ["用户：今天有点油", "Beauty OS：和平时比，今天出油程度差不多吗？"]));
    expect(result.readiness).toBe("confirm");
    expect(result.daily_state).toBeNull();
    expect(result.changed_fields).toEqual(["oiliness_level"]);
  });

  it("uses the generic supplementation invitation when no Profile topic is relevant", async () => {
    const result = await extract({ reply: "今天出油和平时差不多。", conversational_intent: "complete" }, request("差不多", ["用户：今天有点油", "Beauty OS：和平时比，今天出油程度差不多吗？"]));
    expect(result.readiness).toBe("confirm");
    expect(result.completion_available).toBe(true);
    expect(result.daily_state).toBeNull();
  });

  it("turns an explicit natural-language finish into finalize availability, not save", async () => {
    const result = await extract({ reply: "好，我按这些整理。" }, request("没有了", ["用户：今天有点油", "Beauty OS：还有其他今天想记下的吗？没有的话我就按这些整理。"]));
    expect(result).toMatchObject({ readiness: "confirm", completion_available: true, daily_state: null });
  });

  it("removes finalize availability when the user continues with a new concern", async () => {
    const result = await extract({ reply: "鼻翼这边先看看是起皮还是紧绷。", conversational_intent: "continue" }, request("不过鼻翼有点起皮", ["用户：今天有点油", "Beauty OS：如果没有其他补充，可以结束这轮，我来整理今天的状态。"]));
    expect(result).toMatchObject({ readiness: "continue", completion_available: false });
  });

  it("finalizes and creates a canonical fallback state only after the explicit UI signal", async () => {
    const result = await extract({ reply: "好，我按这些整理。" }, { ...request("请根据完整对话整理今天的皮肤状态。", ["用户：今天有点油", "Beauty OS：还有其他今天想记下的吗？没有的话我就按这些整理。"]), finalize_requested: true });
    expect(result).toMatchObject({ readiness: "ready", daily_state: { version: 2 } });
    expect(result.proposed_checkin.daily_state).toEqual(result.daily_state);
  });

  it("strictly accepts a canonical Daily Skin state only after the explicit UI signal", async () => {
    const result = await extract({ reply: "好，我按这些整理。", daily_state: { version: 2, summary: "今天确认了脸颊干燥。", concerns: [] } }, { ...request("请根据完整对话整理今天的皮肤状态。", ["用户：脸颊有点干", "Beauty OS：还有其他今天想记下的吗？没有的话我就按这些整理。"]), finalize_requested: true });
    expect(result.readiness).toBe("ready");
    expect(result.daily_state?.summary).toBe("今天确认了脸颊干燥。");
  });

  it("keeps multi-concern wording in one turn without forcing a canonical patch", async () => {
    const result = await extract({ reply: "T区出油、鼻翼起皮和额头的小疙瘩我都记下了。", suggested_followup: "这些小疙瘩摸起来更像一粒粒的小凸起，还是会红、会疼？" }, request("T区油，鼻翼起皮，额头还有小疙瘩"));
    expect(result.readiness).toBe("continue");
    expect(result.reply).toContain("鼻翼起皮");
    expect(result.changed_fields).toEqual([]);
  });

  it("removes internal planning mistakenly placed in provider reply", async () => {
    for (const leakedReply of ["了解今日出油与平时的对比情况", "用户新提出有闭口和黑头，需要进一步了解小颗粒的大致数量情况"]) {
      const result = await extract({ reply: leakedReply }, request("今天有点油"));
      expect(result.reply).not.toContain(leakedReply);
      expect(result.reply).not.toMatch(/了解今日|用户新提出|进一步了解/u);
    }
  });

  it("keeps an uncertain oil comparison unknown without replacing a natural reply", async () => {
    const reply = "不太确定也没关系，可以先看看有没有油光或明显油感。";
    const result = await extract({ reply, assessments: [{ field: "oiliness_level", status: "known", level: 1, evidence: "模型推断" }] }, request("差不多吧，好像少一点？？我有点不知道？", ["用户：今天有点油"]));
    expect(result.reply).toBe(reply);
    expect(result.proposed_checkin.known_fields).not.toContain("oiliness_level");
  });

  it("keeps uncertainty in the fact layer while leaving the model's reply natural", async () => {
    const reply = "如果不太确定也没关系，先说说有没有油光或油感。";
    const withBaseline = await extract({ reply }, { ...request("不知道算不算油"), profile_context: { skin_type: "combination", sensitivity_level: 1, skin_goals: [], long_term_skin_baseline: { usual_oily_areas: ["t_zone"], usual_dry_areas: [], recurring_tendencies: [] } } });
    const withoutBaseline = await extract({ reply }, request("不知道算不算油"));
    expect(withBaseline.reply).toBe(reply);
    expect(withoutBaseline.reply).toBe(reply);
    expect(withBaseline.proposed_checkin.known_fields).not.toContain("oiliness_level");
    expect(withoutBaseline.proposed_checkin.known_fields).not.toContain("oiliness_level");
  });
});

async function extract(output: object, input: Parameters<ReturnType<typeof createSkinConversationService>["extract"]>[0]) {
  const provider: SkinConversationProvider = { providerCode: "test", model: "test", extract: async () => output as never };
  return createSkinConversationService(provider).extract(input);
}
