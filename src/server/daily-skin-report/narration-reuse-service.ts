import "server-only";

import { unstable_cache } from "next/cache";

import type { RecentSkinTrend } from "@/domain/recent-skin-trend";
import type { DailyState } from "@/schemas/checkin";
import type { Profile } from "@/schemas/profile";
import {
  generateProfessionalDailyObservation,
  type ProfessionalDailyObservation,
} from "@/server/daily-skin-report/professional-daily-observation-service";
import { createConfiguredVolcengineProfessionalDailyObservationProvider } from "@/server/daily-skin-report/volcengine-professional-daily-observation-provider";
import {
  buildWeeklySkinNarrationFacts,
  narrateWeeklySkinFacts,
  type WeeklySkinNarrationFacts,
} from "@/server/weekly-skin-summary/weekly-skin-narration-service";
import { createConfiguredVolcengineWeeklySkinNarrationProvider } from "@/server/weekly-skin-summary/volcengine-weekly-skin-narration-provider";
import type { WeeklySkinSummary } from "@/features/profile/weekly-skin-summary-view-model";

type DailyNarrationMode = "short_history" | "daily_overview";
type DailyNarrationProfile = Pick<Profile, "skin_type" | "sensitivity_level" | "skin_goals" | "long_term_skin_baseline">;
type DailyNarrationFacts = { mode: DailyNarrationMode; today: DailyState; profile: DailyNarrationProfile; recentTrends: RecentSkinTrend[] };

/**
 * This is deliberately a facts-keyed reuse boundary, not a general cache.
 * `unstable_cache` is Next's persistent Data Cache; a new facts payload gets a
 * new key, so no mutation invalidation or narration persistence is required.
 */
const cachedDailyNarration = unstable_cache(
  async (serializedFacts: string): Promise<ProfessionalDailyObservation> => {
    const facts = JSON.parse(serializedFacts) as DailyNarrationFacts;
    return generateProfessionalDailyObservation(
      createConfiguredVolcengineProfessionalDailyObservationProvider(),
      { today: facts.today, profile: facts.profile, recentTrends: facts.recentTrends, mode: facts.mode },
    );
  },
  ["beauty-os", "daily-narration", "v1"],
  { revalidate: false },
);

const cachedWeeklyNarration = unstable_cache(
  async (serializedFacts: string): Promise<string> => {
    const facts = JSON.parse(serializedFacts) as WeeklySkinNarrationFacts;
    return narrateWeeklySkinFacts(createConfiguredVolcengineWeeklySkinNarrationProvider(), facts);
  },
  ["beauty-os", "weekly-narration", "v1"],
  { revalidate: false },
);

export function getDailyNarrationFacts(input: { today: DailyState; profile: DailyNarrationProfile; recentTrends: RecentSkinTrend[]; mode: DailyNarrationMode }): DailyNarrationFacts {
  return {
    mode: input.mode,
    today: input.today,
    profile: {
      skin_type: input.profile.skin_type,
      sensitivity_level: input.profile.sensitivity_level,
      skin_goals: input.profile.skin_goals,
      long_term_skin_baseline: input.profile.long_term_skin_baseline,
    },
    recentTrends: input.recentTrends,
  };
}

export function dailyNarrationFactsFingerprint(input: { today: DailyState; profile: DailyNarrationProfile; recentTrends: RecentSkinTrend[]; mode: DailyNarrationMode }) {
  return stableSerialize(getDailyNarrationFacts(input));
}

export async function getReusableDailyNarration(input: { today: DailyState; profile: DailyNarrationProfile; recentTrends: RecentSkinTrend[]; mode: DailyNarrationMode }) {
  return cachedDailyNarration(dailyNarrationFactsFingerprint(input));
}

export function weeklyNarrationFactsFingerprint(input: { summary: WeeklySkinSummary; profile: Pick<Profile, "long_term_skin_baseline"> }) {
  return stableSerialize(buildWeeklySkinNarrationFacts(input.summary, input.profile));
}

export async function getReusableWeeklyNarration(input: { summary: WeeklySkinSummary; profile: Pick<Profile, "long_term_skin_baseline"> }) {
  return cachedWeeklyNarration(weeklyNarrationFactsFingerprint(input));
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
