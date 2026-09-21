import { describe, expect, it } from "vitest";

import { deriveDurableConversationFacts } from "@/server/skin-conversation/durable-conversation-facts";
import { createSkinConversationService } from "@/server/services/skin-conversation-service";
import type { SkinConversationProvider } from "@/server/skin-conversation/provider";

const date = "2026-09-05";
const history = [
  "Beauty OS：今天皮肤感觉怎么样？",
  "用户：鼻翼有点油，额头有几个小颗粒，没有刺痛",
  "Beauty OS：还有什么今天特别想记下的吗？没有的话我就按这些帮你整理。",
  "用户：没有了",
];

describe("Daily Skin conversation durable facts", () => {
  it("extracts only observable present and explicitly absent facts", () => {
    const state = deriveDurableConversationFacts(history);
    expect(state.concerns).toMatchObject([
      { kind: "oiliness", status: "present", areas: ["nose_wings"], attributes: { severity: "slight" } },
      { kind: "small_bumps", status: "present", areas: ["forehead"], attributes: { amount: "few", distribution: "localized" } },
      { kind: "stinging", status: "absent", areas: ["other"], attributes: {} },
    ]);
    expect(state.concerns.some((concern) => concern.kind === "redness")).toBe(false);
  });

  it("recovers the full transcript when finalize returns reply-only output", async () => {
    const provider: SkinConversationProvider = { providerCode: "test", model: "test", extract: async () => ({ reply: "好，我按这些整理。" }) as never };
    const result = await createSkinConversationService(provider).extract({
      message: "请根据完整对话整理今天的皮肤状态。",
      active_turn_context: history,
      recorded_date: date,
      existing_checkin: null,
      profile_context: null,
      completion_confirmation_pending: true,
      finalize_requested: true,
    });
    expect(result.daily_state?.version === 2 && result.daily_state.concerns.map((concern) => concern.kind)).toEqual(["oiliness", "small_bumps", "stinging"]);
    expect(result.proposed_checkin.daily_state).toEqual(result.daily_state);
    expect(result.proposed_checkin).toMatchObject({
      oiliness_level: 1,
      known_fields: ["oiliness_level"],
      field_provenance: { oiliness_level: ["conversation"] },
    });
  });

  it("does not turn completion or silence into absent concerns", () => {
    expect(deriveDurableConversationFacts([
      "用户：额头有几个小颗粒",
      "Beauty OS：还有什么今天特别想记下的吗？没有的话我就按这些整理。",
      "用户：没有了",
    ]).concerns).toEqual([expect.objectContaining({ kind: "small_bumps", status: "present" })]);
    expect(deriveDurableConversationFacts(["用户：没有了"]).concerns).toEqual([]);
  });

  it("keeps uncertain mentions unknown", () => {
    expect(deriveDurableConversationFacts(["用户：我不确定这算不算泛红"]).concerns).toEqual([]);
  });

  it("fails closed instead of saving an empty placeholder for unextracted substantive input", async () => {
    const provider: SkinConversationProvider = { providerCode: "test", model: "test", extract: async () => ({ reply: "好，我按这些整理。" }) as never };
    await expect(createSkinConversationService(provider).extract({
      message: "请根据完整对话整理今天的皮肤状态。",
      active_turn_context: ["用户：脸摸起来状态不太对"],
      recorded_date: date,
      existing_checkin: null,
      profile_context: null,
      completion_confirmation_pending: true,
      finalize_requested: true,
    })).rejects.toMatchObject({ stage: "durable_fact_validation" });
  });
});
