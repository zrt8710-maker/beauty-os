import "server-only";

import type { SkinConversationProvider } from "./provider";
import { createConfiguredOpenAiSkinConversationProvider } from "./openai-skin-conversation-provider";
import { createConfiguredVolcengineSkinConversationProvider } from "./volcengine-skin-conversation-provider";

/** Explicit selection: Volcengine is V1's configured default, never a fallback. */
export function createConfiguredSkinConversationProvider(): SkinConversationProvider | null {
  const selected = process.env.SKIN_CONVERSATION_PROVIDER?.trim().toLowerCase();
  if (!selected || selected === "volcengine") return createConfiguredVolcengineSkinConversationProvider();
  if (selected === "openai") return createConfiguredOpenAiSkinConversationProvider();
  return null;
}
