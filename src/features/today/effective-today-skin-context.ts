import type { EffectiveDailySkinState } from "@/features/check-in/effective-daily-skin-state";
import { consumerAreaLabel, consumerConcernLabel } from "@/features/today/consumer-skin-labels";

/** A reader-facing projection that keeps inherited baseline distinct from today's changes. */
export function describeEffectiveTodaySkin(state: EffectiveDailySkinState): string {
  const changes = state.todayOverrides.filter((item) => item.status === "present");
  const changeText = changes.slice(0, 2).map((item) => {
    const area = consumerAreaLabel(item.area);
    const concern = consumerConcernLabel(item.concern);
    if (item.baselineComparison === "more_than_usual") return `${area}${concern}比平时更明显`;
    if (item.baselineComparison === "new") return `${area}出现${concern}`;
    return `${area}${concern}`;
  });
  const background = state.inheritedBaseline.slice(0, 2).map((item) => {
    const area = consumerAreaLabel(item.area);
    return `${area}${consumerConcernLabel(item.concern)}`;
  });
  if (changeText.length) {
    return `今天主要变化：${changeText.join("，")}；${background.length ? `${background.join("、")}等长期状态继续作为背景参考。` : "其余长期状态继续作为背景参考。"}`;
  }
  return background.length
    ? `${background.join("、")}等长期状态继续作为今天的背景参考；今天没有记录到新的变化。`
    : "今天还没有确认到具体的皮肤变化。";
}
