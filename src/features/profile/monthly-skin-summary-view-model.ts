import type { Profile } from "@/schemas/profile";
import type { WeeklySkinSummary, WeeklySkinSummaryItem } from "@/features/profile/weekly-skin-summary-view-model";
import { buildDailySkinMetricSnapshot, type DailySkinMetric } from "@/domain/skin-grading/daily-skin-metric-snapshot";
import type { DailyStateArea, SkinCheckin } from "@/schemas/checkin";

export type MonthlySkinSummary = {
  period: { start: string; end: string };
  overall: string;
  recurring_patterns: WeeklySkinSummaryItem[];
  improved_patterns: WeeklySkinSummaryItem[];
  worsened_patterns: WeeklySkinSummaryItem[];
  emerging_patterns: WeeklySkinSummaryItem[];
  stable_patterns: WeeklySkinSummaryItem[];
};

/** Read-only month-level compression of already-derived weekly summaries. */
export function buildMonthlySkinSummary(input: { month: string; weeklySummaries: WeeklySkinSummary[]; checkins?: SkinCheckin[]; profile: Pick<Profile, "long_term_skin_baseline"> }): MonthlySkinSummary {
  const period = monthPeriod(input.month);
  const worsened_patterns = merge(input.weeklySummaries.flatMap((summary) => summary.worsened), "本月出现更明显的记录。");
  const improved_patterns = merge(input.weeklySummaries.flatMap((summary) => summary.improved), "本月有缓解记录。");
  const stable_patterns = merge(input.weeklySummaries.flatMap((summary) => summary.stable), "本月多数周接近日常状态。");
  const emergingFromWeeks = merge(input.weeklySummaries.flatMap((summary) => summary.new_or_emerging), "本月仍处于新出现或继续观察阶段。");
  const emerging_patterns = emergingFromWeeks.length ? emergingFromWeeks : emergingFromDaily(input.checkins ?? []);
  const recurring_patterns = mergeRecurring(input.weeklySummaries, new Set([...worsened_patterns, ...improved_patterns, ...stable_patterns].map((item) => item.key)));
  const parts = [
    worsened_patterns.length ? `${worsened_patterns.map((item) => item.label).join("、")}有更明显的周内记录` : null,
    improved_patterns.length ? `${improved_patterns.map((item) => item.label).join("、")}有缓解记录` : null,
    stable_patterns.length ? `${stable_patterns.map((item) => item.label).join("、")}大多接近日常状态` : null,
    emerging_patterns.length ? `${emerging_patterns.map((item) => item.label).join("、")}仍需继续观察` : null,
  ].filter((item): item is string => Boolean(item));
  const confirmedDays = new Set((input.checkins ?? []).filter((checkin) => checkin.daily_state !== null || checkin.known_fields.length > 0).map((checkin) => checkin.recorded_date)).size;
  const sparseOverall = emerging_patterns.length ? `本月只有 ${confirmedDays} 条已确认记录；${emerging_patterns.map((item) => item.label).join("、")}仍是新出现的观察，暂不足以形成稳定的月度模式。` : `本月只有 ${confirmedDays} 条已确认记录，暂不足以形成稳定的月度模式。`;
  return { period, overall: parts.length && input.weeklySummaries.length ? `本月的周总结显示，${parts.slice(0, 3).join("；")}。` : confirmedDays ? sparseOverall : "本月没有足够的已确认记录用于月度总结。", recurring_patterns, improved_patterns, worsened_patterns, emerging_patterns, stable_patterns };
}

function merge(items: WeeklySkinSummaryItem[], fallback: string) {
  const groups = new Map<string, WeeklySkinSummaryItem[]>();
  for (const item of items) groups.set(item.key, [...(groups.get(item.key) ?? []), item]);
  return [...groups.values()].map((group) => ({ key: group[0].key, label: group[0].label, statement: group.length > 1 ? `本月有 ${group.length} 个周总结提到这一项。` : fallback })).slice(0, 3);
}

function mergeRecurring(weeks: WeeklySkinSummary[], excluded: Set<string>) {
  const occurrences = new Map<string, WeeklySkinSummaryItem[]>();
  for (const week of weeks) for (const item of [...week.worsened, ...week.improved, ...week.stable, ...week.new_or_emerging]) occurrences.set(item.key, [...(occurrences.get(item.key) ?? []), item]);
  return [...occurrences.values()].filter((items) => items.length >= 2 && !excluded.has(items[0].key)).map((items) => ({ key: items[0].key, label: items[0].label, statement: `本月有 ${items.length} 个周总结出现这一项，作为反复状态继续留意。` })).slice(0, 3);
}

const concernLabels = { oiliness: "出油", dryness: "发干", flaking: "起皮", roughness: "粗糙", redness: "泛红", stinging: "刺痛", itching: "发痒", burning: "灼热", blemishes: "痘痘", small_bumps: "小凸起", blackheads: "黑头", visible_pores: "毛孔明显", uneven_tone: "肤色不均", dullness: "暗沉", post_blemish_marks: "痘印或残留印记" } as const;
const areaLabels: Partial<Record<DailyStateArea, string>> = { t_zone: "T 区", forehead: "额头", hairline: "发际线", nose: "鼻子", nose_wings: "鼻翼", cheeks: "脸颊", chin: "下巴", eye_area: "眼周", other: "局部" };
function emergingFromDaily(checkins: SkinCheckin[]) { const metrics = checkins.flatMap((checkin) => buildDailySkinMetricSnapshot(checkin).metrics).filter((metric) => metric.daily_status === "present" && metric.evidence_origin === "user_raised" && metric.baseline_comparison === "new"); const unique = new Map<string, DailySkinMetric>(); for (const metric of metrics) unique.set(keyFor(metric), metric); return [...unique.values()].slice(0, 3).map((metric) => ({ key: keyFor(metric), label: labelFor(metric), statement: "本月出现过这一新变化，目前仍需继续观察。" })); }
function keyFor(metric: DailySkinMetric) { return `${metric.concern}:${metric.area ?? "unspecified"}`; }
function labelFor(metric: DailySkinMetric) { const area = metric.area; return `${area ? `${areaLabels[area]} · ` : ""}${concernLabels[metric.concern]}`; }

function monthPeriod(month: string) { const start = `${month}-01`; const date = new Date(`${start}T00:00:00.000Z`); date.setUTCMonth(date.getUTCMonth() + 1); date.setUTCDate(0); return { start, end: date.toISOString().slice(0, 10) }; }
