import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getAuthConfig: vi.fn(),
}));

vi.mock("react", () => ({
  cache: (callback: unknown) => callback,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/server/auth/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/config")>();
  return {
    ...actual,
    getAuthConfig: mocks.getAuthConfig,
  };
});

import { getCurrentUser } from "@/server/auth/get-current-user";

const getClaims = vi.fn();

describe("getCurrentUser admin identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthConfig.mockReturnValue({ allowedEmail: undefined });
    mocks.createClient.mockResolvedValue({ auth: { getClaims } });
  });

  it("reads admin only from signed app_metadata.app_role", async () => {
    setClaims({ app_metadata: { app_role: "admin" } });

    await expect(getCurrentUser()).resolves.toEqual({
      id: "user-a",
      email: "owner@example.com",
      appRole: "admin",
    });
  });

  it("ignores an admin claim in user_metadata", async () => {
    setClaims({ user_metadata: { app_role: "admin" } });

    await expect(getCurrentUser()).resolves.toMatchObject({
      id: "user-a",
      appRole: "user",
    });
  });

  it("defaults a missing app_metadata or app_role to user", async () => {
    setClaims();
    await expect(getCurrentUser()).resolves.toMatchObject({ appRole: "user" });

    setClaims({ app_metadata: {} });
    await expect(getCurrentUser()).resolves.toMatchObject({ appRole: "user" });
  });

  it("defaults every unsupported app_role value to user", async () => {
    for (const appRole of ["staff", "ADMIN", "admin ", true, 1, null]) {
      setClaims({ app_metadata: { app_role: appRole } });
      await expect(getCurrentUser()).resolves.toMatchObject({ appRole: "user" });
    }
  });

  it("keeps AUTH_ALLOWED_EMAIL as a login allowlist, not an admin role", async () => {
    mocks.getAuthConfig.mockReturnValue({
      allowedEmail: "owner@example.com",
    });
    setClaims();

    await expect(getCurrentUser()).resolves.toEqual({
      id: "user-a",
      email: "owner@example.com",
      appRole: "user",
    });

    setClaims({ email: "other@example.com" });
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("returns null when the signed claims do not contain a subject", async () => {
    getClaims.mockResolvedValue({
      data: {
        claims: {
          email: "owner@example.com",
          app_metadata: { app_role: "admin" },
        },
      },
      error: null,
    });

    await expect(getCurrentUser()).resolves.toBeNull();
  });
});

function setClaims(
  overrides: Record<string, unknown> = {},
) {
  getClaims.mockResolvedValue({
    data: {
      claims: {
        sub: "user-a",
        email: "owner@example.com",
        ...overrides,
      },
    },
    error: null,
  });
}
