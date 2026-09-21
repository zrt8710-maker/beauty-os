import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { createOpenMeteoProvider } from "@/server/integrations/weather/open-meteo";
import { createProfileRepository } from "@/server/repositories/profile-repository";
import { createWeatherRepository } from "@/server/repositories/weather-repository";
import { getOrRefreshTodayWeather } from "@/server/services/today-weather-service";
import { toProfile } from "@/server/services/profile-service";

/** Request-scoped profile data for pages that do not consume weather. */
export const getProfileContext = cache(async (userId: string) => {
  const supabase = await createClient();
  const profiles = createProfileRepository(supabase);
  const profileRow = await profiles.findByUserId(userId);
  return { profile: profileRow ? toProfile(profileRow) : null, profileRow };
});

/** Request-scoped shared data for the protected layout and weather consumers. */
export const getAppShellContext = cache(async (userId: string) => {
  const { profile, profileRow } = await getProfileContext(userId);
  const supabase = await createClient();
  const profiles = createProfileRepository(supabase);
  const weather = await getOrRefreshTodayWeather({
    userId,
    profiles,
    profile: profileRow,
    weather: createWeatherRepository(supabase),
    provider: createOpenMeteoProvider(),
  });
  return { profile, profileRow, weather };
});
