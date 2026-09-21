import { describe, expect, it } from "vitest";

import { appendChatMessage, applyManualEditorSelection, buildActiveTurnContext, canShowFinalizeButton, conversationStorageKey, createRestartedConversationState, deriveCompletionAvailable, openingMessage, parseConversationSession, type ChatMessage } from "@/features/skin-conversation/skin-conversation-state";
import type { SkinCheckinInput } from "@/schemas/checkin";

const messages: ChatMessage[] = [
  { id: "a", role: "assistant", content: "今天皮肤感觉怎么样？", kind: "opening" },
  { id: "u", role: "user", content: "今天长痘了。" },
  { id: "c", role: "assistant", content: "大概几颗，主要在哪个部位？", kind: "clarification" },
];

describe("Skin Conversation active-session state", () => {
  it("restarts with only the opening message and no unsaved proposal", () => {
    expect(createRestartedConversationState()).toEqual({ messages: [openingMessage], composer: "", proposal: null, editor: null, completionConfirmationPending: false });
  });

  it("preserves ordered user and assistant context", () => {
    expect(buildActiveTurnContext(messages)).toEqual(["Beauty OS：今天皮肤感觉怎么样？", "用户：今天长痘了。", "Beauty OS：大概几颗，主要在哪个部位？"]);
  });

  it("deduplicates only a repeated lifecycle ID, not repeated user text", () => {
    const sent = { id: "send-1", role: "user" as const, content: "有点出油" };
    expect(appendChatMessage([openingMessage], sent)).toHaveLength(2);
    expect(appendChatMessage([openingMessage, sent], sent)).toHaveLength(2);
    expect(appendChatMessage([openingMessage, sent], { ...sent, id: "send-2" })).toHaveLength(3);
  });

  it("keeps unknown possible in the inline editor", () => {
    const initial: SkinCheckinInput = { dryness_level: 0, oiliness_level: 0, redness_level: 0, sensitivity_level: 0, acne_level: 1, notes: null, daily_state: null, recorded_date: "2026-08-30", known_fields: ["acne_level"], field_provenance: { acne_level: ["conversation"] } };
    const changed = applyManualEditorSelection(initial, "acne_level", "unknown");
    expect(changed.known_fields).toEqual([]);
    expect(changed.field_provenance).toEqual({});
  });

  it("validates a recoverable browser-session draft", () => {
    const value = JSON.stringify({ messages, composer: "下巴两颗。", proposal: null, editor: null });
    expect(parseConversationSession(value)).toMatchObject({ messages, composer: "下巴两颗。" });
    expect(conversationStorageKey("user-a", "2026-08-30")).toBe("beauty-os:skin-conversation:user-a:2026-08-30");
  });

  it("restores finalize availability from the persisted completion-pending state", () => {
    const restored = parseConversationSession(JSON.stringify({ messages, composer: "", proposal: null, editor: null, completionConfirmationPending: true }));
    expect(deriveCompletionAvailable({ completionConfirmationPending: restored!.completionConfirmationPending, hasProposal: false, status: "idle" })).toBe(true);
    expect(deriveCompletionAvailable({ completionConfirmationPending: true, hasProposal: true, status: "idle" })).toBe(false);
    expect(deriveCompletionAvailable({ completionConfirmationPending: true, hasProposal: false, status: "saved" })).toBe(false);
  });

  it("shows the user-authorized finalize action after the first real user message, not AI readiness", () => {
    expect(canShowFinalizeButton({ messages: [openingMessage], hydrated: true, status: "idle" })).toBe(false);
    expect(canShowFinalizeButton({ messages: [...messages], hydrated: true, status: "idle" })).toBe(true);
    expect(canShowFinalizeButton({ messages: [...messages], hydrated: false, status: "idle" })).toBe(false);
    expect(canShowFinalizeButton({ messages: [...messages], hydrated: true, status: "sending" })).toBe(true);
    expect(canShowFinalizeButton({ messages: [...messages], hydrated: true, status: "saving" })).toBe(true);
    expect(canShowFinalizeButton({ messages: [...messages], hydrated: true, status: "saved" })).toBe(false);
    expect(createRestartedConversationState().completionConfirmationPending).toBe(false);
  });
});
