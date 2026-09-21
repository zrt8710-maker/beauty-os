import "server-only";

import type { WeatherProvider } from "@/server/integrations/weather/provider";
import type { ProfileRepository, ProfileRow } from "@/server/repositories/profile-repository";
import type { WeatherRepository, WeatherRow } from "@/server/repositories/weather-repository";
import { refreshWeatherForProfile } from "@/server/services/weather-service";
import { weatherDateInTimeZone } from "@/server/weather/weather-date";

export async function getOrRefreshTodayWeather({
  userId,
  profiles,
  weather,
  provider,
  profile: suppliedProfile,
  now = () => new Date(),
}: {
  userId: string;
  profiles: ProfileRepository;
  weather: WeatherRepository;
  provider: WeatherProvider;
  profile?: ProfileRow | null;
  now?: () => Date;
}): Promise<WeatherRow | null> {
  try {
    const profile = suppliedProfile === undefined
      ? await profiles.findByUserId(userId)
      : suppliedProfile;
    if (!profile) return null;
    const recordedDate = weatherDateInTimeZone(now(), profile.timezone);
    const existing = await weather.findByDate(userId, recordedDate);
    if (existing) return existing;
    if (profile.latitude === null || profile.longitude === null) return null;

    return await refreshWeatherForProfile(userId, {}, profile, weather, provider);
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : null;
    console.error("[weather] today snapshot unavailable", {
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : "Unknown weather refresh failure",
      causeName: cause?.name,
      causeMessage: cause?.message,
    });
    return null;
  }
}
