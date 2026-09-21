import "server-only";

import { weatherLocationCandidateSchema, weatherLocationSearchSchema } from "@/schemas/weather-location";
import type { WeatherGeocodingProvider, WeatherLocationCandidate } from "@/server/integrations/weather/geocoding";
import type { WeatherProvider } from "@/server/integrations/weather/provider";
import type { ProfileRepository } from "@/server/repositories/profile-repository";
import type { WeatherRepository, WeatherRow } from "@/server/repositories/weather-repository";
import { createWeatherService } from "@/server/services/weather-service";
import { weatherDateInTimeZone } from "@/server/weather/weather-date";

export function createWeatherLocationService({
  geocoding,
  profiles,
  weather,
  provider,
  now = () => new Date(),
}: {
  geocoding: WeatherGeocodingProvider;
  profiles: ProfileRepository;
  weather: WeatherRepository;
  provider: WeatherProvider;
  now?: () => Date;
}) {
  return {
    async search(input: unknown): Promise<WeatherLocationCandidate[]> {
      const { query } = weatherLocationSearchSchema.parse(input);
      return geocoding.searchCities(query);
    },

    async saveAndRefresh(userId: string, input: unknown): Promise<WeatherRow> {
      const candidate = weatherLocationCandidateSchema.parse(input);
      const previousProfile = await profiles.findByUserId(userId);
      await profiles.upsertByUserId(userId, {
        location_name: candidate.displayName,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        timezone: candidate.timezone,
      });
      // A daily weather row has no location columns. Invalidate the old and
      // new local-day keys before refresh so a provider failure cannot display
      // the previous city's snapshot under the newly saved city name.
      await weather.deleteByDates?.(userId, [
        ...(previousProfile ? [weatherDateInTimeZone(now(), previousProfile.timezone)] : []),
        weatherDateInTimeZone(now(), candidate.timezone),
      ]);
      const refreshed = await createWeatherService(weather, profiles, provider)
        .refreshWeather(userId, {});
      const row = await weather.findByDate(userId, refreshed.recorded_date);
      if (!row) throw new Error("WEATHER_WRITE_FAILED");
      return row;
    },
  };
}
