import { SKIN_GRADING_CONFIG, SKIN_GRADE_LABELS } from "@/domain/skin-grading/skin-grading-config";
import type { LongTermSkinBaseline } from "@/schemas/profile";

type Tendency = LongTermSkinBaseline["recurring_tendencies"][number]["kind"];
type Intensity = NonNullable<LongTermSkinBaseline["recurring_tendencies"][number]["usual_intensity"]>;
type AnchorConfig = { label: string; grading_concerns: readonly (keyof typeof SKIN_GRADING_CONFIG)[] };

export const frequencyOptions = [["occasional", "偶尔出现"], ["recurring", "反复出现"], ["frequent", "经常出现"], ["unknown", "不确定"]] as const;
export const usualIntensityOptions = [
  ["slight", SKIN_GRADE_LABELS[1]],
  ["noticeable", SKIN_GRADE_LABELS[2]],
  ["marked", SKIN_GRADE_LABELS[3]],
  ["very_marked", SKIN_GRADE_LABELS[4]],
  ["unknown", "不确定"],
] as const satisfies ReadonlyArray<readonly [Intensity, string]>;

export const recurringTendencyConfig: Record<Tendency, AnchorConfig> = {
  small_bumps: { label: "小凸起 / 闭口样颗粒", grading_concerns: ["small_bumps"] },
  blackheads: { label: "黑头", grading_concerns: ["blackheads"] },
  visible_pores: { label: "毛孔明显", grading_concerns: ["visible_pores"] },
  blemishes: { label: "容易长痘 / 反复长痘", grading_concerns: ["blemishes"] },
  redness: { label: "泛红", grading_concerns: ["redness"] },
  flaking: { label: "起皮", grading_concerns: ["flaking"] },
  reactive_discomfort: { label: "刺 / 痒 / 灼热等刺激不适", grading_concerns: ["stinging", "itching", "burning"] },
  dullness: { label: "暗沉", grading_concerns: ["dullness"] },
  uneven_tone: { label: "肤色不均", grading_concerns: ["uneven_tone"] },
  post_blemish_marks: { label: "痘印 / 色沉", grading_concerns: ["post_blemish_marks"] },
};

export function usualIntensityLabel(intensity: Intensity) {
  return usualIntensityOptions.find(([value]) => value === intensity)?.[1] ?? "不确定";
}

export function recurringTendencyGradingConcerns(kind: Tendency) {
  return recurringTendencyConfig[kind].grading_concerns;
}
