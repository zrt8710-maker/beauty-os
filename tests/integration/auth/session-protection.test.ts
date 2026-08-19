import type { ResponseCookie } from "next/dist/compiled/@edge-runtime/cookies";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

import { updateSession } from "@/lib/supabase/middleware";

type ServerClientOptions = {
  cookies: {
    setAll: (
      cookies: Array<{
        name: string;
        value: string;
        options?: Partial<ResponseCookie>;
      }>,
    ) => void;
  };
};

describe("Supabase session refresh 与页面保护", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  });

  it("getClaims 刷新 session 时把新 cookie 写回浏览器响应", async () => {
    mocks.createServerClient.mockImplementation(
      (_url: string, _key: string, options: ServerClientOptions) => ({
        auth: {
          getClaims: async () => {
            options.cookies.setAll([
              {
                name: "sb-auth-token",
                value: "refreshed-session",
                options: { httpOnly: true, path: "/" },
              },
            ]);

            return {
              data: { claims: { sub: "user-a" } },
              error: null,
            };
          },
        },
      }),
    );

    const response = await updateSession(
      new NextRequest("http://localhost:3000/app"),
    );

    expect(response.status).toBe(200);
    expect(response.cookies.get("sb-auth-token")?.value).toBe(
      "refreshed-session",
    );
  });

  it("未登录访问受保护 /app 时跳转到登录页", async () => {
    mocks.createServerClient.mockReturnValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({ data: null, error: null }),
      },
    });

    const response = await updateSession(
      new NextRequest("http://localhost:3000/app?tab=today"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fapp%3Ftab%3Dtoday",
    );
  });
});
