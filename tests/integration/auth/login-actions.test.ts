import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      signInWithOtp: mocks.signInWithOtp,
    },
  })),
}));

import { sendMagicLink } from "@/app/(auth)/login/actions";

describe("Email Magic Link login action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://beauty.example.com");
    vi.stubEnv("AUTH_ALLOWED_EMAIL", "owner@example.com");
    mocks.signInWithOtp.mockResolvedValue({ error: null });
  });

  it.each(["owner@example.com", "new-user@example.net"])("allows %s despite a stale whitelist and requests signup via the production PKCE callback", async (email) => {
    const formData = new FormData();
    formData.set("email", email);

    await expect(sendMagicLink({ status: "idle" }, formData)).resolves.toEqual({
      status: "success",
      message: "登录链接已发送，请检查你的邮箱。",
    });
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: "https://beauty.example.com/auth/callback",
      },
    });
  });

  it("returns the rate-limit copy without retrying", async () => {
    mocks.signInWithOtp.mockResolvedValue({
      error: {
        name: "AuthApiError",
        status: 429,
        code: "over_email_send_rate_limit",
        message: "rate limited",
      },
    });
    const formData = new FormData();
    formData.set("email", "owner@example.com");

    await expect(sendMagicLink({ status: "idle" }, formData)).resolves.toEqual({
      status: "error",
      message: "发送过于频繁，请稍后再试。",
    });
    expect(mocks.signInWithOtp).toHaveBeenCalledOnce();
  });
});
