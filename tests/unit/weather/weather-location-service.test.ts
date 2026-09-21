import { describe, expect, it, vi } from "vitest";

import type { WeatherProvider } from "@/server/integrations/weather/provider";
import type { ProfileRepository } from "@/server/repositories/profile-repository";
import type { WeatherRepository } from "@/server/repositories/weather-repository";
import { createWeatherLocationService } from "@/server/services/weather-location-service";

describe("weather location service", () => {
  it("saves the selected candidate, then refreshes weather", async () => {
    const candidate = { displayName: "上海", region: "上海市", country: "中国", latitude: 31.23, longitude: 121.47, timezone: "Asia/Shanghai" };
    const savedProfile = { user_id: "user-a", location_name: "上海", latitude: 31.23, longitude: 121.47, timezone: "Asia/Shanghai" };
    const previousProfile = { ...savedProfile, location_name: "旧金山", latitude: 37.77, longitude: -122.42, timezone: "America/Los_Angeles" };
    let currentProfile = previousProfile;
    const profiles = {
      findByUserId: vi.fn().mockImplementation(async () => currentProfile),
      upsertByUserId: vi.fn().mockImplementation(async () => { currentProfile = savedProfile; return savedProfile; }),
    } as ProfileRepository;
    const weatherRow = { id: "60000000-0000-4000-8000-000000000001", user_id: "user-a", recorded_date: "2026-09-05", temperature: 28, humidity: 70, uv_index: 7, weather_code: "2", source: "open_meteo", raw_payload: {}, created_at: "2026-09-05T01:00:00.000Z" };
    const weather = { findLatestByUserId: vi.fn(), findByDate: vi.fn().mockResolvedValue(weatherRow), upsertByDate: vi.fn().mockResolvedValue(weatherRow), deleteByDates: vi.fn().mockResolvedValue(undefined) } as WeatherRepository;
    const provider = { getCurrentWeather: vi.fn().mockResolvedValue({ recordedDate: "2026-09-05", temperature: 28, humidity: 70, uvIndex: 7, weatherCode: "2", source: "open_meteo", rawPayload: {} }) } as WeatherProvider;
    const service = createWeatherLocationService({ geocoding: { searchCities: vi.fn() }, profiles, weather, provider, now: () => new Date("2026-09-05T01:00:00.000Z") });

    await expect(service.saveAndRefresh("user-a", candidate)).resolves.toEqual(weatherRow);
    expect(profiles.upsertByUserId).toHaveBeenCalledWith("user-a", { location_name: "上海", latitude: 31.23, longitude: 121.47, timezone: "Asia/Shanghai" });
    expect(weather.deleteByDates).toHaveBeenCalledWith("user-a", ["2026-09-04", "2026-09-05"]);
    expect(provider.getCurrentWeather).toHaveBeenCalledWith({ latitude: 31.23, longitude: 121.47, timezone: "Asia/Shanghai" });
    expect(vi.mocked(weather.deleteByDates!).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(provider.getCurrentWeather).mock.invocationCallOrder[0]!);
  });

  it("invalidates the old location's daily snapshot even when the new weather refresh fails", async () => {
    const candidate = { displayName: "成都", region: "四川", country: "中国", latitude: 30.67, longitude: 104.07, timezone: "Asia/Shanghai" };
    const profile = { user_id: "user-a", location_name: "上海", latitude: 31.23, longitude: 121.47, timezone: "Asia/Shanghai" };
    const profiles = { findByUserId: vi.fn().mockResolvedValue(profile), upsertByUserId: vi.fn().mockResolvedValue(profile) } as ProfileRepository;
    const weather = { findLatestByUserId: vi.fn(), findByDate: vi.fn(), upsertByDate: vi.fn(), deleteByDates: vi.fn().mockResolvedValue(undefined) } as WeatherRepository;
    const provider = { getCurrentWeather: vi.fn().mockRejectedValue(new Error("offline")) } as WeatherProvider;
    const service = createWeatherLocationService({ geocoding: { searchCities: vi.fn() }, profiles, weather, provider, now: () => new Date("2026-09-05T01:00:00.000Z") });

    await expect(service.saveAndRefresh("user-a", candidate)).rejects.toThrow("offline");
    expect(weather.deleteByDates).toHaveBeenCalledWith("user-a", ["2026-09-05", "2026-09-05"]);
    expect(weather.upsertByDate).not.toHaveBeenCalled();
  });
});
