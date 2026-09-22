import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  findByUserId: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      signInWithOtp: mocks.signInWithOtp,
      verifyOtp: mocks.verifyOtp,
    },
  })),
}));

vi.mock("@/server/repositories/profile-repository", () => ({
  createProfileRepository: vi.fn(() => ({ findByUserId: mocks.findByUserId })),
}));

import { sendEmailOtp, verifyEmailOtp } from "@/app/(auth)/login/actions";

const idle = { status: "idle" } as const;

describe("Email OTP login actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("AUTH_ALLOWED_EMAIL", "owner@example.com");
    mocks.signInWithOtp.mockResolvedValue({ error: null });
    mocks.verifyOtp.mockResolvedValue({ data: { user: { id: "user-a" } }, error: null });
  });

  it.each(["owner@example.com", "new-user@example.net"])(
    "allows %s and requests a six-digit OTP with automatic signup",
    async (email) => {
      const formData = new FormData();
      formData.set("email", email);
      await expect(sendEmailOtp(idle, formData)).resolves.toMatchObject({
        status: "success",
        message: "验证码已发送至你的邮箱。",
        email,
      });
      expect(mocks.signInWithOtp).toHaveBeenCalledWith({
        email,
        options: { shouldCreateUser: true },
      });
    },
  );

  it("returns readable rate-limit copy without retrying", async () => {
    mocks.signInWithOtp.mockResolvedValue({
      error: { name: "AuthApiError", status: 429, code: "over_email_send_rate_limit", message: "rate limited" },
    });
    const formData = new FormData();
    formData.set("email", "owner@example.com");
    await expect(sendEmailOtp(idle, formData)).resolves.toEqual({
      status: "error",
      message: "发送过于频繁，请稍后再试。",
    });
    expect(mocks.signInWithOtp).toHaveBeenCalledOnce();
  });

  it.each([
    ["2026-01-01T00:00:00.000Z", "/app"],
    [null, "/profile"],
  ] as const)(
    "verifies the OTP and routes by onboarding completion",
    async (onboardingCompletedAt, redirectTo) => {
      mocks.findByUserId.mockResolvedValue({ onboarding_completed_at: onboardingCompletedAt });
      const formData = new FormData();
      formData.set("email", "user@example.com");
      formData.set("token", "123456");
      await expect(verifyEmailOtp(idle, formData)).resolves.toMatchObject({ status: "success", redirectTo });
      expect(mocks.verifyOtp).toHaveBeenCalledWith({ email: "user@example.com", token: "123456", type: "email" });
      expect(mocks.findByUserId).toHaveBeenCalledWith("user-a");
    },
  );

  it("does not read onboarding when the token is invalid", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "invalid token" } });
    const formData = new FormData();
    formData.set("email", "user@example.com");
    formData.set("token", "123456");
    await expect(verifyEmailOtp(idle, formData)).resolves.toEqual({
      status: "error",
      message: "验证码错误或已过期，请重新输入或获取新验证码。",
    });
    expect(mocks.findByUserId).not.toHaveBeenCalled();
  });
});
