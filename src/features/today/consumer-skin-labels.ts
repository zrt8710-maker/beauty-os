const concernLabels: Record<string, string> = {
  oiliness: "出油",
  dryness: "干燥",
  flaking: "起皮",
  roughness: "粗糙",
  redness: "泛红",
  stinging: "刺痛",
  itching: "发痒",
  burning: "灼热",
  blemishes: "痘痘",
  small_bumps: "小颗粒",
  blackheads: "黑头",
  visible_pores: "毛孔明显",
  uneven_tone: "肤色不均",
  dullness: "暗沉",
  post_blemish_marks: "痘印",
};

const areaLabels: Record<string, string> = {
  t_zone: "T 区",
  forehead: "额头",
  hairline: "发际线",
  nose: "鼻子",
  nose_wings: "鼻翼",
  cheeks: "脸颊",
  chin: "下巴",
  eye_area: "眼周",
  full_face: "全脸",
  other: "局部",
};

/** Consumer copy must never expose a raw internal taxonomy value. */
export function consumerConcernLabel(value: string): string {
  return concernLabels[value] ?? "皮肤状态";
}

/** Consumer copy must never expose a raw internal taxonomy value. */
export function consumerAreaLabel(value: string | null | undefined): string {
  return value ? areaLabels[value] ?? "局部" : "局部";
}
