import type { RecentSkinTrend } from "@/domain/recent-skin-trend";
import { buildDailySkinMetricSnapshot, type DailySkinMetric } from "@/domain/skin-grading/daily-skin-metric-snapshot";
import type { DailyStateArea, SkinCheckin } from "@/schemas/checkin";
import type { Profile } from "@/schemas/profile";

export type WeeklySkinSummaryItem = { key: string; label: string; statement: string };
export type WeeklySkinSummary = {
  period: { start: string; end: string };
  recorded_count: number;
  recorded_dates: string[];
  overall: string;
  worsened: WeeklySkinSummaryItem[];
  improved: WeeklySkinSummaryItem[];
  stable: WeeklySkinSummaryItem[];
  new_or_emerging: WeeklySkinSummaryItem[];
  repeated_observations: WeeklySkinSummaryItem[];
  ungraded_observation_count: number;
  has_recent_trends: boolean;
  next_week_watch: string[];
};

const concernLabels = { oiliness: "出油", dryness: "发干", flaking: "起皮", roughness: "粗糙", redness: "泛红", stinging: "刺痛", itching: "发痒", burning: "灼热", blemishes: "痘痘", small_bumps: "小凸起", blackheads: "黑头", visible_pores: "毛孔明显", uneven_tone: "肤色不均", dullness: "暗沉", post_blemish_marks: "痘印或残留印记" } as const;
const areaLabels: Partial<Record<DailyStateArea, string>> = { t_zone: "T 区", forehead: "额头", hairline: "发际线", nose: "鼻子", nose_wings: "鼻翼", cheeks: "脸颊", chin: "下巴", eye_area: "眼周", other: "局部" };

/** A read-only fixed-record-batch view. It classifies only confirmed cross-day observations. */
export function buildWeeklySkinSummary(input: { checkins: SkinCheckin[]; profile: Pick<Profile, "long_term_skin_baseline">; recentTrends: RecentSkinTrend[]; endDate: string }): WeeklySkinSummary {
  const checkins = [...input.checkins].sort((left, right) => left.recorded_date.localeCompare(right.recorded_date));
  const period = { start: checkins[0]?.recorded_date ?? input.endDate, end: checkins.at(-1)?.recorded_date ?? input.endDate };
  const groups = new Map<string, DailySkinMetric[]>();
  const allMetrics = checkins.flatMap((checkin) => buildDailySkinMetricSnapshot(checkin).metrics);
  const metrics = allMetrics.filter(isComparableMetric);
  for (const metric of metrics) groups.set(keyFor(metric), [...(groups.get(keyFor(metric)) ?? []), metric]);
  const worsened: WeeklySkinSummaryItem[] = [];
  const improved: WeeklySkinSummaryItem[] = [];
  const stable: WeeklySkinSummaryItem[] = [];
  const new_or_emerging: WeeklySkinSummaryItem[] = [];
  for (const [key, observations] of groups) {
    const first = observations[0]; const last = observations.at(-1)!; const label = labelFor(last);
    if (observations.length >= 2 && last.grade! > first.grade!) { worsened.push({ key, label, statement: `与本周较早的记录相比更明显，已在 ${observations.length} 个记录日确认。` }); continue; }
    if (observations.length >= 2 && last.grade! < first.grade!) { improved.push({ key, label, statement: "相比本周较早的记录有所缓解。" }); continue; }
    if (observations.length >= 2 && !hasFluctuation(observations) && hasProfileBaseline(last, input.profile) && observations.every((item) => item.baseline_comparison === "usual")) { stable.push({ key, label, statement: `本周 ${observations.length} 个记录日都接近日常状态。` }); continue; }
    if (observations.length <= 2 && observations.some((item) => item.evidence_origin === "user_raised" && item.baseline_comparison === "new")) new_or_emerging.push({ key, label, statement: observations.length === 1 ? "本周首次出现，目前还不足以判断是否会持续。" : `本周在 ${observations.length} 个记录日出现，暂时还不足以判断是否形成持续趋势。` });
  }
  const summary = { period, worsened: worsened.slice(0, 3), improved: improved.slice(0, 3), stable: stable.slice(0, 3), new_or_emerging: new_or_emerging.slice(0, 3) };
  const repeated_observations = [...groups.entries()].filter(([, observations]) => observations.length >= 2).map(([key, observations]) => ({ key, label: labelFor(observations.at(-1)!), statement: `这一组记录中出现了 ${observations.length} 次。` })).slice(0, 6);
  return { ...summary, recorded_count: checkins.length, recorded_dates: checkins.map((checkin) => checkin.recorded_date), repeated_observations, ungraded_observation_count: allMetrics.length - metrics.length, has_recent_trends: input.recentTrends.length > 0, overall: buildWeeklyFallbackText(summary, checkins.length), next_week_watch: [...summary.worsened, ...summary.new_or_emerging].slice(0, 2).map((item) => `留意${item.label}下周是否仍持续出现或继续加重。`) };
}

function isComparableMetric(metric: DailySkinMetric): metric is DailySkinMetric & { area: Exclude<DailyStateArea, "full_face">; grade: NonNullable<DailySkinMetric["grade"]>; grade_status: "graded" } { return metric.grade_status === "graded" && metric.grade !== null && metric.area !== null; }
function keyFor(metric: DailySkinMetric) { return `${metric.concern}:${metric.area ?? "unspecified"}`; }
function labelFor(metric: DailySkinMetric) { return `${metric.area ? `${areaLabels[metric.area]} · ` : ""}${concernLabels[metric.concern]}`; }
function hasFluctuation(metrics: DailySkinMetric[]) { return new Set(metrics.map((metric) => metric.grade)).size > 1; }
function hasProfileBaseline(metric: DailySkinMetric, profile: Pick<Profile, "long_term_skin_baseline">) { const area = metric.area; if (!area || !isProfileArea(area)) return false; const baseline = profile.long_term_skin_baseline; if (metric.concern === "oiliness") return baseline.usual_oily_areas.includes(area); if (metric.concern === "dryness") return baseline.usual_dry_areas.includes(area); return baseline.recurring_tendencies.some((item) => item.kind === metric.concern && (item.usual_areas.length === 0 || item.usual_areas.includes(area))); }
type ProfileArea = Extract<Exclude<DailyStateArea, "full_face">, Profile["long_term_skin_baseline"]["usual_oily_areas"][number]>;
function isProfileArea(area: Exclude<DailyStateArea, "full_face">): area is ProfileArea { return area === "t_zone" || area === "forehead" || area === "nose" || area === "nose_wings" || area === "cheeks" || area === "chin"; }
/** Emergency-only fallback. AI narration is the normal user-facing path. */
function buildWeeklyFallbackText(summary: Pick<WeeklySkinSummary, "worsened" | "improved" | "stable" | "new_or_emerging">, count: number) { if (summary.worsened.length) return `这一组记录中有些变化比平时更明显，先留意它们之后是否连续出现。`; if (summary.stable.length) return "这一组记录整体比较稳定，多数状态仍接近平时水平，可以先维持当前护理节奏。"; if (summary.improved.length) return "这一组记录中有些状态较早些时候有所缓解，可以继续观察后续变化。"; return count ? "这一组记录整体比较平稳，没有看到持续加重的变化，之后继续留意是否出现连续趋势。" : "这一组暂时还没有可用于总结的皮肤记录。"; }
