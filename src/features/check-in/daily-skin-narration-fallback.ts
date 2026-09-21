import type { SkinCheckin } from "@/schemas/checkin";

const labels: Record<string, string> = { oiliness: "出油", dryness: "干燥", flaking: "起皮", roughness: "粗糙", redness: "泛红", stinging: "刺痛", itching: "发痒", burning: "灼热", blemishes: "痘痘", small_bumps: "小凸起", blackheads: "黑头", visible_pores: "毛孔明显", uneven_tone: "肤色不均", dullness: "暗沉", post_blemish_marks: "痘印" };
const areas: Record<string, string> = { t_zone: "T 区", forehead: "额头", hairline: "发际线", nose: "鼻子", nose_wings: "鼻翼", cheeks: "脸颊", chin: "下巴", eye_area: "眼周", full_face: "全脸", other: "局部" };

/** Minimal resilience copy only. Normal presentation comes from Daily AI narration. */
export function buildDailyFallbackNarration(checkin: SkinCheckin) {
  const concerns = checkin.daily_state?.version === 2 ? checkin.daily_state.concerns.filter((item) => item.status === "present") : [];
  if (!concerns.length) return "今天整体比较平稳，没有记录到明显的新变化或不适。";
  const notable = concerns.find((item) => item.attributes.baseline_comparison === "more_than_usual" || item.attributes.baseline_comparison === "new" || item.attributes.onset === "today") ?? concerns[0];
  const where = notable.areas.map((area) => areas[area] ?? "局部").join("、");
  const comparison = notable.attributes.baseline_comparison === "more_than_usual" ? "比平时更明显" : notable.attributes.baseline_comparison === "new" || notable.attributes.onset === "today" ? "是今天新留意到的变化" : "是今天主要记录到的状态";
  return `今天整体以${where}${labels[notable.kind] ?? notable.kind}为主，${comparison}。${comparison !== "是今天主要记录到的状态" ? "接下来可以留意它是否会在之后的记录中再次出现。" : ""}`;
}
