import { describe, expect, it } from "vitest";

import { createSkinConversationService } from "@/server/services/skin-conversation-service";
import type { SkinConversationProvider } from "@/server/skin-conversation/provider";

const finalize = async (history: string[], concerns: object[]) => createSkinConversationService({ providerCode: "test", model: "test", extract: async () => ({ reply: "已整理。", daily_state: { version: 2, summary: "今天的状态。", concerns } }) as never } satisfies SkinConversationProvider).extract({ message: "请根据完整对话整理今天的皮肤状态。", active_turn_context: history, recorded_date: "2026-09-01", existing_checkin: null, profile_context: null, completion_confirmation_pending: true, finalize_requested: true });
const concern = (patch: object) => ({ kind: "oiliness", status: "present", areas: ["t_zone"], attributes: {}, user_wording: [], source: ["conversation"], ...patch });

describe("finalize Daily Skin provenance bridge", () => {
  it("marks user-introduced concerns and their explicit areas as user-raised", async () => {
    const result = await finalize(["Beauty OS：今天皮肤感觉怎么样？", "用户：T区有点油，脸颊有点干"], [concern({}), concern({ kind: "dryness", areas: ["cheeks"] })]);
    expect(result.daily_state?.version === 2 && result.daily_state.concerns).toMatchObject([
      { interaction_origin: "user_raised", area_origin: "user_confirmed" },
      { interaction_origin: "user_raised", area_origin: "user_confirmed" },
    ]);
  });

  it("marks a response to a specific Profile-guided question as assistant-prompted", async () => {
    const result = await finalize(["Beauty OS：今天黑头方面和平时有变化吗？", "用户：没有"], [concern({ kind: "blackheads", status: "absent", areas: ["nose"] })]);
    expect(result.daily_state?.version === 2 && result.daily_state.concerns[0]).toMatchObject({ interaction_origin: "assistant_prompted", area_origin: "unknown" });
  });

  it("separates an answer to an assistant prompt from a new concern in the same user turn", async () => {
    const result = await finalize(["Beauty OS：今天黑头方面和平时有变化吗？", "用户：黑头没变化，不过脸颊今天有点干"], [concern({ kind: "blackheads", areas: ["nose"] }), concern({ kind: "dryness", areas: ["cheeks"] })]);
    expect(result.daily_state?.version === 2 && result.daily_state.concerns).toMatchObject([
      { interaction_origin: "assistant_prompted", area_origin: "unknown" },
      { interaction_origin: "user_raised", area_origin: "user_confirmed" },
    ]);
  });

  it("keeps a provider full_face area unknown unless the user confirmed it", async () => {
    const result = await finalize(["Beauty OS：今天皮肤感觉怎么样？", "用户：黑头没什么变化"], [concern({ kind: "blackheads", areas: ["full_face"] })]);
    expect(result.daily_state?.version === 2 && result.daily_state.concerns[0]?.area_origin).toBe("unknown");
  });

  it("overrides any provider-supplied origin with the deterministic conversation result", async () => {
    const result = await finalize(["Beauty OS：今天皮肤感觉怎么样？", "用户：T区有点油"], [concern({ interaction_origin: "assistant_prompted", area_origin: "assistant_suggested" })]);
    expect(result.daily_state?.version === 2 && result.daily_state.concerns[0]).toMatchObject({ interaction_origin: "user_raised", area_origin: "user_confirmed" });
  });
});
