import "server-only";

import { z } from "zod";

import type { WeeklySkinSummary, WeeklySkinSummaryItem } from "@/features/profile/weekly-skin-summary-view-model";
import type { Profile } from "@/schemas/profile";

const narrationSchema = z.object({ narration: z.string().trim().min(80).max(1600) }).strict();
const unsafeLanguage = /屏障受损|炎症|激素|过敏|诊断|疾病|病症|grade|baseline_comparison|evidence_origin|unknown|证据不足|数据不足/iu;

export type WeeklySkinNarrationFacts = {
  period: { start: string; end: string };
  recorded_count: number;
  recorded_dates: string[];
  worsened: WeeklySkinSummaryItem[];
  improved: WeeklySkinSummaryItem[];
  stable: WeeklySkinSummaryItem[];
  new_or_emerging: WeeklySkinSummaryItem[];
  repeated_observations: WeeklySkinSummaryItem[];
  watch_labels: string[];
  ungraded_observation_count: number;
  has_recent_trends: boolean;
  long_term_baseline: { usual_oily_areas: string[]; usual_dry_areas: string[]; recurring_tendencies: string[] };
};

export type WeeklySkinNarrationProvider = { narrate(facts: WeeklySkinNarrationFacts): Promise<unknown> };
export type WeeklySkinNarrationService = { narrate(input: { summary: WeeklySkinSummary; profile: Pick<Profile, "long_term_skin_baseline"> }): Promise<string> };

const areaLabels: Record<string, string> = { t_zone: "T 区", forehead: "额头", hairline: "发际线", nose: "鼻子", nose_wings: "鼻翼", cheeks: "脸颊", chin: "下巴", eye_area: "眼周", other: "局部" };
const concernLabels: Record<string, string> = { oiliness: "出油", dryness: "发干", flaking: "起皮", roughness: "粗糙", redness: "泛红", stinging: "刺痛", itching: "发痒", burning: "灼热", blemishes: "痘痘", small_bumps: "小凸起", blackheads: "黑头", visible_pores: "毛孔明显", uneven_tone: "肤色不均", dullness: "暗沉", post_blemish_marks: "痘印或残留印记" };

/** AI receives this already-classified, user-safe snapshot only; it never receives raw conversations or check-ins. */
export function buildWeeklySkinNarrationFacts(summary: WeeklySkinSummary, profile: Pick<Profile, "long_term_skin_baseline">): WeeklySkinNarrationFacts {
  const baseline = profile.long_term_skin_baseline;
  return {
    period: summary.period,
    recorded_count: summary.recorded_count,
    recorded_dates: summary.recorded_dates,
    worsened: summary.worsened,
    improved: summary.improved,
    stable: summary.stable,
    new_or_emerging: summary.new_or_emerging,
    repeated_observations: summary.repeated_observations,
    watch_labels: summary.next_week_watch.map((item) => item.replace(/^留意|下周是否仍持续出现或继续加重。$/g, "")),
    ungraded_observation_count: summary.ungraded_observation_count,
    has_recent_trends: summary.has_recent_trends,
    long_term_baseline: {
      usual_oily_areas: baseline.usual_oily_areas.map((area) => areaLabels[area] ?? area),
      usual_dry_areas: baseline.usual_dry_areas.map((area) => areaLabels[area] ?? area),
      recurring_tendencies: baseline.recurring_tendencies.map((item) => `${item.usual_areas.map((area) => areaLabels[area] ?? area).join("、")}${item.usual_areas.length ? "的" : ""}${concernLabels[item.kind] ?? item.kind}`),
    },
  };
}

export function createWeeklySkinNarrationService(provider: WeeklySkinNarrationProvider | null): WeeklySkinNarrationService {
  return {
    async narrate(input) {
      return narrateWeeklySkinFacts(provider, buildWeeklySkinNarrationFacts(input.summary, input.profile));
    },
  };
}

/** Shared by the direct service and the facts-keyed narration reuse boundary. */
export async function narrateWeeklySkinFacts(provider: WeeklySkinNarrationProvider | null, facts: WeeklySkinNarrationFacts): Promise<string> {
  if (!provider) return fallbackWeeklySkinNarration(facts);
  try {
    const narration = narrationSchema.parse(await provider.narrate(facts)).narration;
    return unsafeLanguage.test(narration) || containsUnsupportedConcern(narration, facts) ? fallbackWeeklySkinNarration(facts) : narration;
  } catch {
    return fallbackWeeklySkinNarration(facts);
  }
}

/** Human-readable resilience path; it deliberately does not claim ungraded observations are absent or normal. */
export function fallbackWeeklySkinNarration(facts: WeeklySkinNarrationFacts) {
  const sentences = [`这组 ${facts.recorded_count} 次皮肤记录覆盖 ${facts.period.start} 至 ${facts.period.end}，整体以已经连续出现的感受为线索来观察。`];
  if (facts.worsened.length) sentences.push(`${facts.worsened.map((item) => item.label).join("、")}在这段时间比前几次更明显，接下来可优先留意是否仍持续。`);
  if (facts.improved.length) sentences.push(`${facts.improved.map((item) => item.label).join("、")}较早些时候有所缓解，可以先维持目前让皮肤感觉舒适的节奏。`);
  if (facts.stable.length) sentences.push(`${facts.stable.map((item) => item.label).join("、")}多次接近平时状态，近期没有看到这部分出现持续偏离。`);
  if (facts.new_or_emerging.length) sentences.push(`${facts.new_or_emerging.map((item) => item.label).join("、")}出现次数还不多，先观察它是否会在之后的记录里重复出现。`);
  if (!facts.worsened.length && !facts.improved.length && !facts.stable.length && !facts.new_or_emerging.length) sentences.push("已记录的感受暂未形成持续加重或持续缓解的模式；这并不要求因为一次轻微波动频繁调整护理。")
  if (facts.ungraded_observation_count) sentences.push("部分感受还没有形成可连续比较的记录，暂时不把它解释为皮肤已经稳定或问题消失。")
  if (facts.long_term_baseline.usual_oily_areas.length || facts.long_term_baseline.usual_dry_areas.length || facts.long_term_baseline.recurring_tendencies.length) sentences.push("长期状态会作为之后对照的背景，仍以每次实际记录到的变化为准。")
  if (!facts.worsened.length) sentences.push("接下来继续留意相同区域是否连续出现变化；如果没有新的重复信号，护理节奏可以先保持稳定。")
  return sentences.join("");
}

function containsUnsupportedConcern(narration: string, facts: WeeklySkinNarrationFacts) {
  const allowed = new Set([
    ...facts.worsened, ...facts.improved, ...facts.stable, ...facts.new_or_emerging, ...facts.repeated_observations,
  ].map((item) => item.label).flatMap((label) => Object.values(concernLabels).filter((concern) => label.includes(concern))));
  for (const baseline of facts.long_term_baseline.recurring_tendencies) for (const concern of Object.values(concernLabels)) if (baseline.includes(concern)) allowed.add(concern);
  return Object.values(concernLabels).some((concern) => narration.includes(concern) && !allowed.has(concern));
}
