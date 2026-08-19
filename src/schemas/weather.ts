import { z } from "zod";

export const WEATHER_SOURCE = "open_meteo";

export const weatherRefreshSchema = z.object({}).strict();

export const weatherDataSchema = z.object({
  id: z.uuid(),
  recorded_date: z.iso.date(),
  temperature: z.number().min(-100).max(100).nullable(),
  humidity: z.number().min(0).max(100).nullable(),
  uv_index: z.number().min(0).max(30).nullable(),
  weather_code: z.string().min(1).max(50).nullable(),
  source: z.string().min(1).max(50),
  created_at: z.iso.datetime(),
});

export type WeatherData = z.infer<typeof weatherDataSchema>;
