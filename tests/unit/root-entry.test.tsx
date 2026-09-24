import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth/get-current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));

import HomePage from "@/app/page";

describe("root entry", () => {
  beforeEach(() => mocks.getCurrentUser.mockReset());

  it("opens the app when a valid session already exists", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user-a", appRole: "user" });
    await expect(HomePage()).rejects.toThrow("redirect:/app");
  });

  it("shows login only when no valid session exists", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(HomePage()).rejects.toThrow("redirect:/login");
  });
});
