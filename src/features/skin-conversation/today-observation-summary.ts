import type { DailyState, DailyStateConcern } from "@/schemas/checkin";

const concernLabels = { oiliness: "出油", dryness: "发干", flaking: "起皮", roughness: "粗糙", redness: "泛红", stinging: "刺痛", itching: "发痒", burning: "灼热", blemishes: "痘痘", small_bumps: "小颗粒", blackheads: "黑头", visible_pores: "毛孔明显", uneven_tone: "肤色不均", dullness: "暗沉", post_blemish_marks: "痘印" } as const;
const areaLabels = { t_zone: "T区", forehead: "额头", hairline: "发际线", nose: "鼻子", nose_wings: "鼻翼", cheeks: "脸颊", chin: "下巴", eye_area: "眼周", full_face: "全脸", other: "局部" } as const;

export function buildTodayObservationSummary(state: DailyState | null): string[] {
  if (!state) return [];
  if (state.version === 1) return state.details.filter((item) => item.status === "present").slice(0, 4).map((item) => `${item.area ?? "局部"}${item.description ? `：${item.description}` : `出现${item.finding}`}`);
  const present = state.concerns.filter((item) => item.status === "present");
  const highlights = present.slice(0, 4).map(toSummaryLine);
  const newChange = present.find((item) => item.attributes.baseline_comparison === "new");
  const followUp = newChange ?? present[0];
  if (followUp && highlights.length < 5) highlights.push(`接下来可继续观察${describe(followUp)}有没有变化。`);
  return [...new Set(highlights)].slice(0, 5);
}

function toSummaryLine(concern: DailyStateConcern) {
  const subject = describe(concern);
  const comparison = concern.attributes.baseline_comparison;
  if (comparison === "usual") return `${subject}和长期记录的状态基本一致。`;
  if (comparison === "more_than_usual") return `${subject}比平时更明显。`;
  if (comparison === "less_than_usual") return `${subject}比平时轻一些。`;
  if (comparison === "new") return `${subject}是今天新留意到的变化。`;
  return concern.user_wording[0] ? `${subject}：${concern.user_wording[0]}` : `今天主要留意到${subject}。`;
}

function describe(concern: DailyStateConcern) {
  return `${concern.areas.map((area) => areaLabels[area]).join("、")}${concernLabels[concern.kind]}`;
}
