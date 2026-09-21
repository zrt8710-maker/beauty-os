import { describe, expect, it, vi } from "vitest";

import type { WeatherProvider } from "@/server/integrations/weather/provider";
import type { ProfileRepository } from "@/server/repositories/profile-repository";
import type { WeatherRepository, WeatherRow } from "@/server/repositories/weather-repository";
import { getOrRefreshTodayWeather } from "@/server/services/today-weather-service";

const userId = "user-a";
const profile: { user_id: string; timezone: string; latitude: number | null; longitude: number | null } = {
  user_id: userId,
  timezone: "Asia/Shanghai",
  latitude: 31.23,
  longitude: 121.47,
};

describe("getOrRefreshTodayWeather", () => {
  it("returns an existing row for the profile-local day without calling the provider", async () => {
    const weather = weatherRepository([weatherRow("2026-09-11")]);
    const provider = providerMock("2026-09-11");

    await expect(getOrRefreshTodayWeather({ userId, profiles: profileRepository(profile), weather, provider, now: () => new Date("2026-09-11T12:00:00.000Z") })).resolves.toMatchObject({ recorded_date: "2026-09-11" });

    expect(weather.findByDate).toHaveBeenCalledWith(userId, "2026-09-11");
    expect(weather.findLatestByUserId).not.toHaveBeenCalled();
    expect(weather.upsertByDate).not.toHaveBeenCalled();
    expect(provider.getCurrentWeather).not.toHaveBeenCalled();
  });

  it("rolls from 09-11 to a missing 09-12 row instead of reusing yesterday", async () => {
    const weather = weatherRepository([weatherRow("2026-09-11")]);
    const provider = providerMock("2026-09-12");

    const result = await getOrRefreshTodayWeather({ userId, profiles: profileRepository(profile), weather, provider, now: () => new Date("2026-09-12T12:00:00.000Z") });

    expect(result).toMatchObject({ recorded_date: "2026-09-12" });
    expect(weather.findByDate).toHaveBeenCalledWith(userId, "2026-09-12");
    expect(weather.findByDate).not.toHaveBeenCalledWith(userId, "2026-09-11");
    expect(weather.findLatestByUserId).not.toHaveBeenCalled();
    expect(provider.getCurrentWeather).toHaveBeenCalledOnce();
    expect(weather.upsertByDate).toHaveBeenCalledWith(userId, expect.objectContaining({ recorded_date: "2026-09-12" }));
  });

  it("creates 09-13 when earlier daily rows already exist", async () => {
    const weather = weatherRepository([weatherRow("2026-09-11"), weatherRow("2026-09-12")]);
    const provider = providerMock("2026-09-13");

    const result = await getOrRefreshTodayWeather({ userId, profiles: profileRepository(profile), weather, provider, now: () => new Date("2026-09-13T12:00:00.000Z") });

    expect(result).toMatchObject({ recorded_date: "2026-09-13" });
    expect(weather.findByDate).toHaveBeenCalledWith(userId, "2026-09-13");
    expect(weather.findLatestByUserId).not.toHaveBeenCalled();
    expect(provider.getCurrentWeather).toHaveBeenCalledOnce();
    expect(weather.upsertByDate).toHaveBeenCalledWith(userId, expect.objectContaining({ recorded_date: "2026-09-13" }));
  });

  it("reuses a supplied profile and returns the refresh write without duplicate reads", async () => {
    const profiles = profileRepository(profile);
    const suppliedProfile = await profiles.findByUserId(userId);
    vi.mocked(profiles.findByUserId).mockClear();
    const weather = weatherRepository([]);
    const provider = providerMock("2026-09-13");

    const result = await getOrRefreshTodayWeather({
      userId,
      profiles,
      profile: suppliedProfile,
      weather,
      provider,
      now: () => new Date("2026-09-13T12:00:00.000Z"),
    });

    expect(result).toMatchObject({ recorded_date: "2026-09-13" });
    expect(profiles.findByUserId).not.toHaveBeenCalled();
    expect(weather.findByDate).toHaveBeenCalledTimes(1);
    expect(weather.upsertByDate).toHaveBeenCalledTimes(1);
  });

  it("uses Asia/Shanghai's date after local midnight even while UTC is still the previous day", async () => {
    const weather = weatherRepository([weatherRow("2026-09-12")]);
    const provider = providerMock("2026-09-12");

    await expect(getOrRefreshTodayWeather({ userId, profiles: profileRepository(profile), weather, provider, now: () => new Date("2026-09-11T16:30:00.000Z") })).resolves.toMatchObject({ recorded_date: "2026-09-12" });

    expect(weather.findByDate).toHaveBeenCalledWith(userId, "2026-09-12");
    expect(weather.findByDate).not.toHaveBeenCalledWith(userId, "2026-09-11");
    expect(provider.getCurrentWeather).not.toHaveBeenCalled();
  });

  it("does not fall back to yesterday after a provider failure and retries on the next visit", async () => {
    const weather = weatherRepository([weatherRow("2026-09-11")]);
    const provider: WeatherProvider = { getCurrentWeather: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(observation("2026-09-12")) };
    const input = { userId, profiles: profileRepository(profile), weather, provider, now: () => new Date("2026-09-12T12:00:00.000Z") };

    await expect(getOrRefreshTodayWeather(input)).resolves.toBeNull();
    expect(weather.upsertByDate).not.toHaveBeenCalled();

    await expect(getOrRefreshTodayWeather(input)).resolves.toMatchObject({ recorded_date: "2026-09-12" });
    expect(provider.getCurrentWeather).toHaveBeenCalledTimes(2);
    expect(weather.findLatestByUserId).not.toHaveBeenCalled();
    expect(weather.upsertByDate).toHaveBeenCalledWith(userId, expect.objectContaining({ recorded_date: "2026-09-12" }));
  });

  it("does not call the provider when location is missing", async () => {
    const weather = weatherRepository([]);
    const provider = providerMock("2026-09-12");

    await expect(getOrRefreshTodayWeather({ userId, profiles: profileRepository({ ...profile, latitude: null, longitude: null }), weather, provider })).resolves.toBeNull();

    expect(provider.getCurrentWeather).not.toHaveBeenCalled();
  });
});

function profileRepository(value: typeof profile): ProfileRepository {
  return {
    findByUserId: vi.fn().mockResolvedValue({ allergies: [], avoid_ingredients: [], created_at: "2026-01-01T00:00:00Z", display_name: null, goals: [], locale: "zh-CN", location_name: "上海", max_am_steps: 4, max_pm_steps: 5, onboarding_completed_at: null, preferences: {}, sensitivity_level: 0, skin_type: null, updated_at: "2026-01-01T00:00:00Z", long_term_skin_baseline: {}, ...value }),
    upsertByUserId: vi.fn(),
  } as ProfileRepository;
}

function weatherRepository(initialRows: WeatherRow[]): WeatherRepository {
  const rows = new Map(initialRows.map((row) => [row.recorded_date, row]));
  return {
    findLatestByUserId: vi.fn().mockImplementation(async () => [...rows.values()].sort((left, right) => right.recorded_date.localeCompare(left.recorded_date))[0] ?? null),
    findByDate: vi.fn().mockImplementation(async (_userId: string, date: string) => rows.get(date) ?? null),
    upsertByDate: vi.fn().mockImplementation(async (ownerId: string, input) => {
      const next = { ...weatherRow(input.recorded_date), ...input, user_id: ownerId };
      rows.set(input.recorded_date, next);
      return next;
    }),
  };
}

function weatherRow(recordedDate: string): WeatherRow {
  return { id: "60000000-0000-4000-8000-000000000001", user_id: userId, recorded_date: recordedDate, temperature: 28, humidity: 71, uv_index: 7, weather_code: "2", source: "open_meteo", raw_payload: {}, created_at: "2026-09-11T00:00:00.000Z" };
}

function observation(recordedDate: string) {
  return { recordedDate, temperature: 28, humidity: 71, uvIndex: 7, weatherCode: "2", source: "open_meteo", rawPayload: {} };
}

function providerMock(recordedDate: string): WeatherProvider {
  return { getCurrentWeather: vi.fn().mockResolvedValue(observation(recordedDate)) };
}
