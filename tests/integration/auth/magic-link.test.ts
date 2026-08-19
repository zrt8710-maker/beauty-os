import { describe, expect, it, vi } from "vitest";

import { completeMagicLink } from "@/server/auth/complete-magic-link";
import { requestMagicLink } from "@/server/auth/request-magic-link";

describe("Email Magic Link 登录", () => {
  it("校验邮箱后请求一次 Magic Link", async () => {
    const send = vi.fn().mockResolvedValue({ error: null });

    const result = await requestMagicLink(
      {
        email: " User@Example.com ",
        redirectTo: "http://localhost:3000/auth/callback",
      },
      send,
    );

    expect(result.status).toBe("success");
    expect(send).toHaveBeenCalledWith({
      email: "user@example.com",
      redirectTo: "http://localhost:3000/auth/callback",
    });
  });

  it("allowlist 拒绝其他邮箱且不调用 Supabase", async () => {
    const send = vi.fn().mockResolvedValue({ error: null });

    const result = await requestMagicLink(
      {
        email: "other@example.com",
        redirectTo: "http://localhost:3000/auth/callback",
        allowedEmail: "owner@example.com",
      },
      send,
    );

    expect(result.status).toBe("error");
    expect(send).not.toHaveBeenCalled();
  });

  it("callback 用授权码建立 session", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    const getClaims = vi.fn().mockResolvedValue({
      data: {
        claims: { sub: "user-a", email: "owner@example.com" },
      },
      error: null,
    });
    const signOut = vi.fn().mockResolvedValue({ error: null });

    const result = await completeMagicLink(
      { auth: { exchangeCodeForSession, getClaims, signOut } },
      "authorization-code",
      "owner@example.com",
    );

    expect(result).toEqual({ ok: true });
    expect(exchangeCodeForSession).toHaveBeenCalledWith("authorization-code");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("callback 发现非 allowlist 身份后立即注销", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
        getClaims: vi.fn().mockResolvedValue({
          data: {
            claims: { sub: "user-b", email: "other@example.com" },
          },
          error: null,
        }),
        signOut,
      },
    };

    const result = await completeMagicLink(
      client,
      "authorization-code",
      "owner@example.com",
    );

    expect(result).toEqual({ ok: false, reason: "not_allowed" });
    expect(signOut).toHaveBeenCalledOnce();
  });
});
