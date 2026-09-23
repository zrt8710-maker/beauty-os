import { describe, expect, it, vi } from "vitest";

import { requestEmailOtp, verifyEmailOtpCode } from "@/server/auth/email-otp";

describe("Email OTP auth", () => {
  it("normalizes an email and sends the same OTP request for new or existing users", async () => {
    const send = vi.fn().mockResolvedValue({ error: null });
    const result = await requestEmailOtp({ email: " User@Example.com " }, send);
    expect(result.status).toBe("success");
    expect(send).toHaveBeenCalledWith("user@example.com");
  });

  it("supports resend through the same guarded request path", async () => {
    const send = vi.fn().mockResolvedValue({ error: null });
    await requestEmailOtp({ email: "user@example.com" }, send);
    await requestEmailOtp({ email: "user@example.com" }, send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("maps the Supabase send rate limit to readable copy", async () => {
    const send = vi.fn().mockResolvedValue({
      error: {
        message: "rate limited",
        status: 429,
        code: "over_email_send_rate_limit",
      },
    });
    await expect(
      requestEmailOtp({ email: "user@example.com" }, send),
    ).resolves.toEqual({
      status: "error",
      message: "发送过于频繁，请稍后再试。",
    });
  });

  it("verifies a six-digit email token and establishes the Supabase session", async () => {
    const verify = vi.fn().mockResolvedValue({ error: null });
    const result = await verifyEmailOtpCode({ email: "user@example.com", token: "123456" }, verify);
    expect(result.status).toBe("success");
    expect(verify).toHaveBeenCalledWith("user@example.com", "123456");
  });

  it("accepts an eight-digit token from the hosted Supabase project", async () => {
    const verify = vi.fn().mockResolvedValue({ error: null });
    const result = await verifyEmailOtpCode({ email: "user@example.com", token: "12345678" }, verify);
    expect(result.status).toBe("success");
    expect(verify).toHaveBeenCalledWith("user@example.com", "12345678");
  });

  it("rejects malformed or incorrect codes without reporting success", async () => {
    const verify = vi.fn().mockResolvedValue({ error: { message: "invalid token" } });
    expect((await verifyEmailOtpCode({ email: "user@example.com", token: "12345" }, verify)).status).toBe("error");
    expect(verify).not.toHaveBeenCalled();
    expect((await verifyEmailOtpCode({ email: "user@example.com", token: "123456" }, verify)).status).toBe("error");
  });

  it("shows a readable network error during verification", async () => {
    const verify = vi.fn().mockResolvedValue({
      error: { message: "fetch failed", code: "network_error" },
    });
    await expect(
      verifyEmailOtpCode(
        { email: "user@example.com", token: "123456" },
        verify,
      ),
    ).resolves.toEqual({
      status: "error",
      message: "网络连接失败，请稍后重试。",
    });
  });

  it("preserves the optional email allowlist on send and verify", async () => {
    const call = vi.fn().mockResolvedValue({ error: null });
    expect((await requestEmailOtp({ email: "other@example.com", allowedEmail: "owner@example.com" }, call)).status).toBe("error");
    expect((await verifyEmailOtpCode({ email: "other@example.com", token: "123456", allowedEmail: "owner@example.com" }, call)).status).toBe("error");
    expect(call).not.toHaveBeenCalled();
  });
});
