import type { RecentSkinTrend } from "@/domain/recent-skin-trend";
import { buildDailyFallbackNarration } from "@/features/check-in/daily-skin-narration-fallback";
import { buildMonthlySkinSummary, type MonthlySkinSummary } from "@/features/profile/monthly-skin-summary-view-model";
import { buildWeeklySkinSummary, type WeeklySkinSummary } from "@/features/profile/weekly-skin-summary-view-model";
import type { SkinCheckin } from "@/schemas/checkin";
import type { Profile } from "@/schemas/profile";

export type SkinHistoryCompression = { unsettledDaily: Array<{ date: string; summary: string }>; weeklySummaries: WeeklySkinSummary[]; monthlySummaries: MonthlySkinSummary[] };

/** UI-only hierarchy: seven daily summaries → weekly summaries → monthly summaries. */
export function buildSkinHistoryCompression(input: { checkins: SkinCheckin[]; profile: Pick<Profile, "long_term_skin_baseline" | "skin_type">; recentTrends: RecentSkinTrend[]; today: string }): SkinHistoryCompression {
  const currentMonth = input.today.slice(0, 7);
  const dailyRecords = [...input.checkins].filter(isDailySummaryRecord).sort((left, right) => left.recorded_date.localeCompare(right.recorded_date));
  const completeBatches = Array.from({ length: Math.floor(dailyRecords.length / 7) }, (_, index) => dailyRecords.slice(index * 7, index * 7 + 7));
  // A completed batch remains the active window until a subsequent record starts
  // the next batch. This is presentation state only; no check-in is consumed.
  const activeBatchStart = dailyRecords.length ? Math.floor((dailyRecords.length - 1) / 7) * 7 : 0;
  const unsettledDaily = dailyRecords.slice(activeBatchStart, activeBatchStart + 7).map((checkin) => ({ date: checkin.recorded_date, summary: buildDailyFallbackNarration(checkin) })).reverse();
  const allWeeks = completeBatches.map((batch) => ({ ...buildWeeklySkinSummary({ checkins: batch, profile: input.profile, recentTrends: input.recentTrends, endDate: batch.at(-1)!.recorded_date }), period: { start: batch[0].recorded_date, end: batch.at(-1)!.recorded_date } }));
  // The check-in UI intentionally shows only the latest completed summary, but
  // it must not disappear merely because its final record is in a prior month.
  const weeklySummaries = allWeeks.length ? [allWeeks.at(-1)!] : [];
  const months = [...new Set(allWeeks.map((summary) => summary.period.end.slice(0, 7)).filter((month) => month < currentMonth))].sort((left, right) => right.localeCompare(left));
  const monthlySummaries = months.map((month) => buildMonthlySkinSummary({ month, weeklySummaries: allWeeks.filter((summary) => summary.period.end.slice(0, 7) === month), checkins: dailyRecords.filter((checkin) => checkin.recorded_date.startsWith(month)), profile: input.profile }));
  return { unsettledDaily, weeklySummaries, monthlySummaries };
}

function isDailySummaryRecord(checkin: SkinCheckin) { return checkin.daily_state?.version === 2; }
