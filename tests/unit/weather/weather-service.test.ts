import { describe, expect, it, vi } from "vitest";

import type { WeatherProvider } from "@/server/integrations/weather/provider";
import type { ProfileRepository } from "@/server/repositories/profile-repository";
import type { WeatherRepository } from "@/server/repositories/weather-repository";
import {
  WeatherLocationRequiredError,
  createWeatherService,
} from "@/server/services/weather-service";

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

describe("WeatherService", () => {
  it("从当前用户 profile 读取位置并保存原始天气快照", async () => {
    const weather = createWeatherRepository();
    const profiles = createProfileRepository();
    const provider = createProvider();
    const service = createWeatherService(weather, profiles, provider);

    const result = await service.refreshWeather("user-a", {});

    expect(profiles.findByUserId).toHaveBeenCalledWith("user-a");
    expect(provider.getCurrentWeather).toHaveBeenCalledWith({
      latitude: 31.23,
      longitude: 121.47,
      timezone: "Asia/Shanghai",
    });
    expect(weather.upsertByDate).toHaveBeenCalledWith(
      "user-a",
      expect.objectContaining({
        recorded_date: "2026-08-18",
        raw_payload: { current: {} },
      }),
    );
    expect(result.temperature).toBe(28.4);
  });

  it("档案没有坐标时不调用天气服务", async () => {
    const weather = createWeatherRepository();
    const profiles = createProfileRepository();
    vi.mocked(profiles.findByUserId).mockResolvedValue({
      ...profileRow,
      latitude: null,
      longitude: null,
    });
    const provider = createProvider();
    const service = createWeatherService(weather, profiles, provider);

    await expect(service.refreshWeather("user-a", {})).rejects.toEqual(
      new WeatherLocationRequiredError(),
    );
    expect(provider.getCurrentWeather).not.toHaveBeenCalled();
    expect(weather.upsertByDate).not.toHaveBeenCalled();
  });
});

function createProfileRepository(): ProfileRepository {
  return {
    findByUserId: vi.fn().mockResolvedValue(profileRow),
    upsertByUserId: vi.fn().mockResolvedValue(profileRow),
  };
}

function createWeatherRepository(): WeatherRepository {
  return {
    findLatestByUserId: vi.fn().mockResolvedValue(weatherRow),
    findByDate: vi.fn().mockResolvedValue(weatherRow),
    upsertByDate: vi.fn().mockResolvedValue(weatherRow),
  };
}

function createProvider(): WeatherProvider {
  return {
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
}
