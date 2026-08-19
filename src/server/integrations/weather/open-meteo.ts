import "server-only";

import { z } from "zod";

import type { Json } from "@/db/database.types";
import { WEATHER_SOURCE } from "@/schemas/weather";
import type { WeatherProvider } from "@/server/integrations/weather/provider";

const jsonValueSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const openMeteoResponseSchema = z.object({
  current: z.object({
    temperature_2m: z.number(),
    relative_humidity_2m: z.number().min(0).max(100),
    weather_code: z.number().int(),
  }),
  daily: z.object({
    time: z.array(z.iso.date()).min(1),
    uv_index_max: z.array(z.number().min(0).max(30).nullable()).min(1),
  }),
});

export class WeatherProviderError extends Error {
  constructor() {
    super("WEATHER_PROVIDER_FAILED");
    this.name = "WeatherProviderError";
  }
}

export function createOpenMeteoProvider(
  fetcher: typeof fetch = fetch,
): WeatherProvider {
  return {
    async getCurrentWeather(request) {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.searchParams.set("latitude", String(request.latitude));
      url.searchParams.set("longitude", String(request.longitude));
      url.searchParams.set(
        "current",
        "temperature_2m,relative_humidity_2m,weather_code",
      );
      url.searchParams.set("daily", "uv_index_max");
      url.searchParams.set("timezone", request.timezone);
      url.searchParams.set("forecast_days", "1");

      let response: Response;

      try {
        response = await fetcher(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(8_000),
        });
      } catch {
        throw new WeatherProviderError();
      }

      if (!response.ok) {
        throw new WeatherProviderError();
      }

      let raw: unknown;

      try {
        raw = await response.json();
      } catch {
        throw new WeatherProviderError();
      }

      const parsed = openMeteoResponseSchema.safeParse(raw);
      const rawPayload = jsonValueSchema.safeParse(raw);

      if (!parsed.success || !rawPayload.success) {
        throw new WeatherProviderError();
      }

      return {
        recordedDate: parsed.data.daily.time[0],
        temperature: parsed.data.current.temperature_2m,
        humidity: parsed.data.current.relative_humidity_2m,
        uvIndex: parsed.data.daily.uv_index_max[0],
        weatherCode: String(parsed.data.current.weather_code),
        source: WEATHER_SOURCE,
        rawPayload: rawPayload.data,
      };
    },
  };
}
