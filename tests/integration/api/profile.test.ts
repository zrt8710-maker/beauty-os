import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProfileRepository } from "@/server/repositories/profile-repository";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getCurrentUser: vi.fn(),
  createProfileRepository: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/server/auth/get-current-user", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/server/repositories/profile-repository", () => ({
  createProfileRepository: mocks.createProfileRepository,
}));

import { GET, PUT } from "@/app/api/v1/profile/route";

const baseRow = {
  allergies: [],
  avoid_ingredients: ["fragrance"],
  created_at: "2026-08-18T08:00:00.000Z",
  display_name: null,
  goals: ["hydration", "barrier_support"],
  latitude: 31.2304,
  locale: "zh-CN",
  location_name: "上海",
  longitude: 121.4737,
  max_am_steps: 4,
  max_pm_steps: 5,
  onboarding_completed_at: "2026-08-18T08:00:00+00:00",
  preferences: { texture_preferences: ["lightweight"] },
  sensitivity_level: 2,
  skin_type: "combination",
  timezone: "Asia/Shanghai",
  updated_at: "2026-08-18T08:00:00+00:00",
  user_id: "user-a",
  long_term_skin_baseline: { usual_oily_areas: ["t_zone"], usual_dry_areas: [], recurring_tendencies: [{ kind: "blackheads", usual_areas: ["nose"], tendency: "recurring", frequency: "recurring", usual_intensity: "moderate", source: "user_declared" }] },
};

const validInput = {
  skin_type: "combination",
  sensitivity_level: 2,
  skin_goals: ["hydration", "barrier_support"],
  long_term_skin_baseline: { usual_oily_areas: ["t_zone"], usual_dry_areas: [], recurring_tendencies: [{ kind: "blackheads", usual_areas: ["nose"], tendency: "recurring", frequency: "recurring", usual_intensity: "very_marked", source: "user_declared" }] },
  preferred_routine_length: { am_steps: 4, pm_steps: 5 },
  texture_preferences: ["lightweight"],
  avoid_ingredients: ["fragrance"],
  timezone: "Asia/Shanghai",
  location: {
    name: "上海",
    latitude: 31.2304,
    longitude: 121.4737,
  },
};

function createRepository(): ProfileRepository {
  return {
    findByUserId: vi.fn().mockResolvedValue(baseRow),
    upsertByUserId: vi.fn().mockResolvedValue(baseRow),
  };
}

describe("GET/PUT /api/v1/profile", () => {
  let repository: ProfileRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = createRepository();
    mocks.createClient.mockResolvedValue({});
    mocks.getCurrentUser.mockResolvedValue({
      id: "user-a",
      email: "a@example.com",
    });
    mocks.createProfileRepository.mockReturnValue(repository);
  });

  it("用户可以读取自己的 profile", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(repository.findByUserId).toHaveBeenCalledWith("user-a");
    expect(body.data.skin_type).toBe("combination");
    expect(body.data.onboarding_completed_at).toBe(
      "2026-08-18T08:00:00.000Z",
    );
    expect(body.data.updated_at).toBe("2026-08-18T08:00:00.000Z");
    expect(body.data).not.toHaveProperty("user_id");
    expect(body.data.long_term_skin_baseline).toEqual({ usual_oily_areas: ["t_zone"], usual_dry_areas: [], recurring_tendencies: [{ kind: "blackheads", usual_areas: ["nose"], tendency: "recurring", frequency: "recurring", usual_intensity: "noticeable", source: "user_declared" }] });
  });

  it("用户可以修改自己的 profile", async () => {
    const response = await PUT(
      new Request("http://localhost/api/v1/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validInput),
      }),
    );

    expect(response.status).toBe(200);
    expect(repository.upsertByUserId).toHaveBeenCalledWith(
      "user-a",
      expect.objectContaining({
        skin_type: "combination",
        sensitivity_level: 2,
        goals: ["hydration", "barrier_support"],
        long_term_skin_baseline: validInput.long_term_skin_baseline,
        onboarding_completed_at: "2026-08-18T08:00:00+00:00",
      }),
    );
  });

  it("保存护理偏好时记录完成标记，普通档案保存仍保留该标记", async () => {
    const preferenceRequest = new Request("http://localhost/api/v1/profile?section=care-preferences", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(validInput),
    });
    expect((await PUT(preferenceRequest)).status).toBe(200);
    const preferenceUpdate = vi.mocked(repository.upsertByUserId).mock.calls.at(-1)?.[1];
    expect(preferenceUpdate?.preferences).toEqual(expect.objectContaining({ care_preferences_saved_at: expect.any(String) }));

    vi.mocked(repository.findByUserId).mockResolvedValue({
      ...baseRow,
      preferences: { texture_preferences: [], care_preferences_saved_at: "2026-09-24T00:00:00Z" },
    } as never);
    expect((await PUT(new Request("http://localhost/api/v1/profile", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(validInput),
    }))).status).toBe(200);
    const profileUpdate = vi.mocked(repository.upsertByUserId).mock.calls.at(-1)?.[1];
    expect(profileUpdate?.preferences).toEqual(expect.objectContaining({ care_preferences_saved_at: "2026-09-24T00:00:00Z" }));
  });

  it("用户不能通过 API 指定并读取其他用户 profile", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(repository.findByUserId).toHaveBeenCalledWith("user-a");
    expect(repository.findByUserId).not.toHaveBeenCalledWith("user-b");
  });

  it("用户不能通过请求体修改其他用户 profile", async () => {
    const response = await PUT(
      new Request("http://localhost/api/v1/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validInput, user_id: "user-b" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(repository.upsertByUserId).not.toHaveBeenCalled();
  });

  it("非法数据返回稳定的 Zod validation error", async () => {
    const response = await PUT(
      new Request("http://localhost/api/v1/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validInput, sensitivity_level: 9 }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields.sensitivity_level).toBeDefined();
    expect(repository.upsertByUserId).not.toHaveBeenCalled();
  });

  it("未登录请求不能读取 profile", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
