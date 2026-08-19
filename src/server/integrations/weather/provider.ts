import "server-only";

import type { Json } from "@/db/database.types";

export type WeatherProviderRequest = {
  latitude: number;
  longitude: number;
  timezone: string;
};

export type WeatherObservation = {
  recordedDate: string;
  temperature: number | null;
  humidity: number | null;
  uvIndex: number | null;
  weatherCode: string | null;
  source: string;
  rawPayload: Json;
};

export type WeatherProvider = {
  getCurrentWeather(
    request: WeatherProviderRequest,
  ): Promise<WeatherObservation>;
};
