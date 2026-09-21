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
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  });

  it.each(["GET", "POST"])("login %s never initializes or refreshes a stale session", async (method) => {
    mocks.createServerClient.mockImplementation(() => {
      throw new Error("Login must not wait for Supabase session recovery");
    });
    const response = await updateSession(new NextRequest("http://localhost:3000/login", {
      method,
      headers: { cookie: "sb-example-auth-token=stale-session" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.cookies.getAll()).toEqual([]);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
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

  it("malformed session never crashes the proxy and is treated as unauthenticated", async () => {
    mocks.createServerClient.mockReturnValue({ auth: { getClaims: vi.fn().mockRejectedValue(new TypeError("Cannot read properties of null (reading 'split')")) } });
    const response = await updateSession(new NextRequest("http://localhost:3000/app"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fapp");
  });
});
