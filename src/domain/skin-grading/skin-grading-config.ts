import type { DailyStateConcernKind } from "@/schemas/checkin";

import type { SkinGrade, SkinGradingConcernDefinition, SkinGradingObservationMethod } from "./skin-grading-types";

export const SKIN_GRADE_LABELS: Record<SkinGrade, string> = {
  0: "无明显表现",
  1: "轻微",
  2: "比较明显",
  3: "明显",
  4: "很明显",
};

/**
 * Consumer-facing adaptation of the v1.1 `observation_method` sections in
 * docs/SKIN_GRADING_SPEC_V1.md. This data is deliberately not read by the mapper.
 */
const observationMethods: Record<DailyStateConcernKind, SkinGradingObservationMethod> = {
  oiliness: { where_to_look: ["T 区、鼻子、额头和容易出油的脸颊"], how_to_observe: ["用平时照镜子的距离观察，也可比较刚清洁后与中午或下午的状态"], what_to_notice: ["一点反光、可见油光或油膜，以及是否反复需要吸油"], touch_guidance: ["可用干净指腹轻触一次辅助判断，不要反复摩擦"], good_conditions: ["自然光或均匀室内光，未刻意补妆时"], avoid_conditions: ["刚涂高光、厚防晒或面霜、刚运动出汗、强闪光灯下"] },
  dryness: { where_to_look: ["两颊、口周、鼻翼和自己容易发干的区域"], how_to_observe: ["先看表面，再留意洗脸后或空调环境里的感觉"], what_to_notice: ["是否欠柔润、发紧，还是干燥感持续存在"], touch_guidance: ["可用干净指腹轻触，感受是否缺少柔软感；不要用力搓"], good_conditions: ["卸妆清洁后或日常未厚涂产品的状态"], avoid_conditions: ["刚敷完面膜、刚涂厚保湿产品或刚洗脸的短暂紧绷时"] },
  flaking: { where_to_look: ["鼻翼、口周、眉间、两颊等容易起皮的位置"], how_to_observe: ["靠近镜子，在自然光或柔和侧光下看表面"], what_to_notice: ["细小皮屑、局部成片皮屑，还是多个区域都有"], touch_guidance: ["不建议反复摸或搓，以免把原本没有的皮屑搓出来"], good_conditions: ["皮肤干净、没有厚重底妆或磨皮滤镜时"], avoid_conditions: ["刚去角质、刚擦拭或已经手动搓过皮肤后"] },
  roughness: { where_to_look: ["脸颊、额头、下巴等觉得不够平滑的区域"], how_to_observe: ["先看侧光下的表面，再和相邻较平滑处比较"], what_to_notice: ["纹理是否不均、表面是否连续不平滑"], touch_guidance: ["可轻摸一次确认触感，不要来回摩擦"], good_conditions: ["自然光或柔和侧光、裸皮或薄护肤状态"], avoid_conditions: ["厚重底妆、强磨皮滤镜、刚涂黏腻产品时"] },
  redness: { where_to_look: ["两颊、鼻翼、下巴等自己容易泛红的区域"], how_to_observe: ["在均匀自然光下，对比左右或与周围肤色"], what_to_notice: ["是短暂一小片、一个区域清楚泛红，还是多个区域持续明显"], good_conditions: ["室内外光线稳定、刚运动或刚洗热水脸后已平静一会儿"], avoid_conditions: ["彩色灯光、强闪光灯、滤镜，或刚摩擦皮肤导致的短暂发红"] },
  stinging: { where_to_look: ["有刺痛感觉的具体位置"], how_to_observe: ["回想今天何时出现、持续多久，是否在清洁或涂产品后出现"], what_to_notice: ["轻微一闪而过，还是反复、持续或影响日常感受"], touch_guidance: ["不要为了确认而反复触碰或叠加刺激性产品"], good_conditions: ["在感觉出现后尽快记录，并按自己的真实感受描述"], avoid_conditions: ["把尚未出现的感觉当作今天的事实，或用刺激方式测试"] },
  itching: { where_to_look: ["有发痒感觉的具体位置"], how_to_observe: ["回想今天出现的时机、持续时间和是否反复"], what_to_notice: ["是短暂轻痒，还是持续、频繁或让人忍不住想抓挠"], touch_guidance: ["不要抓挠或反复摩擦来确认程度"], good_conditions: ["在感觉出现后尽快记录，并按自己的真实感受描述"], avoid_conditions: ["把未出现的感觉补成事实，或通过抓挠测试"] },
  burning: { where_to_look: ["有灼热感觉的具体位置"], how_to_observe: ["回想今天何时出现、持续多久，是否和清洁、日晒或产品有关"], what_to_notice: ["是短暂局部发热，还是反复、持续或范围更大"], touch_guidance: ["不要为确认而用热水、摩擦或刺激性产品测试"], good_conditions: ["感觉出现后尽快记录，并按自己的真实感受描述"], avoid_conditions: ["强行刺激皮肤来判断，或把猜测当作当天感觉"] },
  blemishes: { where_to_look: ["额头、下巴、两颊等有活跃痘点的位置"], how_to_observe: ["在自然光下看清楚可见的活跃痘点，并分区观察"], what_to_notice: ["零散几颗、一个区域数个，还是多个区域都有；不要把旧痘印算进去"], touch_guidance: ["不挤、不抠；触摸不是判断数量的必要条件"], good_conditions: ["卸妆后或妆感较轻、光线均匀时"], avoid_conditions: ["滤镜、厚重遮瑕，或刚挤压、摩擦后"] },
  small_bumps: { where_to_look: ["额头、下巴、脸颊等常见区域"], how_to_observe: ["在自然光或柔和侧光下先正常距离看，再轻触确认"], what_to_notice: ["零散几颗、局部一片，还是多个区域的连续小凸起"], touch_guidance: ["可用干净指腹轻摸确认颗粒感；不要挤、抠或来回摩擦"], good_conditions: ["皮肤干净、无强滤镜或磨皮效果时"], avoid_conditions: ["刚涂厚霜、妆感纹理、明显起皮或光线过暗时"] },
  blackheads: { where_to_look: ["鼻子、鼻翼、下巴等容易有黑色小点的区域"], how_to_observe: ["在自然光下靠近镜子，分区观察"], what_to_notice: ["是局部少数黑色小点、一个区域数个，还是多个区域较密集"], touch_guidance: ["不需要挤压确认；避免把被挤压后的毛孔状态作为判断依据"], good_conditions: ["卸妆后或底妆较轻、光线均匀时"], avoid_conditions: ["强闪光灯、滤镜、厚遮瑕或刚清洁挤压后"] },
  visible_pores: { where_to_look: ["鼻子、鼻翼、两颊内侧等毛孔较容易显眼的位置"], how_to_observe: ["在自然光或柔和侧光下，按平时照镜子的距离观察"], what_to_notice: ["是局部近看略可见、一个区域清楚可见，还是多个区域纹理都显眼"], touch_guidance: ["触摸只能辅助感受纹理，不能单独决定可见程度"], good_conditions: ["裸皮或薄护肤、均匀光线下"], avoid_conditions: ["放大镜式极近距离、强闪光灯、滤镜或厚底妆时"] },
  dullness: { where_to_look: ["全脸和自己觉得不够明亮的区域"], how_to_observe: ["在自然光或均匀室内光下，看整体明亮感并和颈部或平时状态比较"], what_to_notice: ["是轻微少光泽、局部较不明亮，还是大部分脸都显得暗"], good_conditions: ["睡眠、清洁和护肤状态相对平常时"], avoid_conditions: ["黄光、彩色灯、强滤镜、刚运动出汗或刚补高光时"] },
  uneven_tone: { where_to_look: ["两颊、额头、下巴等不同区域"], how_to_observe: ["在均匀自然光下看区域之间的颜色差异"], what_to_notice: ["是小范围轻微差异、数个小区域，还是多个区域的明显斑驳"], good_conditions: ["卸妆后或底妆较轻、光线均匀时"], avoid_conditions: ["彩色灯、强阴影、滤镜或厚遮瑕时"] },
  post_blemish_marks: { where_to_look: ["之前长痘后留下印记的区域"], how_to_observe: ["在自然光下分区看印记的数量、范围和与周围肤色的反差"], what_to_notice: ["一两处浅淡印记、一个区域数处，还是多个区域较多且显眼"], touch_guidance: ["不需要触摸判断；不要把当天活跃痘点混在一起"], good_conditions: ["卸妆后或遮瑕较轻、光线均匀时"], avoid_conditions: ["强滤镜、厚遮瑕、彩色灯或刚挤压痘点后"] },
};

const direct = (kind: DailyStateConcernKind, label: string, descriptions: Record<SkinGrade, string>): SkinGradingConcernDefinition => ({
  kind,
  label,
  family: "direct_ordinal",
  observation_method: observationMethods[kind],
  required_attributes: ["status", "severity", "areas"],
  anchors: Object.fromEntries((Object.keys(SKIN_GRADE_LABELS) as unknown as SkinGrade[]).map((grade) => [grade, {
    id: `${kind}.grade_${grade}`,
    grade,
    label: SKIN_GRADE_LABELS[grade],
    description: descriptions[grade],
  }])) as SkinGradingConcernDefinition["anchors"],
});

const composite = (kind: DailyStateConcernKind, label: string, descriptions: Record<SkinGrade, string>): SkinGradingConcernDefinition => ({
  kind,
  label,
  family: "composite",
  observation_method: observationMethods[kind],
  required_attributes: ["status", "amount", "distribution"],
  anchors: Object.fromEntries((Object.keys(SKIN_GRADE_LABELS) as unknown as SkinGrade[]).map((grade) => [grade, {
    id: `${kind}.grade_${grade}`,
    grade,
    label: SKIN_GRADE_LABELS[grade],
    description: descriptions[grade],
  }])) as SkinGradingConcernDefinition["anchors"],
});

/**
 * Centralized machine-readable adaptation of docs/SKIN_GRADING_SPEC_V1.md.
 * The descriptions are explainability copy; mapper rules remain in the sibling mapper.
 */
export const SKIN_GRADING_CONFIG: Record<DailyStateConcernKind, SkinGradingConcernDefinition> = {
  oiliness: direct("oiliness", "出油", { 0: "无明显油光或油腻感", 1: "小范围轻微油光或稍油", 2: "一个区域明显油光或反复需要吸油", 3: "一个或多个区域有明显油膜，难以忽略", 4: "油光/油膜强烈且广泛，或全天反复造成困扰" }),
  dryness: direct("dryness", "干燥", { 0: "无干燥或紧绷感", 1: "轻微、短暂或小范围干紧", 2: "一个区域明显干燥、紧绷或欠柔润", 3: "一个或多个区域持续、明显干燥紧绷", 4: "广泛且很明显的干燥紧绷，全天突出" }),
  flaking: direct("flaking", "起皮 / 脱屑", { 0: "无可见皮屑", 1: "少量细小皮屑，近看可见", 2: "一个局部清楚可见皮屑", 3: "一个区域或多个区域有明显皮屑", 4: "广泛、较厚或反复脱落的皮屑" }),
  roughness: direct("roughness", "粗糙感", { 0: "触感和外观整体平滑", 1: "小范围轻微不平滑", 2: "一个区域明显粗糙或不均", 3: "一个或多个区域粗糙感明显", 4: "所述区域广泛且强烈粗糙不均" }),
  redness: direct("redness", "泛红", { 0: "无明显发红区域", 1: "轻微、局部或短暂泛红", 2: "一个区域可清楚看见泛红，或诱发后反复出现", 3: "一个或多个区域泛红突出，或大部分时间持续", 4: "颜色强烈或广泛泛红，明显主导外观" }),
  stinging: direct("stinging", "刺痛", { 0: "今天无刺痛", 1: "轻微、短暂、局部刺痛", 2: "一个区域有清楚可感且反复/持续片刻的刺痛", 3: "强烈或持续刺痛，或涉及多个区域", 4: "很强、持续很久或广泛突出地影响今天体验的刺痛" }),
  itching: direct("itching", "发痒", { 0: "今天无发痒", 1: "轻微、短暂、局部发痒", 2: "一个区域有清楚可感且反复/持续片刻的发痒", 3: "强烈或持续发痒，或涉及多个区域", 4: "很强、持续很久或广泛突出地影响今天体验的发痒" }),
  burning: direct("burning", "灼热感", { 0: "今天无灼热感", 1: "轻微、短暂、局部灼热感", 2: "一个区域有清楚可感且反复/持续片刻的灼热感", 3: "强烈或持续灼热感，或涉及多个区域", 4: "很强、持续很久或广泛突出地影响今天体验的灼热感" }),
  dullness: direct("dullness", "暗沉 / 缺乏光泽", { 0: "无明显暗沉或失去光泽", 1: "轻微失去光泽，通常近看或特定光线下可见", 2: "所述区域清楚较不明亮", 3: "大部分所述区域有明显暗沉感", 4: "广泛且很突出的缺乏光泽" }),
  uneven_tone: direct("uneven_tone", "肤色不均", { 0: "无明显肤色斑驳", 1: "轻微、局部肤色差异", 2: "一个区域或数个小区域有清楚不均", 3: "多个区域有明显色调反差/斑驳", 4: "广泛、突出的肤色不均主导外观" }),
  post_blemish_marks: direct("post_blemish_marks", "痘后印 / 痘印", { 0: "无明显痘后印", 1: "一处或少数浅淡、局部印记", 2: "一个区域有数处清楚可见印记", 3: "多个区域有较多或对比明显的印记", 4: "所述区域广泛且很突出的印记" }),
  blackheads: composite("blackheads", "黑头", { 0: "明确没有黑头", 1: "局部一处或少数黑色栓/小点", 2: "一个区域有数个清楚可见黑头", 3: "一个区域很多，或多个区域可见", 4: "很多且广泛/高度突出" }),
  small_bumps: composite("small_bumps", "小颗粒 / 小凸起", { 0: "明确没有小颗粒", 1: "局部一处或少数小凸起", 2: "一个区域有数个明显小凸起", 3: "一个区域很多，或多个区域都有", 4: "很多且广泛，明显改变表面观感" }),
  blemishes: composite("blemishes", "痘痘 / 痘点", { 0: "明确没有活跃痘点", 1: "局部一处或少数痘点", 2: "一个区域有数个清楚可见痘点，或少数分散区域", 3: "一个区域很多，或多个区域有活跃痘点", 4: "很多且广泛、非常突出" }),
  visible_pores: composite("visible_pores", "毛孔可见 / 毛孔明显", { 0: "无明显可见毛孔", 1: "局部近看才略可见", 2: "一个区域毛孔清楚可见", 3: "多个区域有显眼的毛孔/密集毛孔纹理", 4: "广泛且强烈突出地影响纹理观感" }),
};

/**
 * V2 facts available to this mapper are intentionally not extended in v0.1.
 * These gaps explain why the mapper returns `unknown` rather than manufacturing precision.
 */
export const CURRENT_DAILY_STATE_V2_GRADING_GAPS = [
  "No concern-specific morphology/type (for example, blackhead versus sebaceous-filament-like, or active blemish versus residual mark).",
  "No explicit visibility modality/intensity (for example, visible shine versus oily touch, faint versus high-contrast redness).",
  "No repeated-blotting/re-oiling or disruption signal for oiliness.",
  "No count-band vocabulary aligned with the specification's one-or-few / several / many values; current amount values are adapted conservatively.",
  "No direct per-concern observation of flakes, roughness modality, post-blemish-mark contrast, or bare-skin/lighting context.",
] as const;
