import { redirect } from "next/navigation";

import { CheckinManager } from "@/features/check-in/checkin-manager";
import { buildSkinHistoryCompression } from "@/features/check-in/skin-history-compression-model";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { getProfileContext } from "@/server/app-shell/app-shell-context";
import { createProfileRepository } from "@/server/repositories/profile-repository";
import { createSkinCheckinRepository } from "@/server/repositories/skin-checkin-repository";
import { createProfileService } from "@/server/services/profile-service";
import { createSkinCheckinService } from "@/server/services/skin-checkin-service";
import { buildRecentSkinTrends } from "@/server/services/recent-skin-trends-service";
import { getReusableDailyNarration, getReusableWeeklyNarration } from "@/server/daily-skin-report/narration-reuse-service";

export default async function CheckinPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  const supabase = await createClient();
  const profiles = createProfileRepository(supabase);
  const checkinService = createSkinCheckinService(
    createSkinCheckinRepository(supabase),
  );
  const [shell, checkins] = await Promise.all([
    getProfileContext(user.id),
    checkinService.listCheckins(user.id, { limit: 30 }),
  ]);
  const profile = shell.profile ?? await createProfileService(profiles).getProfile(user.id);
  const today = formatDateInTimeZone(
    new Date(),
    profile.timezone,
  );
  const query = await searchParams;
  const requestedDate = typeof query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.date)
    ? query.date
    : today;
  const recentTrends = buildRecentSkinTrends(checkins, today);
  const history = buildSkinHistoryCompression({ checkins, profile, recentTrends, today });
  const activeDates = new Set(history.unsettledDaily.map((entry) => entry.date));
  const dailyNarrationEntriesPromise = Promise.all(checkins.filter((checkin) => activeDates.has(checkin.recorded_date) && checkin.daily_state).map(async (checkin) => [checkin.recorded_date, (await getReusableDailyNarration({ today: checkin.daily_state!, profile, recentTrends, mode: "short_history" })).overall_observation] as const));
  const latestWeeklySummary = history.weeklySummaries[0];
  const weeklyNarrationPromise = latestWeeklySummary
    ? getReusableWeeklyNarration({ summary: latestWeeklySummary, profile })
    : Promise.resolve(null);
  const [dailyNarrationEntries, weeklyNarration] = await Promise.all([
    dailyNarrationEntriesPromise,
    weeklyNarrationPromise,
  ]);
  const dailyNarrations = Object.fromEntries(dailyNarrationEntries);
  const narratedDailyHistory = { ...history, unsettledDaily: history.unsettledDaily.map((entry) => ({ ...entry, summary: dailyNarrations[entry.date] ?? entry.summary })) };
  const narratedHistory = weeklyNarration && latestWeeklySummary
    ? { ...narratedDailyHistory, weeklySummaries: [{ ...latestWeeklySummary, overall: weeklyNarration }] }
    : narratedDailyHistory;

  return (
    <main className="beauty-ambient-page beauty-ambient-checkin beauty-page">
      <div className="beauty-page-header">
        <h1 className="beauty-page-title">皮肤日记</h1>
        <p className="beauty-copy mt-3">
          按日期回看状态变化、短期记录与阶段总结。
        </p>
      </div>
      <CheckinManager
        initialCheckins={checkins}
        profile={{ long_term_skin_baseline: profile.long_term_skin_baseline, skin_type: profile.skin_type }}
        recentTrends={recentTrends}
        history={narratedHistory}
        dailyNarrations={dailyNarrations}
        selectedDate={requestedDate}
        today={today}
      />
    </main>
  );
}

function formatDateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
