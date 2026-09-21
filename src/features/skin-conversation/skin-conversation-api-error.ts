export type ConversationApiErrorCode =
  | "AMBIGUOUS_INPUT"
  | "SKIN_CONVERSATION_PROVIDER_FAILURE"
  | "SKIN_CONVERSATION_UNAVAILABLE"
  | "UNAUTHORIZED"
  | "SKIN_CONVERSATION_INTERNAL_ERROR"
  | "VALIDATION_ERROR";

export function conversationErrorMessage(code: ConversationApiErrorCode | null): string {
  switch (code) {
    case "AMBIGUOUS_INPUT": return "我还没完全听明白，你可以再说具体一点。";
    case "SKIN_CONVERSATION_PROVIDER_FAILURE":
    case "SKIN_CONVERSATION_UNAVAILABLE": return "刚才整理时有点卡住了，再试一次就好。";
    case "UNAUTHORIZED": return "登录状态好像失效了，请重新登录后继续。";
    default: return "刚才整理记录时出了点问题，你的已有内容不会丢失。";
  }
}

export function conversationErrorCode(value: unknown): ConversationApiErrorCode | null {
  if (typeof value !== "object" || value === null || !("error" in value)) return null;
  const error = value.error;
  if (typeof error !== "object" || error === null || !("code" in error) || typeof error.code !== "string") return null;
  return error.code as ConversationApiErrorCode;
}
