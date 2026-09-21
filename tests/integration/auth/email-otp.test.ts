import { describe, expect, it, vi } from "vitest";

import { requestEmailOtp, verifyEmailOtpCode } from "@/server/auth/email-otp";

describe("Email 6-digit OTP auth", () => {
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

  it("verifies a six-digit email token and establishes the Supabase session", async () => {
    const verify = vi.fn().mockResolvedValue({ error: null });
    const result = await verifyEmailOtpCode({ email: "user@example.com", token: "123456" }, verify);
    expect(result.status).toBe("success");
    expect(verify).toHaveBeenCalledWith("user@example.com", "123456");
  });

  it("rejects malformed or incorrect codes without reporting success", async () => {
    const verify = vi.fn().mockResolvedValue({ error: { message: "invalid token" } });
    expect((await verifyEmailOtpCode({ email: "user@example.com", token: "12345" }, verify)).status).toBe("error");
    expect(verify).not.toHaveBeenCalled();
    expect((await verifyEmailOtpCode({ email: "user@example.com", token: "123456" }, verify)).status).toBe("error");
  });

  it("preserves the optional email allowlist on send and verify", async () => {
    const call = vi.fn().mockResolvedValue({ error: null });
    expect((await requestEmailOtp({ email: "other@example.com", allowedEmail: "owner@example.com" }, call)).status).toBe("error");
    expect((await verifyEmailOtpCode({ email: "other@example.com", token: "123456", allowedEmail: "owner@example.com" }, call)).status).toBe("error");
    expect(call).not.toHaveBeenCalled();
  });
});
