import { z } from "zod";

import { weatherLocationCandidateSchema } from "@/schemas/weather-location";

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

export type LocationCandidate = z.infer<typeof weatherLocationCandidateSchema>;

/** Only used when the authenticated EdgeOne geocoding request returns 502. */
export async function searchCitiesFromBrowser(query: string, fetcher: typeof fetch = fetch): Promise<LocationCandidate[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "8");
  url.searchParams.set("language", "zh");
  url.searchParams.set("format", "json");
  const response = await fetcher(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error("WEATHER_GEOCODING_BROWSER_FAILED");
  const parsed = responseSchema.parse(await response.json());
  return (parsed.results ?? []).map((result) => weatherLocationCandidateSchema.parse({
    displayName: result.name,
    region: result.admin1 ?? null,
    country: result.country ?? null,
    latitude: result.latitude,
    longitude: result.longitude,
    timezone: result.timezone,
  }));
}
