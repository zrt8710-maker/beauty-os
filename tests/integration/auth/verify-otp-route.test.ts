import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  findByUserId: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { verifyOtp: mocks.verifyOtp } })),
}));

vi.mock("@/server/repositories/profile-repository", () => ({
  createProfileRepository: vi.fn(() => ({ findByUserId: mocks.findByUserId })),
}));

import { POST } from "@/app/auth/verify-otp/route";

function request(email: string, token: string) {
  return new Request("http://localhost/auth/verify-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, token }),
  });
}

describe("Email OTP verification route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyOtp.mockResolvedValue({ data: { user: { id: "user-a" } }, error: null });
    mocks.findByUserId.mockResolvedValue(null);
  });

  it("accepts an eight-digit JSON token and returns the onboarding destination", async () => {
    const response = await POST(request("user@example.com", "12345678"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "success", redirectTo: "/profile" });
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ email: "user@example.com", token: "12345678", type: "email" });
  });

  it("rejects malformed JSON fields before calling Supabase", async () => {
    const response = await POST(request("bad-email", "12345"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "error" });
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
  });
});
