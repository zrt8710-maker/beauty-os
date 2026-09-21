import "server-only";

import { z } from "zod";

export type WeatherLocationCandidate = {
  displayName: string;
  region: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  timezone: string;
};

const responseSchema = z.object({
  results: z.array(z.object({
    name: z.string().min(1),
    admin1: z.string().min(1).nullable().optional(),
    country: z.string().min(1).nullable().optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    timezone: z.string().min(1),
  })).optional(),
});

export class WeatherGeocodingError extends Error {
  constructor() {
    super("WEATHER_GEOCODING_FAILED");
    this.name = "WeatherGeocodingError";
  }
}

export type WeatherGeocodingProvider = {
  searchCities(query: string): Promise<WeatherLocationCandidate[]>;
};

export function createOpenMeteoGeocodingProvider(
  fetcher: typeof fetch = fetch,
): WeatherGeocodingProvider {
  return {
    async searchCities(query) {
      const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
      url.searchParams.set("name", query);
      url.searchParams.set("count", "8");
      url.searchParams.set("language", "zh");
      url.searchParams.set("format", "json");
      let response: Response;
      try {
        response = await fetcher(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(8_000),
        });
      } catch {
        throw new WeatherGeocodingError();
      }
      if (!response.ok) throw new WeatherGeocodingError();
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        throw new WeatherGeocodingError();
      }
      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success) throw new WeatherGeocodingError();
      return (parsed.data.results ?? []).map((result) => ({
        displayName: result.name,
        region: result.admin1 ?? null,
        country: result.country ?? null,
        latitude: result.latitude,
        longitude: result.longitude,
        timezone: result.timezone,
      }));
    },
  };
}
