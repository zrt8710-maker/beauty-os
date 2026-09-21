import { z } from "zod";

import { SKIN_CHECKIN_FIELDS, type SkinCheckinField, skinCheckinInputSchema, type SkinCheckinInput } from "@/schemas/checkin";
import { skinConversationResultSchema, type SkinConversationResult } from "@/schemas/skin-conversation";

export type ChatMessage = { id: string; role: "assistant" | "user"; content: string; kind?: "opening" | "reply" | "clarification" | "saved" };

const chatMessageSchema = z.object({ id: z.string().min(1), role: z.enum(["assistant", "user"]), content: z.string().min(1).max(2000), kind: z.enum(["opening", "reply", "clarification", "saved"]).optional() }).strict();
const sessionSchema = z.object({ messages: z.array(chatMessageSchema).max(30), composer: z.string().max(2000), proposal: skinConversationResultSchema.nullable(), editor: skinCheckinInputSchema.nullable(), completionConfirmationPending: z.boolean().default(false) }).strict();

export type SkinConversationSession = { messages: ChatMessage[]; composer: string; proposal: SkinConversationResult | null; editor: SkinCheckinInput | null; completionConfirmationPending: boolean };

export const openingMessage: ChatMessage = { id: "opening", role: "assistant", kind: "opening", content: "今天皮肤感觉怎么样？哪里让你觉得不太舒服，或者和平时不一样，都可以直接和我说。" };

/** The restart boundary intentionally excludes any persisted daily check-in. */
export function createRestartedConversationState(): SkinConversationSession {
  return { messages: [openingMessage], composer: "", proposal: null, editor: null, completionConfirmationPending: false };
}

export function conversationStorageKey(userId: string, recordedDate: string) { return `beauty-os:skin-conversation:${userId}:${recordedDate}`; }

export function clearConversationSession(storage: Pick<Storage, "removeItem">, key: string) { storage.removeItem(key); }

/** The durable pending flag is the source of truth after browser hydration. */
export function deriveCompletionAvailable(input: { completionConfirmationPending: boolean; hasProposal: boolean; status: string }) {
  return input.completionConfirmationPending && !input.hasProposal && input.status !== "saving" && input.status !== "saved";
}

/** Ending is user-authorized after their first real message; AI readiness only guides wording. */
export function canShowFinalizeButton(input: { messages: ChatMessage[]; hydrated: boolean; status: string }) {
  return input.hydrated
    && input.status !== "saved"
    && input.messages.some((message) => message.role === "user" && message.content.trim().length > 0);
}

export function buildActiveTurnContext(messages: ChatMessage[]) {
  const recent = messages.slice(-30).map((message) => `${message.role === "user" ? "用户" : "Beauty OS"}：${message.content.replace(/\s+/g, " ").slice(0, 360)}`);
  const context: string[] = [];
  let characters = 0;
  for (const entry of [...recent].reverse()) {
    if (characters + entry.length > 6000) break;
    context.unshift(entry);
    characters += entry.length;
  }
  return context;
}

/** IDs, not content, define a send lifecycle; identical text may be sent twice deliberately. */
export function appendChatMessage(messages: ChatMessage[], message: ChatMessage) {
  return messages.some((current) => current.id === message.id) ? messages : [...messages, message];
}

/** Only the provider's `reply` is user-facing. Planning and extraction fields must never cross this boundary. */
export function composeAssistantResponse(reply: string, _internalGuidance?: string) { return reply; }

export function parseConversationSession(value: string | null): SkinConversationSession | null {
  if (!value) return null;
  try { const parsed = sessionSchema.safeParse(JSON.parse(value)); return parsed.success ? parsed.data : null; } catch { return null; }
}

export function applyManualEditorSelection(current: SkinCheckinInput, field: SkinCheckinField, value: string): SkinCheckinInput {
  const known = new Set(current.known_fields);
  const provenance = { ...current.field_provenance };
  if (value === "unknown") { known.delete(field); delete provenance[field]; return { ...current, known_fields: SKIN_CHECKIN_FIELDS.filter((key) => known.has(key)), field_provenance: provenance }; }
  known.add(field); provenance[field] = [...new Set([...(provenance[field] ?? []), "manual" as const])];
  return { ...current, [field]: Number(value), known_fields: SKIN_CHECKIN_FIELDS.filter((key) => known.has(key)), field_provenance: provenance };
}
