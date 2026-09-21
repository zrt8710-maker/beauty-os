import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("@/server/auth/get-current-user", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

import {
  AdminRequiredError,
  UnauthorizedError,
  requireAdmin,
} from "@/server/auth/require-admin";

describe("requireAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws UnauthorizedError when there is no authenticated user", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const error = await captureError(requireAdmin());

    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error).toMatchObject({
      name: "UnauthorizedError",
      message: "UNAUTHORIZED",
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("throws AdminRequiredError for an authenticated ordinary user", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      id: "user-a",
      email: "user@example.com",
      appRole: "user",
    });

    const error = await captureError(requireAdmin());

    expect(error).toBeInstanceOf(AdminRequiredError);
    expect(error).toMatchObject({
      name: "AdminRequiredError",
      message: "ADMIN_REQUIRED",
      code: "ADMIN_REQUIRED",
      status: 403,
    });
  });

  it("returns the trusted current user for an admin", async () => {
    const admin = {
      id: "admin-a",
      email: "admin@example.com",
      appRole: "admin" as const,
    };
    mocks.getCurrentUser.mockResolvedValue(admin);

    await expect(requireAdmin()).resolves.toBe(admin);
  });
});

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the promise to reject.");
}
