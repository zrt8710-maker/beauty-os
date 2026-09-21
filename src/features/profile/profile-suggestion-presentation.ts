import { profileSuggestionHref, type ProfileSuggestionIntent } from "@/features/profile/profile-suggestion-intent";
import type { SkinProfileSuggestion } from "@/server/services/skin-profile-suggestion-service";

const areaLabels = {
  t_zone: "T区",
  forehead: "额头",
  nose: "鼻子",
  nose_wings: "鼻翼",
  cheeks: "脸颊",
  chin: "下巴",
} as const;

const tendencyLabels = {
  flaking: "起皮",
  redness: "泛红",
  reactive_discomfort: "刺激不适",
  blemishes: "痘痘",
  small_bumps: "小凸起",
  blackheads: "黑头",
  visible_pores: "毛孔明显",
  dullness: "暗沉",
  uneven_tone: "肤色不均",
  post_blemish_marks: "痘印或残留印记",
} as const;

export function presentProfileSuggestion(suggestion: SkinProfileSuggestion) {
  const intent: ProfileSuggestionIntent = suggestion.kind === "add_usual_area"
    ? { kind: "add_usual_area", concern: suggestion.concern, area: suggestion.area }
    : {
        kind: "add_recurring_tendency",
        concern: suggestion.concern,
        ...(suggestion.area ? { area: suggestion.area } : {}),
      };
  const copy = suggestion.kind === "add_usual_area"
    ? {
        lead: `最近几周，${areaLabels[suggestion.area]}多次出现${suggestion.concern === "dryness" ? "发干" : "出油"}。`,
        question: `要把“${areaLabels[suggestion.area]}容易偏${suggestion.concern === "dryness" ? "干" : "油"}”加入长期皮肤档案吗？`,
      }
    : {
        lead: `最近几周，${suggestion.area ? `${areaLabels[suggestion.area]}的` : ""}${tendencyLabels[suggestion.concern]}反复出现。`,
        question: "要把它加入长期反复倾向吗？",
      };

  return {
    ...copy,
    href: profileSuggestionHref(intent),
  };
}
