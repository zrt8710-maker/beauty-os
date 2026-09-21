import { beforeEach, describe, expect, it, vi } from "vitest";

const redirects = {
  login: new Error("REDIRECT_LOGIN"),
  notFound: new Error("NOT_FOUND"),
};

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}));

vi.mock("@/server/auth/require-admin", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/auth/require-admin")
  >();
  return { ...actual, requireAdmin: mocks.requireAdmin };
});

import {
  AdminRequiredError,
  UnauthorizedError,
} from "@/server/auth/require-admin";
import { requireAdminPageAccess } from "@/server/admin/require-admin-page-access";

describe("requireAdminPageAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation(() => {
      throw redirects.login;
    });
    mocks.notFound.mockImplementation(() => {
      throw redirects.notFound;
    });
  });

  it("redirects an unauthenticated visitor to login", async () => {
    mocks.requireAdmin.mockRejectedValue(new UnauthorizedError());

    await expect(requireAdminPageAccess()).rejects.toBe(redirects.login);
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("serves not-found to an authenticated non-admin", async () => {
    mocks.requireAdmin.mockRejectedValue(new AdminRequiredError());

    await expect(requireAdminPageAccess()).rejects.toBe(redirects.notFound);
    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("returns the trusted admin context", async () => {
    const admin = {
      id: "admin-a",
      email: "admin@example.com",
      appRole: "admin" as const,
    };
    mocks.requireAdmin.mockResolvedValue(admin);

    await expect(requireAdminPageAccess()).resolves.toBe(admin);
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
