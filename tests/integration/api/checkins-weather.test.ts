import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WeatherProvider } from "@/server/integrations/weather/provider";
import type { ProfileRepository } from "@/server/repositories/profile-repository";
import type { SkinCheckinRepository } from "@/server/repositories/skin-checkin-repository";
import type { WeatherRepository } from "@/server/repositories/weather-repository";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getCurrentUser: vi.fn(),
  createProfileRepository: vi.fn(),
  createSkinCheckinRepository: vi.fn(),
  createWeatherRepository: vi.fn(),
  createOpenMeteoProvider: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/server/auth/get-current-user", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/server/repositories/profile-repository", () => ({
  createProfileRepository: mocks.createProfileRepository,
}));
vi.mock("@/server/repositories/skin-checkin-repository", () => ({
  createSkinCheckinRepository: mocks.createSkinCheckinRepository,
}));
vi.mock("@/server/repositories/weather-repository", () => ({
  createWeatherRepository: mocks.createWeatherRepository,
}));
vi.mock("@/server/integrations/weather/open-meteo", () => ({
  WeatherProviderError: class WeatherProviderError extends Error {},
  createOpenMeteoProvider: mocks.createOpenMeteoProvider,
}));

import { PATCH as patchCheckin } from "@/app/api/v1/skin-checkins/[id]/route";
import {
  GET as getCheckins,
  POST as postCheckin,
} from "@/app/api/v1/skin-checkins/route";
import { GET as getWeather, POST as postWeather } from "@/app/api/v1/weather/route";

const checkinId = "50000000-0000-4000-8000-000000000001";
const checkinRow = {
  id: checkinId,
  user_id: "user-a",
  dryness_level: 1,
  oiliness_level: 2,
  redness_level: 0,
  sensitivity_level: 1,
  acne_level: 0,
  notes: null,
  recorded_date: "2026-08-18",
  created_at: "2026-08-18T08:00:00.000Z",
};

const weatherRow = {
  id: "60000000-0000-4000-8000-000000000001",
  user_id: "user-a",
  recorded_date: "2026-08-18",
  temperature: 28.4,
  humidity: 71,
  uv_index: 7.2,
  weather_code: "3",
  source: "open_meteo",
  raw_payload: { current: {} },
  created_at: "2026-08-18T08:00:00.000Z",
};

const profileRow = {
  allergies: [],
  avoid_ingredients: [],
  created_at: "2026-08-18T08:00:00.000Z",
  display_name: null,
  goals: [],
  latitude: 31.23,
  locale: "zh-CN",
  location_name: "上海",
  longitude: 121.47,
  max_am_steps: 4,
  max_pm_steps: 5,
  onboarding_completed_at: null,
  preferences: {},
  sensitivity_level: 0,
  skin_type: null,
  timezone: "Asia/Shanghai",
  updated_at: "2026-08-18T08:00:00.000Z",
  user_id: "user-a",
};

describe("skin checkins and weather API", () => {
  let checkins: SkinCheckinRepository;
  let weather: WeatherRepository;
  let profiles: ProfileRepository;
  let provider: WeatherProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    checkins = {
      listByUserId: vi.fn().mockResolvedValue([checkinRow]),
      findById: vi.fn().mockResolvedValue(checkinRow),
      findByDate: vi.fn().mockResolvedValue(checkinRow),
      upsertByDate: vi.fn().mockResolvedValue(checkinRow),
      update: vi.fn().mockResolvedValue(checkinRow),
    };
    weather = {
      findLatestByUserId: vi.fn().mockResolvedValue(weatherRow),
      findByDate: vi.fn().mockResolvedValue(weatherRow),
      upsertByDate: vi.fn().mockResolvedValue(weatherRow),
    };
    profiles = {
      findByUserId: vi.fn().mockResolvedValue(profileRow),
      upsertByUserId: vi.fn().mockResolvedValue(profileRow),
    };
    provider = {
      getCurrentWeather: vi.fn().mockResolvedValue({
        recordedDate: "2026-08-18",
        temperature: 28.4,
        humidity: 71,
        uvIndex: 7.2,
        weatherCode: "3",
        source: "open_meteo",
        rawPayload: { current: {} },
      }),
    };
    mocks.createClient.mockResolvedValue({});
    mocks.getCurrentUser.mockResolvedValue({ id: "user-a", email: "a@example.com" });
    mocks.createSkinCheckinRepository.mockReturnValue(checkins);
    mocks.createWeatherRepository.mockReturnValue(weather);
    mocks.createProfileRepository.mockReturnValue(profiles);
    mocks.createOpenMeteoProvider.mockReturnValue(provider);
  });

  it("用户创建或更新自己的当日 check-in", async () => {
    const response = await postCheckin(
      jsonRequest("http://localhost/api/v1/skin-checkins", "POST", validCheckin()),
    );

    expect(response.status).toBe(200);
    expect(checkins.upsertByDate).toHaveBeenCalledWith(
      "user-a",
      expect.objectContaining({ recorded_date: "2026-08-18" }),
    );
  });

  it("check-in 列表只查询 session 用户", async () => {
    const response = await getCheckins(
      new Request("http://localhost/api/v1/skin-checkins?limit=7&user_id=user-b"),
    );

    expect(response.status).toBe(200);
    expect(checkins.listByUserId).toHaveBeenCalledWith("user-a", { limit: 7 });
    expect(checkins.listByUserId).not.toHaveBeenCalledWith("user-b", expect.anything());
  });

  it("用户不能修改其他用户 check-in", async () => {
    vi.mocked(checkins.findById).mockResolvedValue(null);
    const response = await patchCheckin(
      jsonRequest(`http://localhost/api/v1/skin-checkins/${checkinId}`, "PATCH", {
        dryness_level: 4,
      }),
      routeContext(checkinId),
    );

    expect(response.status).toBe(404);
    expect(checkins.findById).toHaveBeenCalledWith("user-a", checkinId);
    expect(checkins.update).not.toHaveBeenCalled();
  });

  it("等级超出 0..4 时被 Zod 拒绝", async () => {
    const response = await postCheckin(
      jsonRequest("http://localhost/api/v1/skin-checkins", "POST", {
        ...validCheckin(),
        redness_level: 5,
      }),
    );

    expect(response.status).toBe(400);
    expect(checkins.upsertByDate).not.toHaveBeenCalled();
  });

  it("天气读取和写入只使用当前用户身份", async () => {
    const [readResponse, writeResponse] = await Promise.all([
      getWeather(),
      postWeather(jsonRequest("http://localhost/api/v1/weather", "POST", {})),
    ]);

    expect(readResponse.status).toBe(200);
    expect(writeResponse.status).toBe(200);
    expect(weather.findLatestByUserId).toHaveBeenCalledWith("user-a");
    expect(weather.upsertByDate).toHaveBeenCalledWith(
      "user-a",
      expect.objectContaining({ source: "open_meteo" }),
    );
  });

  it("天气接口拒绝客户端 user_id", async () => {
    const response = await postWeather(
      jsonRequest("http://localhost/api/v1/weather", "POST", { user_id: "user-b" }),
    );

    expect(response.status).toBe(400);
    expect(provider.getCurrentWeather).not.toHaveBeenCalled();
    expect(weather.upsertByDate).not.toHaveBeenCalled();
  });

  it("未登录用户不能访问 check-in 或天气接口", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const [checkinRead, checkinWrite, weatherRead, weatherWrite] = await Promise.all([
      getCheckins(new Request("http://localhost/api/v1/skin-checkins")),
      postCheckin(jsonRequest("http://localhost/api/v1/skin-checkins", "POST", validCheckin())),
      getWeather(),
      postWeather(jsonRequest("http://localhost/api/v1/weather", "POST", {})),
    ]);

    expect([checkinRead, checkinWrite, weatherRead, weatherWrite].map((item) => item.status)).toEqual([
      401, 401, 401, 401,
    ]);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

function validCheckin() {
  return {
    dryness_level: 1,
    oiliness_level: 2,
    redness_level: 0,
    sensitivity_level: 1,
    acne_level: 0,
    notes: null,
    recorded_date: "2026-08-18",
  };
}

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
