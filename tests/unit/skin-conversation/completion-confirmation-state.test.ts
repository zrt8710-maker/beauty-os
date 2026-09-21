import { describe, expect, it, vi } from "vitest";

import { buildActiveTurnContext, clearConversationSession, composeAssistantResponse, createRestartedConversationState, openingMessage } from "@/features/skin-conversation/skin-conversation-state";
import { isCompletionConfirmation } from "@/server/services/skin-conversation-service";

describe("Daily Skin completion confirmation", () => {
  it("renders only provider reply and never an internal clarification", () => {
    expect(composeAssistantResponse("额头闭口我记下了。主要集中在额头吗？", "主要集中在额头吗？")).toBe("额头闭口我记下了。主要集中在额头吗？");
    expect(composeAssistantResponse("我先记下了。", "主要在额头还是脸颊？")).toBe("我先记下了。");
    expect(composeAssistantResponse("我先记下了。", "确认用户是否有其他今日皮肤状况需要记录，收尾时轻问闭口或痘痘变化")).toBe("我先记下了。");
    expect(composeAssistantResponse("我先记下了。", "了解今日出油与平时的对比情况")).toBe("我先记下了。");
    expect(composeAssistantResponse("我先记下了。", "用户新提出有闭口和黑头，需要进一步了解小颗粒的大致数量情况")).toBe("我先记下了。");
  });

  it("recognizes natural no-more-concerns confirmations without turning unknown concerns into facts", () => {
    expect(isCompletionConfirmation("没有了")).toBe(true);
    expect(isCompletionConfirmation("差不多就这些。")).toBe(true);
    expect(isCompletionConfirmation("先这样")).toBe(true);
    expect(isCompletionConfirmation("可以了")).toBe(true);
    expect(isCompletionConfirmation("额头还有很多闭口")).toBe(false);
  });

  it("does not mistake a comparison answer for the end of the conversation", () => {
    expect(isCompletionConfirmation("差不多", ["Beauty OS：和平时比，今天出油程度差不多吗？"])).toBe(false);
    expect(isCompletionConfirmation("没有", ["Beauty OS：今天有刺痛或泛红吗？"])).toBe(false);
    expect(isCompletionConfirmation("没有了", ["Beauty OS：还有其他今天想记下的吗？没有的话我就按这些整理。"])).toBe(true);
    expect(isCompletionConfirmation("帮我整理吧", ["Beauty OS：还有什么今天特别想记下的吗？没有的话我就按这些帮你整理。"])).toBe(true);
    expect(isCompletionConfirmation("整理一下", ["Beauty OS：还有什么今天特别想记下的吗？没有的话我就按这些帮你整理。"])).toBe(true);
    expect(isCompletionConfirmation("就按这些整理", ["Beauty OS：还有什么今天特别想记下的吗？没有的话我就按这些帮你整理。"])).toBe(true);
    expect(isCompletionConfirmation("帮我整理吧", ["Beauty OS：今天主要是紧绷还是粗糙？"])).toBe(false);
  });

  it("restarts as a clean opening transcript without a fake user restart message", () => {
    expect(createRestartedConversationState()).toEqual({ messages: [openingMessage], composer: "", proposal: null, editor: null, completionConfirmationPending: false });
    expect(createRestartedConversationState().messages.some((message) => message.role === "user" && message.content.includes("重新聊聊"))).toBe(false);
  });

  it("clears the persisted unsaved session", () => {
    const removeItem = vi.fn();
    clearConversationSession({ removeItem }, "beauty-os:skin-conversation:user:today");
    expect(removeItem).toHaveBeenCalledWith("beauty-os:skin-conversation:user:today");
  });

  it("keeps the most recent turns when the history context reaches its character cap", () => {
    const messages = Array.from({ length: 30 }, (_, index) => ({ id: String(index), role: index % 2 ? "assistant" as const : "user" as const, content: `${index}:${"x".repeat(350)}` }));
    const context = buildActiveTurnContext(messages);
    expect(context.at(-1)).toContain("29:");
    expect(context.join("").length).toBeLessThanOrEqual(6000);
  });
});
