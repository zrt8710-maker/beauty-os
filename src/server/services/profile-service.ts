import "server-only";

import type { Json } from "@/db/database.types";
import {
  profileInputSchema,
  profileSchema,
  type LongTermSkinBaseline,
  type Profile,
  type ProfileInput,
} from "@/schemas/profile";
import type {
  ProfileRepository,
  ProfileRow,
  ProfileUpdate,
} from "@/server/repositories/profile-repository";

type StoredPreferences = {
  texture_preferences?: unknown;
};

function readLongTermSkinBaseline(value: Json | undefined): LongTermSkinBaseline {
  return profileInputSchema.shape.long_term_skin_baseline.parse(value);
}

function readTexturePreferences(preferences: Json): unknown[] {
  if (
    typeof preferences !== "object" ||
    preferences === null ||
    Array.isArray(preferences)
  ) {
    return [];
  }

  const stored = preferences as StoredPreferences;
  return Array.isArray(stored.texture_preferences)
    ? stored.texture_preferences
    : [];
}

function toUtcIsoString(value: string): string {
  return new Date(value).toISOString();
}

export function toProfile(row: ProfileRow): Profile {
  return profileSchema.parse({
    skin_type: row.skin_type,
    sensitivity_level: row.sensitivity_level,
    skin_goals: row.goals,
    long_term_skin_baseline: readLongTermSkinBaseline(row.long_term_skin_baseline),
    preferred_routine_length: {
      am_steps: row.max_am_steps,
      pm_steps: row.max_pm_steps,
    },
    texture_preferences: readTexturePreferences(row.preferences),
    avoid_ingredients: row.avoid_ingredients,
    timezone: row.timezone,
    location: {
      name: row.location_name,
      latitude: row.latitude,
      longitude: row.longitude,
    },
    onboarding_completed_at: row.onboarding_completed_at
      ? toUtcIsoString(row.onboarding_completed_at)
      : null,
    updated_at: toUtcIsoString(row.updated_at),
  });
}

function toProfileUpdate(
  input: ProfileInput,
  onboardingCompletedAt: string,
  carePreferencesSavedAt: string | null,
): ProfileUpdate {
  const now = new Date().toISOString();

  return {
    skin_type: input.skin_type,
    sensitivity_level: input.sensitivity_level,
    goals: input.skin_goals,
    long_term_skin_baseline: input.long_term_skin_baseline,
    max_am_steps: input.preferred_routine_length.am_steps,
    max_pm_steps: input.preferred_routine_length.pm_steps,
    preferences: {
      texture_preferences: input.texture_preferences,
      ...(carePreferencesSavedAt ? { care_preferences_saved_at: carePreferencesSavedAt } : {}),
    },
    avoid_ingredients: input.avoid_ingredients,
    timezone: input.timezone,
    location_name: input.location.name,
    latitude: input.location.latitude,
    longitude: input.location.longitude,
    onboarding_completed_at: onboardingCompletedAt,
    updated_at: now,
  };
}

export type ProfileService = {
  getProfile(userId: string): Promise<Profile>;
  updateProfile(userId: string, input: unknown, options?: { markCarePreferencesSaved?: boolean }): Promise<Profile>;
};

export function createProfileService(
  repository: ProfileRepository,
): ProfileService {
  return {
    async getProfile(userId) {
      const existing = await repository.findByUserId(userId);
      const row = existing ?? (await repository.upsertByUserId(userId, {}));
      return toProfile(row);
    },

    async updateProfile(userId, input, options) {
      const validated = profileInputSchema.parse(input);
      const existing = await repository.findByUserId(userId);
      const onboardingCompletedAt =
        existing?.onboarding_completed_at ?? new Date().toISOString();
      const storedPreferences = existing?.preferences;
      const savedAt = storedPreferences && typeof storedPreferences === "object" && !Array.isArray(storedPreferences)
        ? storedPreferences.care_preferences_saved_at
        : null;
      const carePreferencesSavedAt = options?.markCarePreferencesSaved
        ? new Date().toISOString()
        : typeof savedAt === "string" ? savedAt : null;
      const row = await repository.upsertByUserId(
        userId,
        toProfileUpdate(validated, onboardingCompletedAt, carePreferencesSavedAt),
      );
      return toProfile(row);
    },
  };
}
