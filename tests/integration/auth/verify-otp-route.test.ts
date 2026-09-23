import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  findByUserId: vi.fn(),
  writeCookie: true,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url, _key, config) => ({
    auth: {
      verifyOtp: async (input: unknown) => {
        const result = await mocks.verifyOtp(input);
        if (!result.error && result.data?.session && mocks.writeCookie) {
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
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email, token }),
  });
}

describe("Email OTP verification route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writeCookie = true;
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    mocks.verifyOtp.mockResolvedValue({ data: { user: { id: "user-a" }, session: { access_token: "access", refresh_token: "refresh" } }, error: null });
    mocks.findByUserId.mockResolvedValue(null);
  });

  it("accepts an eight-digit form token and redirects with the session cookie", async () => {
    const response = await POST(request("user@example.com", "12345678"));
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("http://localhost/profile");
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ email: "user@example.com", token: "12345678", type: "email" });
    expect(response.cookies.get("sb-test-auth-token")?.value).toBe("session-test");
    expect(response.headers.get("X-Auth-Cookie-Writes")).toBe("1");
  });

  it("rejects malformed form fields before calling Supabase", async () => {
    const response = await POST(request("bad-email", "12345"));
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("http://localhost/login?error=invalid_otp");
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("does not claim login succeeded when Supabase returns no session", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { user: { id: "user-a" }, session: null }, error: null });
    const response = await POST(request("user@example.com", "12345678"));
    expect(response.headers.get("Location")).toBe("http://localhost/login?error=otp_session");
    expect(response.cookies.getAll()).toHaveLength(0);
  });

  it("does not claim login succeeded when no session cookie is written", async () => {
    mocks.writeCookie = false;
    const response = await POST(request("user@example.com", "12345678"));
    expect(response.headers.get("Location")).toBe("http://localhost/login?error=otp_session");
    expect(response.cookies.getAll()).toHaveLength(0);
  });
});
