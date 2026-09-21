import "server-only";

import { LONG_TERM_SKIN_AREAS, type Profile, type RECURRING_TENDENCY_KINDS } from "@/schemas/profile";
import type { DailyStateArea, DailyStateConcernKind, SkinCheckin } from "@/schemas/checkin";
import { createSkinTrendEvidenceService, TREND_WINDOW_DAYS } from "@/server/services/skin-trend-evidence-service";
import { buildDailySkinMetricSnapshot } from "@/domain/skin-grading/daily-skin-metric-snapshot";

type LongTermSkinArea = (typeof LONG_TERM_SKIN_AREAS)[number];
type SuggestibleArea = Exclude<LongTermSkinArea, "full_face">;
type TendencyKind = (typeof RECURRING_TENDENCY_KINDS)[number];

export type SkinProfileSuggestion =
  | { id: string; kind: "add_usual_area"; concern: "oiliness" | "dryness"; area: SuggestibleArea; evidence_summary: string; strength: "moderate" | "strong"; window: { from: string; to: string } }
  | { id: string; kind: "add_recurring_tendency"; concern: TendencyKind; area?: SuggestibleArea; evidence_summary: string; strength: "moderate" | "strong"; window: { from: string; to: string } };

const recurringConcerns: Exclude<TendencyKind, "reactive_discomfort">[] = ["flaking", "redness", "blemishes", "small_bumps", "blackheads", "visible_pores", "dullness", "uneven_tone", "post_blemish_marks"];
const reactiveConcerns: DailyStateConcernKind[] = ["stinging", "itching", "burning"];

/**
 * Read-only suggestion derivation. It takes no persistence dependency and never
 * treats an existing Profile fact as daily evidence.
 */
export function buildSkinProfileSuggestions(profile: Pick<Profile, "long_term_skin_baseline">, checkins: SkinCheckin[], endDate: string): SkinProfileSuggestion[] {
  const evidence = createSkinTrendEvidenceService();
  const suggestions: SkinProfileSuggestion[] = [];

  for (const concern of ["oiliness", "dryness"] as const) {
    const result = evidence.evaluate({ checkins, concern, end_date: endDate });
    for (const area of result.recurring_areas) {
      if (!isLongTermArea(area.area) || profile.long_term_skin_baseline[concern === "oiliness" ? "usual_oily_areas" : "usual_dry_areas"].includes(area.area)) continue;
      if (qualifies(result.window.confirmed_checkin_days, area.present_dates, 3, 14)) suggestions.push({ id: `usual-area:${concern}:${area.area}:${result.window.start_date}:${result.window.end_date}`, kind: "add_usual_area", concern, area: area.area, evidence_summary: `最近28天内，${area.present_dates.length}天记录到${areaLabel(area.area)}${concern === "oiliness" ? "出油" : "发干"}。`, strength: strength(result.window.confirmed_checkin_days, area.present_dates.length), window: { from: result.window.start_date, to: result.window.end_date } });
    }
  }

  for (const concern of recurringConcerns) {
    if (profile.long_term_skin_baseline.recurring_tendencies.some((item) => item.kind === concern)) continue;
    const result = evidence.evaluate({ checkins, concern, end_date: endDate });
    if (!qualifies(result.window.confirmed_checkin_days, result.concern.present_days, 5, 21)) continue;
    const area = result.recurring_areas.find((item): item is typeof item & { area: SuggestibleArea } => isLongTermArea(item.area) && item.present_dates.length >= 5)?.area;
    suggestions.push(recurringSuggestion(concern, area, result.concern.present_days, result.window.confirmed_checkin_days, result.window.start_date, result.window.end_date));
  }

  if (!profile.long_term_skin_baseline.recurring_tendencies.some((item) => item.kind === "reactive_discomfort")) {
    const result = reactiveDiscomfortEvidence(checkins, endDate);
    if (qualifies(result.confirmed_days, result.present_dates, 5, 21)) suggestions.push(recurringSuggestion("reactive_discomfort", result.area, result.present_dates, result.confirmed_days, result.window.from, result.window.to));
  }
  return suggestions;
}

function recurringSuggestion(concern: TendencyKind, area: SuggestibleArea | undefined, dates: string[], confirmedDays: number, from: string, to: string): SkinProfileSuggestion { return { id: `recurring:${concern}:${area ?? "unspecified"}:${from}:${to}`, kind: "add_recurring_tendency", concern, ...(area ? { area } : {}), evidence_summary: `最近28天内，${dates.length}天记录到${area ? `${areaLabel(area)}的` : ""}${tendencyLabel(concern)}。`, strength: strength(confirmedDays, dates.length), window: { from, to } }; }
function reactiveDiscomfortEvidence(checkins: SkinCheckin[], endDate: string) { const from = isoDate(addDays(dateAtUtcMidnight(endDate), -(TREND_WINDOW_DAYS - 1))); const inWindow = checkins.filter((item) => item.recorded_date >= from && item.recorded_date <= endDate); const confirmed = inWindow.filter(isConfirmed); const datesByArea = new Map<SuggestibleArea, Set<string>>(); const presentDates = new Set<string>(); for (const checkin of confirmed) for (const metric of buildDailySkinMetricSnapshot(checkin).metrics) { if (!reactiveConcerns.includes(metric.concern) || metric.daily_status !== "present" || metric.grade_status !== "graded") continue; presentDates.add(checkin.recorded_date); if (metric.area && isLongTermArea(metric.area)) { const dates = datesByArea.get(metric.area) ?? new Set<string>(); dates.add(checkin.recorded_date); datesByArea.set(metric.area, dates); } } const area = [...datesByArea.entries()].find(([, dates]) => dates.size >= 5)?.[0]; return { confirmed_days: confirmed.length, present_dates: [...presentDates].sort(), area, window: { from, to: endDate } }; }
function qualifies(confirmedDays: number, dates: string[], minDates: number, minSpanDays: number) { return confirmedDays >= (minDates === 3 ? 7 : 14) && dates.length >= minDates && spanDays(dates) >= minSpanDays; }
function strength(confirmedDays: number, presentDays: number): "moderate" | "strong" { return confirmedDays >= 21 && presentDays >= 7 ? "strong" : "moderate"; }
function isLongTermArea(area: Exclude<DailyStateArea, "full_face">): area is SuggestibleArea { return (LONG_TERM_SKIN_AREAS as readonly string[]).includes(area); }
function isConfirmed(checkin: SkinCheckin) { return checkin.known_fields.length > 0 || checkin.daily_state !== null; }
function spanDays(dates: string[]) { if (dates.length < 2) return 0; const times = dates.map((date) => dateAtUtcMidnight(date).getTime()); return Math.round((Math.max(...times) - Math.min(...times)) / 86_400_000); }
function dateAtUtcMidnight(value: string) { return new Date(`${value}T00:00:00.000Z`); }
function addDays(value: Date, days: number) { const next = new Date(value); next.setUTCDate(next.getUTCDate() + days); return next; }
function isoDate(value: Date) { return value.toISOString().slice(0, 10); }
function areaLabel(area: LongTermSkinArea) { return ({ t_zone: "T区", forehead: "额头", nose: "鼻子", nose_wings: "鼻翼", cheeks: "脸颊", chin: "下巴", full_face: "全脸" } as Record<LongTermSkinArea, string>)[area]; }
function tendencyLabel(concern: TendencyKind) { return ({ flaking: "起皮", redness: "泛红", reactive_discomfort: "刺痛、发痒或灼热等不适", blemishes: "痘痘", small_bumps: "小凸起", blackheads: "黑头", visible_pores: "毛孔明显", dullness: "暗沉", uneven_tone: "肤色不均", post_blemish_marks: "痘印或残留印记" } as Record<TendencyKind, string>)[concern]; }
