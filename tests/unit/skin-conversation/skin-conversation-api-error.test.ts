import { describe, expect, it } from "vitest";

import { conversationErrorCode, conversationErrorMessage } from "@/features/skin-conversation/skin-conversation-api-error";

describe("skin conversation API errors", () => {
  it("maps each server failure class to a distinct user-facing message", () => {
    expect(conversationErrorMessage("AMBIGUOUS_INPUT")).toContain("没完全听明白");
    expect(conversationErrorMessage("SKIN_CONVERSATION_PROVIDER_FAILURE")).toContain("再试一次");
    expect(conversationErrorMessage("UNAUTHORIZED")).toContain("重新登录");
    expect(conversationErrorMessage("SKIN_CONVERSATION_INTERNAL_ERROR")).toContain("不会丢失");
  });

  it("reads only the structured server error code", () => {
    expect(conversationErrorCode({ error: { code: "UNAUTHORIZED" } })).toBe("UNAUTHORIZED");
    expect(conversationErrorCode({ error: { message: "no code" } })).toBeNull();
  });
});
