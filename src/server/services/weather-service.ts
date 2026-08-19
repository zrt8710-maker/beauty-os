import "server-only";

import { weatherDataSchema, weatherRefreshSchema, type WeatherData } from "@/schemas/weather";
import type { WeatherProvider } from "@/server/integrations/weather/provider";
import type { ProfileRepository } from "@/server/repositories/profile-repository";
import type {
  WeatherRepository,
  WeatherRow,
} from "@/server/repositories/weather-repository";

export class WeatherLocationRequiredError extends Error {
  constructor() {
    super("WEATHER_LOCATION_REQUIRED");
    this.name = "WeatherLocationRequiredError";
  }
}

function toWeatherData(row: WeatherRow): WeatherData {
  return weatherDataSchema.parse({
    id: row.id,
    recorded_date: row.recorded_date,
    temperature: row.temperature,
    humidity: row.humidity,
    uv_index: row.uv_index,
    weather_code: row.weather_code,
    source: row.source,
    created_at: row.created_at,
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
      weatherRefreshSchema.parse(input);
      const profile = await profiles.findByUserId(userId);

      if (
        !profile ||
        profile.latitude === null ||
        profile.longitude === null
      ) {
        throw new WeatherLocationRequiredError();
      }

      const observation = await provider.getCurrentWeather({
        latitude: profile.latitude,
        longitude: profile.longitude,
        timezone: profile.timezone,
      });
      const row = await weather.upsertByDate(userId, {
        recorded_date: observation.recordedDate,
        temperature: observation.temperature,
        humidity: observation.humidity,
        uv_index: observation.uvIndex,
        weather_code: observation.weatherCode,
        source: observation.source,
        raw_payload: observation.rawPayload,
        created_at: new Date().toISOString(),
      });

      return toWeatherData(row);
    },
  };
}
