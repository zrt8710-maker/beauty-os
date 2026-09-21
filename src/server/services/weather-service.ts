import "server-only";

import { z } from "zod";

import { weatherDataSchema, weatherRefreshSchema, type WeatherData } from "@/schemas/weather";
import type { WeatherProvider } from "@/server/integrations/weather/provider";
import type { ProfileRepository, ProfileRow } from "@/server/repositories/profile-repository";
import type {
  WeatherRepository,
  WeatherRow,
} from "@/server/repositories/weather-repository";

const databaseIsoTimestampSchema = z.iso.datetime({ offset: true });

export class WeatherLocationRequiredError extends Error {
  constructor() {
    super("WEATHER_LOCATION_REQUIRED");
    this.name = "WeatherLocationRequiredError";
  }
}

function normalizeCreatedAt(value: unknown): string {
  if (typeof value !== "string" || !databaseIsoTimestampSchema.safeParse(value).success) {
    throw new TypeError("weather_data.created_at must be an ISO datetime.");
  }

  return new Date(value).toISOString();
}

export function toWeatherData(row: WeatherRow): WeatherData {
  return weatherDataSchema.parse({
    id: row.id,
    recorded_date: row.recorded_date,
    temperature: row.temperature,
    humidity: row.humidity,
    uv_index: row.uv_index,
    weather_code: row.weather_code,
    source: row.source,
    created_at: normalizeCreatedAt(row.created_at),
  });
}

export type WeatherService = {
  getLatestWeather(userId: string): Promise<WeatherData | null>;
  refreshWeather(userId: string, input: unknown): Promise<WeatherData>;
};

export function createWeatherService(
  weather: WeatherRepository,
  profiles: ProfileRepository,
  provider: WeatherProvider,
): WeatherService {
  return {
    async getLatestWeather(userId) {
      const row = await weather.findLatestByUserId(userId);
      return row ? toWeatherData(row) : null;
    },

    async refreshWeather(userId, input) {
      const profile = await profiles.findByUserId(userId);
      const row = await refreshWeatherForProfile(userId, input, profile, weather, provider);
      return toWeatherData(row);
    },
  };
}

export async function refreshWeatherForProfile(
  userId: string,
  input: unknown,
  profile: ProfileRow | null,
  weather: WeatherRepository,
  provider: WeatherProvider,
): Promise<WeatherRow> {
  weatherRefreshSchema.parse(input);
  if (!profile || profile.latitude === null || profile.longitude === null) {
    throw new WeatherLocationRequiredError();
  }
  const observation = await provider.getCurrentWeather({
    latitude: profile.latitude,
    longitude: profile.longitude,
    timezone: profile.timezone,
  });
  return weather.upsertByDate(userId, {
    recorded_date: observation.recordedDate,
    temperature: observation.temperature,
    humidity: observation.humidity,
    uv_index: observation.uvIndex,
    weather_code: observation.weatherCode,
    source: observation.source,
    raw_payload: observation.rawPayload,
    created_at: new Date().toISOString(),
  });
}
