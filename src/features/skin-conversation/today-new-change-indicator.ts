import type { DailyStateArea, DailyStateConcernKind } from "@/schemas/checkin";
import type { LongTermSkinBaseline } from "@/schemas/profile";

const areaMatchers: Array<[DailyStateArea, RegExp]> = [
  ["t_zone", /T\s*区/i], ["forehead", /额头/], ["hairline", /发际线/], ["nose_wings", /鼻翼/],
  ["nose", /鼻子/], ["cheeks", /脸颊|两颊/], ["chin", /下巴/], ["eye_area", /眼周/], ["full_face", /全脸|整张脸/],
];

const concernMatchers: Array<[DailyStateConcernKind, RegExp]> = [
  ["oiliness", /出油|油光|油感/], ["dryness", /干燥|发干|干|紧绷/], ["flaking", /起皮|脱皮/],
  ["redness", /泛红|发红|红/], ["stinging", /刺痛|刺/], ["itching", /发痒|痒/], ["burning", /灼热|烧灼/],
  ["blemishes", /痘痘|长痘|痘/], ["small_bumps", /闭口|小颗粒|小凸起|颗粒感/], ["blackheads", /黑头/],
  ["visible_pores", /毛孔/], ["uneven_tone", /肤色不均/], ["dullness", /暗沉/], ["post_blemish_marks", /痘印|残留印记/],
];

const areaLabels: Record<DailyStateArea, string> = { t_zone: "T区", forehead: "额头", hairline: "发际线", nose: "鼻子", nose_wings: "鼻翼", cheeks: "脸颊", chin: "下巴", eye_area: "眼周", full_face: "全脸", other: "局部" };
const concernLabels: Record<DailyStateConcernKind, string> = { oiliness: "出油", dryness: "发干", flaking: "起皮", roughness: "粗糙", redness: "泛红", stinging: "刺痛", itching: "发痒", burning: "灼热", blemishes: "长痘", small_bumps: "小颗粒", blackheads: "黑头", visible_pores: "毛孔明显", uneven_tone: "肤色不均", dullness: "暗沉", post_blemish_marks: "痘印" };

export type TodayNewChangeIndicator = { key: string; label: string };

/** Client-side presentation hint only. It never writes facts or infers an unrecorded history. */
export function getTodayNewChangeIndicators(message: string, baseline: LongTermSkinBaseline | null | undefined, previousUserMessages: string[]): TodayNewChangeIndicator[] {
  const priorKeys = new Set(previousUserMessages.flatMap((item) => extractMentionedConcernAreas(item).map(({ concern, area }) => `${concern}:${area}`)));
  return extractMentionedConcernAreas(message)
    .filter(({ concern, area }) => !priorKeys.has(`${concern}:${area}`) && !hasMatchingBaseline(concern, area, baseline))
    .map(({ concern, area }) => ({ key: `${concern}:${area}`, label: `今天新变化 · ${areaLabels[area]}${concernLabels[concern]}` }));
}

function extractMentionedConcernAreas(message: string) {
  const clauses = message.split(/[，,。；;、]/).filter(Boolean);
  return clauses.flatMap((clause) => {
    const concern = concernMatchers.find(([, matcher]) => matcher.test(clause))?.[0];
    if (!concern) return [];
    const areas = areaMatchers.filter(([, matcher]) => matcher.test(clause)).map(([area]) => area);
    return areas.map((area) => ({ concern, area }));
  });
}

function hasMatchingBaseline(concern: DailyStateConcernKind, area: DailyStateArea, baseline: LongTermSkinBaseline | null | undefined) {
  if (!baseline) return false;
  if (concern === "oiliness") return baseline.usual_oily_areas.includes(area as never);
  if (concern === "dryness") return baseline.usual_dry_areas.includes(area as never);
  if (concern === "flaking") return baseline.recurring_tendencies.some((item) => item.kind === "flaking" && item.usual_areas.includes(area as never));
  const tendency = concern === "stinging" || concern === "itching" || concern === "burning" ? "reactive_discomfort" : concern;
  return baseline.recurring_tendencies.some((item) => item.kind === tendency && item.usual_areas.includes(area as never));
}
