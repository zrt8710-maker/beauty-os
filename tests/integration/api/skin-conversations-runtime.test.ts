import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUserWithDiagnostic: vi.fn(), createClient: vi.fn(), createConfiguredSkinConversationProvider: vi.fn(),
  findByDate: vi.fn(), findByUserId: vi.fn(), extract: vi.fn(),
}));

vi.mock("@/server/auth/get-current-user", () => ({ getCurrentUserWithDiagnostic: mocks.getCurrentUserWithDiagnostic }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/server/skin-conversation/configured-skin-conversation-provider", () => ({ createConfiguredSkinConversationProvider: mocks.createConfiguredSkinConversationProvider }));
vi.mock("@/server/repositories/skin-checkin-repository", () => ({ createSkinCheckinRepository: () => ({ findByDate: mocks.findByDate }) }));
vi.mock("@/server/repositories/profile-repository", () => ({ createProfileRepository: () => ({ findByUserId: mocks.findByUserId }) }));
vi.mock("@/server/services/skin-conversation-service", () => ({ createSkinConversationService: () => ({ extract: mocks.extract }) }));

import { POST } from "@/app/api/v1/skin-conversations/route";
import { SkinConversationProviderError } from "@/server/skin-conversation/provider";

describe("skin conversation runtime error boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUserWithDiagnostic.mockResolvedValue({ user: { id: "user-a" }, reason: "authenticated" });
    mocks.createClient.mockResolvedValue({}); mocks.createConfiguredSkinConversationProvider.mockReturnValue({});
    mocks.findByDate.mockResolvedValue(null); mocks.findByUserId.mockResolvedValue(null);
  });

  it("returns an explicit authentication error before the provider is touched", async () => {
    mocks.getCurrentUserWithDiagnostic.mockResolvedValue({ user: null, reason: "missing_subject" });
    const response = await POST(request("今天有点油"));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("UNAUTHORIZED");
    expect(mocks.createConfiguredSkinConversationProvider).not.toHaveBeenCalled();
  });

  it("sends a retryable provider error event when the streamed provider fails", async () => {
    mocks.extract.mockRejectedValue(new SkinConversationProviderError("invalid JSON", "response"));
    const response = await POST(request("今天有点油"));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('event: error\ndata: {"error":{"code":"SKIN_CONVERSATION_PROVIDER_FAILURE"');
    expect(response.headers.get("x-skin-conversation-request-id")).toBeTruthy();
  });

  it("keeps unrelated server faults distinct in a streamed error event", async () => {
    mocks.extract.mockRejectedValue(new Error("repository serialization bug"));
    const response = await POST(request("今天有点油"));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('event: error\ndata: {"error":{"code":"SKIN_CONVERSATION_INTERNAL_ERROR"');
  });
});

function request(message: string) {
  return new Request("http://localhost/api/v1/skin-conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, recorded_date: "2026-08-31", active_turn_context: [] }) });
}
