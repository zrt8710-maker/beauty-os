import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeMagicLink: vi.fn(),
  findByUserId: vi.fn(),
}));

vi.mock("@/env", () => ({
  getPublicEnv: () => ({ NEXT_PUBLIC_APP_URL: "https://beauty.example.com" }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: {} })),
}));
vi.mock("@/server/auth/complete-magic-link", () => ({
  completeMagicLink: mocks.completeMagicLink,
}));
vi.mock("@/server/repositories/profile-repository", () => ({
  createProfileRepository: vi.fn(() => ({
    findByUserId: mocks.findByUserId,
  })),
}));

import { GET } from "@/app/auth/callback/route";

describe("Magic Link callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_ALLOWED_EMAIL", "owner@example.com");
  });

  it.each([
    ["2026-01-01T00:00:00.000Z", "/app"],
    [null, "/profile"],
  ] as const)(
    "routes by onboarding completion after session exchange",
    async (onboardingCompletedAt, destination) => {
      mocks.completeMagicLink.mockResolvedValue({ ok: true, userId: "user-a" });
      mocks.findByUserId.mockResolvedValue({
        onboarding_completed_at: onboardingCompletedAt,
      });

      const response = await GET(
        new Request("http://localhost:3000/auth/callback?code=valid-code"),
      );

      expect(response.headers.get("location")).toBe(
        `https://beauty.example.com${destination}`,
      );
      expect(mocks.findByUserId).toHaveBeenCalledWith("user-a");
    },
  );

  it("returns an expired or invalid code to a readable login error", async () => {
    mocks.completeMagicLink.mockResolvedValue({
      ok: false,
      reason: "invalid_code",
    });

    const response = await GET(
      new Request("http://localhost:3000/auth/callback?code=expired-code"),
    );

    expect(response.headers.get("location")).toBe(
      "https://beauty.example.com/login?error=invalid_code",
    );
    expect(mocks.findByUserId).not.toHaveBeenCalled();
  });
});
