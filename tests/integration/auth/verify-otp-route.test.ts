import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  findByUserId: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url, _key, config) => ({
    auth: {
      verifyOtp: async (input: unknown) => {
        const result = await mocks.verifyOtp(input);
        if (!result.error) {
          config.cookies.setAll([
            { name: "sb-test-auth-token", value: "session-test", options: { path: "/", httpOnly: true } },
          ]);
        }
        return result;
      },
    },
  })),
}));

vi.mock("@/server/repositories/profile-repository", () => ({
  createProfileRepository: vi.fn(() => ({ findByUserId: mocks.findByUserId })),
}));

import { POST } from "@/app/auth/verify-otp/route";

function request(email: string, token: string) {
  return new NextRequest("http://localhost/auth/verify-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, token }),
  });
}

describe("Email OTP verification route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    mocks.verifyOtp.mockResolvedValue({ data: { user: { id: "user-a" } }, error: null });
    mocks.findByUserId.mockResolvedValue(null);
  });

  it("accepts an eight-digit JSON token and returns the onboarding destination", async () => {
    const response = await POST(request("user@example.com", "12345678"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "success", redirectTo: "/profile" });
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ email: "user@example.com", token: "12345678", type: "email" });
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("session-test");
  });

  it("rejects malformed JSON fields before calling Supabase", async () => {
    const response = await POST(request("bad-email", "12345"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "error" });
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });
});
