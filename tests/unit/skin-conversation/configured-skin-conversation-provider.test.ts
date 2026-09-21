import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ volcengine: vi.fn(), openai: vi.fn() }));
vi.mock("@/server/skin-conversation/volcengine-skin-conversation-provider", () => ({ createConfiguredVolcengineSkinConversationProvider: mocks.volcengine }));
vi.mock("@/server/skin-conversation/openai-skin-conversation-provider", () => ({ createConfiguredOpenAiSkinConversationProvider: mocks.openai }));

import { createConfiguredSkinConversationProvider } from "@/server/skin-conversation/configured-skin-conversation-provider";

const original = process.env.SKIN_CONVERSATION_PROVIDER;
afterEach(() => { if (original === undefined) delete process.env.SKIN_CONVERSATION_PROVIDER; else process.env.SKIN_CONVERSATION_PROVIDER = original; vi.clearAllMocks(); });

describe("Skin Conversation provider composition", () => {
  it("uses Volcengine by default and OpenAI only when explicitly selected", () => {
    delete process.env.SKIN_CONVERSATION_PROVIDER;
    createConfiguredSkinConversationProvider();
    expect(mocks.volcengine).toHaveBeenCalledOnce();
    process.env.SKIN_CONVERSATION_PROVIDER = "openai";
    createConfiguredSkinConversationProvider();
    expect(mocks.openai).toHaveBeenCalledOnce();
  });
});
