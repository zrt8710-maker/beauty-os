import type { Json } from "@/db/database.types";

export type SetupStatus = {
  profile: boolean;
  city: boolean;
  preferences: boolean;
};

export function getSetupStatus(row: {
  onboarding_completed_at: string | null;
  location_name: string | null;
  latitude: number | null;
  longitude: number | null;
  max_am_steps: number;
  max_pm_steps: number;
  preferences: Json;
} | null): SetupStatus {
  if (!row) return { profile: false, city: false, preferences: false };
  const preferences = row.preferences && typeof row.preferences === "object" && !Array.isArray(row.preferences)
    ? row.preferences
    : {};
  const textures = preferences.texture_preferences;
  return {
    profile: Boolean(row.onboarding_completed_at),
    city: Boolean(row.location_name && row.latitude !== null && row.longitude !== null),
    // Existing customized preferences count as completed; saving defaults now also records completion.
    preferences: Boolean(preferences.care_preferences_saved_at)
      || (Array.isArray(textures) && textures.length > 0)
      || row.max_am_steps !== 4 || row.max_pm_steps !== 5,
  };
}
