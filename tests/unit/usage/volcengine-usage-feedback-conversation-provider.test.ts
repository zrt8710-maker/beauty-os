import { describe, expect, it, vi } from "vitest";

import { createVolcengineUsageFeedbackConversationProvider } from "@/server/usage-feedback-conversation/volcengine-usage-feedback-conversation-provider";

const milk = "10000000-0000-4000-8000-000000000001";
const spot = "10000000-0000-4000-8000-000000000002";

describe("Volcengine usage-feedback conversation provider", () => {
  it("separates natural reply rules from strict fact extraction rules", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      reply: "懂，就是能用，但肤感没那么讨喜。",
      draft: stickyDraft(),
    }));
    const provider = createVolcengineUsageFeedbackConversationProvider({ apiKey: "key", model: "model", baseUrl: "https://example.test", fetchImpl });

    await provider.converse(input("溪木源有点黏，但还好啦"));

    const request = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(request.instructions).toContain("REPLY STYLE — applies only to reply:");
    expect(request.instructions).toContain("FACT EXTRACTION RULES — applies only to draft:");
    expect(request.instructions).toContain("The presence of a draft must NOT change the conversational style of reply.");
    expect(request.instructions).toContain("follow their conversational direction");
    expect(request.instructions).toContain("rather than following a fixed questionnaire");
    expect(request.instructions).toContain("The JSON envelope is internal transport; the user sees only reply.");
    expect(request.instructions).toContain("只问一个开放、好回答的问题");
    expect(request.instructions).toContain("do not ask them to confirm a subtype you invented");
    expect(request.instructions).toContain("对话示范仅说明如何接住用户的话，不是固定问法");
    expect(request.instructions).not.toContain("Ask one brief, natural clarification only if product reference is unresolved");
    expect(request.instructions).not.toContain("reply naturally that the feedback has been noted");
    expect(request.instructions).toContain("too_sticky together with positive_mild");
    expect(request.instructions).toContain("routine_role_preferences");
    expect(request.instructions).toContain("我早上不喜欢用洗面奶");
    expect(request.instructions).not.toContain('includes("早上")');
    expect(request.text.format.schema.properties.draft.properties.routine_role_preferences).toBeDefined();
  });

  it("keeps a natural reply and correction draft in the same structured call", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      reply: "哦，那差别挺大的。只是凉感的话，就不能算刺痛了。",
      draft: {
        completion_status: "partial", overall_notes: null, products: [{
          owned_product_id: spot, operation: "amend", used_status: "used", sentiment: null,
          texture_tags: [], reaction_severity: "none", reaction_tags: [], notes: "不是刺痛，就是凉凉的感觉",
        }],
      },
    }));
    const provider = createVolcengineUsageFeedbackConversationProvider({ apiKey: "key", model: "model", baseUrl: "https://example.test", fetchImpl });

    const output = await provider.converse(input("不是刺痛，就是凉凉的"));

    expect(output).toEqual(expect.objectContaining({
      reply: expect.not.stringMatching(/记下|记录|对吧/),
      draft: expect.objectContaining({ products: [expect.objectContaining({ operation: "amend", reaction_severity: "none", reaction_tags: [] })] }),
    }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

function input(message: string) {
  return {
    message, activeTurnContext: ["用户：羽素有点刺"], personalMemoryContext: ["用户偏好轻薄不黏"],
    routine: { period: "pm" as const, steps: [
      { ownedProductId: milk, productName: "溪木源精华乳", stepOrder: 1 },
      { ownedProductId: spot, productName: "羽素", stepOrder: 2 },
    ] },
  };
}

function stickyDraft() {
  return {
    completion_status: "partial", overall_notes: null, products: [{
      owned_product_id: milk, operation: "add", used_status: "used", sentiment: "positive_mild",
      texture_tags: ["too_sticky"], reaction_severity: null, reaction_tags: [], notes: "有点黏，但还好啦",
    }],
  };
}

function jsonResponse(output: unknown) {
  return { ok: true, json: async () => ({ output_text: JSON.stringify(output) }) } as Response;
}
