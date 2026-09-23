import { describe, expect, it } from "vitest";

import { mapUsageFeedbackMessage } from "@/server/services/usage-feedback-conversation-service";

const milk = "10000000-0000-4000-8000-000000000001";
const spot = "10000000-0000-4000-8000-000000000002";

describe("usage feedback conversation deterministic mapper", () => {
  it("keeps a mildly acceptable texture issue and maps corrections as amendments", () => {
    const sticky = mapUsageFeedbackMessage({ completion_status: "partial", overall_notes: null, products: [
      { owned_product_id: milk, operation: "add", used_status: "used", sentiment: "positive_mild", texture_tags: ["too_sticky"], reaction_severity: null, reaction_tags: [], notes: "有点黏，但还好" },
    ] }, { conversationId: "10000000-0000-4000-8000-000000000010", messageId: "10000000-0000-4000-8000-000000000011" }, new Set([milk, spot]));
    expect(sticky.products).toEqual([expect.objectContaining({ owned_product_id: milk, operation: "add", rating: 4, texture_feedback: "too_sticky", reaction_level: null })]);

    const correction = mapUsageFeedbackMessage({ completion_status: "partial", overall_notes: null, products: [
      { owned_product_id: spot, operation: "amend", used_status: "used", sentiment: null, texture_tags: [], reaction_severity: "none", reaction_tags: [], notes: "不是刺痛，只是凉凉的感觉" },
    ] }, { conversationId: "10000000-0000-4000-8000-000000000010", messageId: "10000000-0000-4000-8000-000000000012" }, new Set([milk, spot]));
    expect(correction.products).toEqual([expect.objectContaining({ owned_product_id: spot, operation: "amend", rating: null, reaction_level: null, reaction_tags: [], notes: "不是刺痛，只是凉凉的感觉" })]);
  });

  it("keeps product dislike bound to the owned product", () => {
    const result = mapUsageFeedbackMessage({ completion_status: "partial", overall_notes: null, routine_role_preferences: [], products: [
      { owned_product_id: milk, operation: "add", used_status: "used", sentiment: "dislike", texture_tags: [], reaction_severity: null, reaction_tags: [], notes: "我不喜欢这瓶洗面奶" },
    ] }, { conversationId: "10000000-0000-4000-8000-000000000010", messageId: "10000000-0000-4000-8000-000000000013" }, new Set([milk]));

    expect(result.products).toEqual([expect.objectContaining({ owned_product_id: milk, rating: 2 })]);
    expect(result.routineRolePreferences).toEqual([]);
  });

  it("persists AM avoid and PM prefer as scoped routine-role preferences without a product binding", () => {
    const am = mapUsageFeedbackMessage({ completion_status: "partial", overall_notes: null, products: [], routine_role_preferences: [
      { scope: "routine_role", period: "am", routine_role: "cleanser", polarity: "avoid" },
    ] }, { conversationId: "10000000-0000-4000-8000-000000000010", messageId: "10000000-0000-4000-8000-000000000014" }, new Set([milk]));
    const pm = mapUsageFeedbackMessage({ completion_status: "partial", overall_notes: null, products: [], routine_role_preferences: [
      { scope: "routine_role", period: "pm", routine_role: "cleanser", polarity: "prefer" },
    ] }, { conversationId: "10000000-0000-4000-8000-000000000010", messageId: "10000000-0000-4000-8000-000000000015" }, new Set([milk]));

    expect(am.products).toEqual([]);
    expect(am.routineRolePreferences).toEqual([{ scope: "routine_role", period: "am", routine_role: "cleanser", polarity: "avoid" }]);
    expect(pm.routineRolePreferences).toEqual([{ scope: "routine_role", period: "pm", routine_role: "cleanser", polarity: "prefer" }]);
  });
});
