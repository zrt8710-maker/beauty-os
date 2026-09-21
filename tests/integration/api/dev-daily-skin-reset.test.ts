import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), getCurrentUser: vi.fn(), createProfileRepository: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/server/auth/get-current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/server/repositories/profile-repository", () => ({ createProfileRepository: mocks.createProfileRepository }));

import { POST } from "@/app/api/dev/daily-skin/reset-today/route";

describe("development Daily Skin reset", () => {
  const eq = vi.fn().mockReturnThis();
  const deleteRows = vi.fn(() => ({ eq }));

  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("NODE_ENV", "development");
    mocks.getCurrentUser.mockResolvedValue({ id: "user-a" });
    mocks.createClient.mockResolvedValue({ from: vi.fn(() => ({ delete: deleteRows })) });
    mocks.createProfileRepository.mockReturnValue({ findByUserId: vi.fn().mockResolvedValue({ timezone: "Asia/Shanghai" }) });
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("deletes only today for the authenticated user", async () => {
    const response = await POST();
    expect(response.status).toBe(200);
    expect(deleteRows).toHaveBeenCalledOnce();
    expect(eq).toHaveBeenNthCalledWith(1, "user_id", "user-a");
    expect(eq).toHaveBeenNthCalledWith(2, "recorded_date", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(eq).not.toHaveBeenCalledWith("recorded_date", "2020-01-01");
  });

  it("requires authentication and is unavailable outside development", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    expect((await POST()).status).toBe(401);
    vi.stubEnv("NODE_ENV", "production");
    expect((await POST()).status).toBe(404);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
