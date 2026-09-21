import "server-only";

import { z } from "zod";
import type { RecentSkinTrend } from "@/domain/recent-skin-trend";
import type { DailyState } from "@/schemas/checkin";
import type { Profile } from "@/schemas/profile";

export type ProfessionalDailyObservation = { overall_observation: string; baseline_comparison: string | null; key_observations: string[] };
export const professionalDailyObservationSchema = z.object({
  overall_observation: z.string().trim().min(1).max(2400),
  baseline_comparison: z.string().trim().min(1).max(1800).nullable(),
  key_observations: z.array(z.string().trim().min(1).max(480)).min(1).max(8),
}).strict();
type ReportProfile = Pick<Profile, "skin_type" | "sensitivity_level" | "skin_goals" | "long_term_skin_baseline">;
export type ProfessionalDailyObservationProvider = { generate(input: { today: DailyState; profile: ReportProfile; recent_trends: RecentSkinTrend[]; presentation_mode?: "short_history" | "daily_overview" }): Promise<ProfessionalDailyObservation> };
export type ProfessionalDailyObservationInput = { today: DailyState; profile: ReportProfile; recentTrends: RecentSkinTrend[]; mode?: "short_history" | "daily_overview" };

export function createProfessionalDailyObservationService(provider: ProfessionalDailyObservationProvider | null) {
  return { async generate(input: ProfessionalDailyObservationInput): Promise<ProfessionalDailyObservation> {
    return generateProfessionalDailyObservation(provider, input);
  } };
}

/** Shared by the direct service and the facts-keyed narration reuse boundary. */
export async function generateProfessionalDailyObservation(provider: ProfessionalDailyObservationProvider | null, input: ProfessionalDailyObservationInput): Promise<ProfessionalDailyObservation> {
  const fallback = fallbackObservation(input.today, input.profile, input.recentTrends);
  if (!provider) return fallback;
  try { return validate(await provider.generate({ today: input.today, profile: input.profile, recent_trends: input.recentTrends, presentation_mode: input.mode ?? "daily_overview" }), input.today); } catch { return fallback; }
}
function fallbackObservation(today: DailyState, profile: ReportProfile, trends: RecentSkinTrend[]): ProfessionalDailyObservation {
  const concerns = today.version === 2 ? today.concerns : [];
  const present = concerns.filter((item) => item.status === "present");
  const reactiveAbsent = concerns.filter((item) => item.status === "absent" && ["stinging", "itching", "burning", "redness"].includes(item.kind));
  const primary = present[0];
  const overall = [
    present.length > 1 ? `今天呈现出分区不完全一致的状态：${present.slice(0, 4).map(concernText).join("；")}。` : (primary ? `今天主要观察到${concernText(primary)}。` : "今天记录到的皮肤感受较有限。"),
    today.summary && !present.length ? today.summary : null,
    reactiveAbsent.length ? `今天没有记录到${reactiveAbsent.map((item) => concernLabel[item.kind]).join("、")}，目前未见主观刺激不适与这些变化同时出现。` : null,
  ].filter(Boolean).join("");
  const baseline = baselineComparison(profile, primary, present, reactiveAbsent);
  const observations = observationBullets(present, trends);
  return { overall_observation: overall, baseline_comparison: baseline, key_observations: observations };
}
function validate(value: ProfessionalDailyObservation, today: DailyState): ProfessionalDailyObservation {
  const canonical = professionalDailyObservationSchema.parse(value);
  const allowed = JSON.stringify(today);
  const unsafe = /屏障受损|缺水性出油|炎症|激素|过敏|产品刺激|敏感肌|诊断/;
  if (unsafe.test(JSON.stringify(canonical)) || !allowed) throw new Error("UNSAFE_REPORT");
  return canonical;
}

const concernLabel: Record<string, string> = { oiliness: "出油", dryness: "干燥", flaking: "起皮", roughness: "粗糙", redness: "泛红", stinging: "刺痛", itching: "发痒", burning: "灼热", blemishes: "新痘", small_bumps: "小凸起", blackheads: "黑头", visible_pores: "毛孔明显", uneven_tone: "肤色不均", dullness: "暗沉", post_blemish_marks: "痘印或残留印记" };
const areaLabel: Record<string, string> = { t_zone: "T区", forehead: "额头", hairline: "发际线", nose: "鼻子", nose_wings: "鼻翼", cheeks: "脸颊", chin: "下巴", eye_area: "眼周", full_face: "全脸", other: "局部" };
const skinTypeLabel: Record<NonNullable<Profile["skin_type"]>, string> = { dry: "偏干", oily: "偏油", combination: "混合", normal: "中性", unknown: "未明确" };
const sensitivityLabel = ["较低", "轻度", "中等", "较高", "较高"];
const goalLabel: Record<Profile["skin_goals"][number], string> = { hydration: "补水", barrier_support: "维稳", oil_control: "控油", blemish_care: "痘痘护理", redness_relief: "泛红舒缓", brightening: "提亮", dark_spots: "淡化色沉", anti_aging: "抗老" };

function concernText(concern: Extract<DailyState, { version: 2 }>['concerns'][number]) {
  const timing = concern.attributes.duration === "part_day" ? "在一天中的部分时段更明显的" : "";
  const severity = concern.attributes.severity === "slight" ? "轻微" : concern.attributes.severity === "moderate" ? "较明显" : concern.attributes.severity === "marked" ? "明显" : "";
  return `${concern.areas.map((area) => areaLabel[area]).join("、")}${timing}${severity}${concernLabel[concern.kind]}`;
}

function baselineComparison(profile: ReportProfile, primary: Extract<DailyState, { version: 2 }>['concerns'][number] | undefined, present: Extract<DailyState, { version: 2 }>['concerns'], reactiveAbsent: Extract<DailyState, { version: 2 }>['concerns']) {
  const sentences: string[] = [];
  for (const concern of present) {
    const comparison = concern.attributes.baseline_comparison;
    if (comparison === "usual") sentences.push(`${concernText(concern)}与平时记录的状态基本一致。`);
    if (comparison === "more_than_usual") sentences.push(`${concernText(concern)}比平时更明显。`);
    if (comparison === "less_than_usual") sentences.push(`${concernText(concern)}比平时轻一些。`);
    if (comparison === "new") sentences.push(`${concernText(concern)}是今天新出现或新留意到的局部变化，暂不把它反推为长期状态。`);
  }
  if (!sentences.length && profile.skin_type && primary) sentences.push(`你平时自述为${skinTypeLabel[profile.skin_type]}肤质；今天各区域仍以这次确认的记录为准。`);
  if (reactiveAbsent.length) sentences.push(`长期档案中的敏感倾向为${sensitivityLabel[profile.sensitivity_level]}，但今天没有主观刺激不适，不能把当前局部变化直接解释为敏感反应。`);
  const relevantGoals = profile.skin_goals.filter((goal) => (goal === "oil_control" && present.some((item) => item.kind === "oiliness")) || (goal === "hydration" && present.some((item) => item.kind === "dryness")) || (goal === "blemish_care" && present.some((item) => ["blemishes", "small_bumps"].includes(item.kind))));
  if (relevantGoals.length) sentences.push(`${relevantGoals.map((goal) => goalLabel[goal]).join("、")}是你的长期关注方向，因此相关变化值得持续观察，但不会据此增加今天未记录的事实。`);
  return sentences.length ? sentences.join("") : null;
}

function observationBullets(present: Extract<DailyState, { version: 2 }>['concerns'], trends: RecentSkinTrend[]) {
  const bullets: string[] = [];
  const newConcern = present.find((concern) => concern.attributes.baseline_comparison === "new");
  if (newConcern) bullets.push(`接下来可留意${concernText(newConcern)}是否持续、是否起皮或伴随不适；目前还不足以判断它会不会反复。`);
  for (const concern of present.filter((item) => item !== newConcern).slice(0, 2)) bullets.push(`继续观察${concernText(concern)}明天是否仍出现，以及是否有新的伴随感受。`);
  const matched = trends.find((trend) => present.some((concern) => trend.title.includes(concernLabel[concern.kind])));
  if (matched) bullets.push(`近期记录中，${matched.supporting_line}`);
  const unmatched = present.find((concern) => !trends.some((trend) => trend.title.includes(concernLabel[concern.kind])));
  if (unmatched) bullets.push(`目前关于${concernText(unmatched)}的近期记录还不够，暂时不能判断是否反复出现。`);
  if (!bullets.length) bullets.push("后续如果有新的区域变化或不适感，可以继续记录，方便和今天的状态对照。");
  return bullets.slice(0, 4);
}
