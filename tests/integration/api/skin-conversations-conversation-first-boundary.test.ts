import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUserWithDiagnostic: vi.fn(), createClient: vi.fn(), createConfiguredSkinConversationProvider: vi.fn(), findByDate: vi.fn(), findByUserId: vi.fn(),
}));

vi.mock("@/server/auth/get-current-user", () => ({ getCurrentUserWithDiagnostic: mocks.getCurrentUserWithDiagnostic }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/server/skin-conversation/configured-skin-conversation-provider", () => ({ createConfiguredSkinConversationProvider: mocks.createConfiguredSkinConversationProvider }));
vi.mock("@/server/repositories/skin-checkin-repository", () => ({ createSkinCheckinRepository: () => ({ findByDate: mocks.findByDate }) }));
vi.mock("@/server/repositories/profile-repository", () => ({ createProfileRepository: () => ({ findByUserId: mocks.findByUserId }) }));

import { POST } from "@/app/api/v1/skin-conversations/route";
import { SkinConversationProviderError } from "@/server/skin-conversation/provider";

describe("skin conversation reply-first route boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUserWithDiagnostic.mockResolvedValue({ user: { id: "user-a" }, reason: "authenticated" });
    mocks.createClient.mockResolvedValue({});
    mocks.findByDate.mockResolvedValue(null);
    mocks.findByUserId.mockResolvedValue(null);
  });

  it("returns an SSE final event when a provider includes an invalid optional daily state", async () => {
    mocks.createConfiguredSkinConversationProvider.mockReturnValue({ providerCode: "test", model: "test", extract: async () => ({ reply: "先看看脸颊是粗糙还是紧绷。", daily_state: { version: 2, summary: null, concerns: [] } }) });
    const response = await POST(request("脸颊有点干"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toContain('event: final\ndata: {"data":{"reply":"先看看脸颊是粗糙还是紧绷。"');
  });

  it("forwards reply deltas before the server-validated final event", async () => {
    mocks.createConfiguredSkinConversationProvider.mockReturnValue({ providerCode: "test", model: "test", extract: async (_input: unknown, callbacks?: { onReplyDelta?: (delta: string) => void }) => {
      callbacks?.onReplyDelta?.("先看看"); callbacks?.onReplyDelta?.("脸颊。");
      return { reply: "先看看脸颊。" };
    } });
    const response = await POST(request("脸颊有点干"));
    const body = await response.text();
    expect(body).toContain('event: reply_delta\ndata: {"delta":"先看看"}');
    expect(body).toContain('event: reply_delta\ndata: {"delta":"脸颊。"}');
    expect(body.indexOf("event: reply_delta")).toBeLessThan(body.indexOf("event: final"));
    expect(body).toContain('"reply":"先看看脸颊。"');
  });

  it("does not send a final event if the provider fails after a partial reply", async () => {
    mocks.createConfiguredSkinConversationProvider.mockReturnValue({ providerCode: "test", model: "test", extract: async (_input: unknown, callbacks?: { onReplyDelta?: (delta: string) => void }) => {
      callbacks?.onReplyDelta?.("先看看脸颊。"); throw new SkinConversationProviderError("provider stopped", "network");
    } });
    const response = await POST(request("脸颊有点干"));
    const body = await response.text();
    expect(body).toContain('event: reply_delta\ndata: {"delta":"先看看脸颊。"}');
    expect(body).toContain('event: error\ndata: {"error":{"code":"SKIN_CONVERSATION_PROVIDER_FAILURE"');
    expect(body).not.toContain("event: final");
  });
});

function request(message: string) {
  return new Request("http://localhost/api/v1/skin-conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, recorded_date: "2026-09-01", active_turn_context: [] }) });
}
